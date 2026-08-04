import { isAbsolute, join, resolve, sep } from "node:path";
import type { ArtifactPaths } from "../tools/lifecycle.js";
import {
  checkArtifacts,
  completePlan,
  markBlockDone,
  projectState,
  registerSpec as registerSpecImpl,
  runMechanicalChecks,
  saveCheckpoint,
  writeAppend,
} from "../tools/lifecycle.js";
import type { WorkflowPaths } from "../tools/workflow.js";
import {
  getWorkflowState,
  recordCheckResult,
  recordTaskResult,
  transitionStage,
} from "../tools/workflow.js";

export interface ToolRegistry {
  [name: string]: {
    description: string;
    args: Record<string, unknown>;
    execute(args: Record<string, unknown>): Promise<string>;
  };
}

export function buildReadOnlyTools(
  projectRoot: string,
  paths: ArtifactPaths,
): ToolRegistry {
  const workflowPaths: WorkflowPaths = { workflows: paths.workflows };

  return {
    project_state: {
      description:
        "Return a structured report of the current state of all management artifacts " +
        "(exec-plans, specs, briefs, workflows) in the project. Call at the start of every mission.",
      args: {},
      async execute() {
        try {
          return JSON.stringify(await projectState(projectRoot, paths));
        } catch (err) {
          return JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    check_artifacts: {
      description:
        "Cross-artifact consistency scan — detects dead references, stale statuses, " +
        "and missing links between exec-plans, specs, and briefs.",
      args: {},
      async execute() {
        try {
          return JSON.stringify(await checkArtifacts(projectRoot, paths));
        } catch (err) {
          return JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    run_mechanical_checks: {
      description:
        "Run the project's mechanical pre-filter (lint then tests) before spawning " +
        "semantic reviewers. Call at the start of every review.",
      args: {},
      async execute() {
        try {
          return JSON.stringify(await runMechanicalChecks(projectRoot));
        } catch (err) {
          return JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    workflow_state: {
      description:
        "Return the current state of a workflow (stage, iteration, tasks, checks). " +
        "Call at the start of each stage transition.",
      args: { workflow_id: {} },
      async execute({ workflow_id }: { workflow_id?: string }) {
        try {
          return JSON.stringify(
            await getWorkflowState(projectRoot, workflowPaths, workflow_id!),
          );
        } catch (err) {
          return JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  };
}

function resolveArtifact(projectRoot: string, relPath: string): string {
  const resolved = isAbsolute(relPath) ? relPath : join(projectRoot, relPath);
  const normalizedRoot = resolve(projectRoot) + sep;
  const normalizedPath = resolve(resolved);
  if (!normalizedPath.startsWith(normalizedRoot)) {
    throw new Error(`Path escapes project root: ${relPath}`);
  }
  return normalizedPath;
}

export function buildWriteTools(
  projectRoot: string,
  paths: ArtifactPaths,
): ToolRegistry {
  const workflowPaths: WorkflowPaths = { workflows: paths.workflows };

  return {
    mark_block_done: {
      description:
        "Check a specific block in an exec-plan ([ ] → [x]). Call after each validated delivery.",
      args: { plan_file: {}, block_name: {} },
      async execute({
        plan_file,
        block_name,
      }: {
        plan_file?: string;
        block_name?: string;
      }) {
        try {
          return JSON.stringify(
            await markBlockDone(projectRoot, plan_file!, block_name!),
          );
        } catch (err) {
          return JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    complete_plan: {
      description:
        'Set an exec-plan\'s status to "completed" in its frontmatter. ' +
        "Refuses if any unchecked blocks remain.",
      args: { plan_file: {} },
      async execute({ plan_file }: { plan_file?: string }) {
        try {
          return JSON.stringify(await completePlan(projectRoot, plan_file!));
        } catch (err) {
          return JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    register_spec: {
      description:
        "Create a new spec file with minimal frontmatter (title, status: draft, created). " +
        "Refuses to overwrite existing files.",
      args: {
        spec_file: {},
        title: {},
      },
      async execute({
        spec_file,
        title,
      }: {
        spec_file?: string;
        title?: string;
      }) {
        try {
          return JSON.stringify(
            await registerSpecImpl(projectRoot, paths, spec_file!, title!),
          );
        } catch (err) {
          return JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    write_append: {
      description:
        "Append content to a file (creates the file if it doesn't exist). " +
        "Use for incremental generation of long artifacts — write section by section " +
        "instead of generating everything in one shot.",
      args: { file: {}, content: {} },
      async execute({ file, content }: { file?: string; content?: string }) {
        try {
          return JSON.stringify(await writeAppend(projectRoot, file!, content!));
        } catch (err) {
          return JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    save_checkpoint: {
      description:
        "Save a checkpoint file summarizing progress and remaining work. " +
        "Call when approaching context limits (budget exhaustion, long mission, " +
        "or before returning to Tori for a continuation). Tori will read this " +
        "file and spawn a fresh agent to resume.",
      args: { file: {}, summary: {}, remaining_work: {} },
      async execute({ file, summary, remaining_work }: { file?: string; summary?: string; remaining_work?: string }) {
        try {
          return JSON.stringify(await saveCheckpoint(projectRoot, file!, summary!, remaining_work!));
        } catch (err) {
          return JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    transition_stage: {
      description:
        "Transition a workflow to a new stage. Validates the transition against the state machine.",
      args: { workflow_id: {}, to_stage: {} },
      async execute({
        workflow_id,
        to_stage,
      }: {
        workflow_id?: string;
        to_stage?: string;
      }) {
        try {
          return JSON.stringify(
            await transitionStage(
              projectRoot,
              workflowPaths,
              workflow_id!,
              to_stage!,
            ),
          );
        } catch (err) {
          return JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    record_task_result: {
      description: "Record a task result in a workflow file.",
      args: { workflow_id: {}, task_id: {}, agent: {}, status: {}, plan_file: {}, block_name: {} },
      async execute({
        workflow_id,
        task_id,
        agent,
        status,
        plan_file,
        block_name,
      }: {
        workflow_id?: string;
        task_id?: string;
        agent?: string;
        status?: string;
        plan_file?: string;
        block_name?: string;
      }) {
        try {
          await recordTaskResult(
            projectRoot,
            workflowPaths,
            workflow_id!,
            task_id!,
            agent!,
            status as "done" | "failed" | "running" | "pending",
            plan_file,
            block_name,
          );
          return JSON.stringify({ success: true });
        } catch (err) {
          return JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    record_check_result: {
      description: "Record a verification check result in a workflow file.",
      args: { workflow_id: {}, check_name: {}, status: {}, detail: {} },
      async execute({
        workflow_id,
        check_name,
        status,
        detail,
      }: {
        workflow_id?: string;
        check_name?: string;
        status?: string;
        detail?: string;
      }) {
        try {
          await recordCheckResult(
            projectRoot,
            workflowPaths,
            workflow_id!,
            check_name!,
            status as "PASS" | "FAIL" | "SKIP",
            detail,
          );
          return JSON.stringify({ success: true });
        } catch (err) {
          return JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  };
}
