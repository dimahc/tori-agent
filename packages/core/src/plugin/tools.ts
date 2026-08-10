import { isAbsolute, join, resolve, sep } from "node:path";
import { readFile } from "node:fs/promises";
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
import type { VerificationPolicy } from "../types/verification.js";
import type { WorkflowPaths } from "../tools/workflow.js";
import {
  getWorkflowState,
  incrementDeliberationCount,
  recordCheckResult,
  recordTaskResult,
  transitionStage,
} from "../tools/workflow.js";
import type { PersonaMatch } from "../types/persona.js";
import type { CIConfig } from "../types/ci.js";
import { trigger_ci_check } from "../tools/ci-hook.js";

export interface ToolRegistry {
  [name: string]: {
    description: string;
    args: Record<string, unknown>;
    execute(args: Record<string, unknown>, context?: ToolExecutionContext): Promise<string>;
  };
}

export interface ToolExecutionContext {
  sessionID: string;
  directory: string;
  worktree: string;
  agent: string;
}

export function buildReadOnlyTools(
  projectRoot: string,
  paths: ArtifactPaths,
  skillsDir: string,
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
          const result = await getWorkflowState(projectRoot, workflowPaths, workflow_id!);
          if (!result) {
            return JSON.stringify({ error: `Workflow not found: ${workflow_id}` });
          }
          const count = await incrementDeliberationCount(projectRoot, workflowPaths, workflow_id!);
          const stuckWarning = count >= 3
            ? `Workflow stuck in '${result.state.current_stage}' for ${count} consecutive checks. Stop deliberating and execute the next step now.`
            : null;
          return JSON.stringify({ ...result, deliberation_count: count, stuck_warning: stuckWarning });
        } catch (err) {
          return JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    skill: {
      description:
        "Load and return the instructions for a builtin skill by name. " +
        "Use when the agent needs to apply a specific skill (e.g. caveman, spec-writer).",
      args: { name: {} },
      async execute({ name }: { name?: string }) {
        try {
          if (!name) return JSON.stringify({ error: 'Missing required argument: name' });
          const skillPath = join(skillsDir, name, 'SKILL.md');
          const content = await readFile(skillPath, 'utf-8');
          return content;
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
  configDir: string,
  runtime: 'opencode' | 'kilocode' = 'opencode',
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
    scratchpad: {
      description:
        "Append an entry to the project scratchpad (" + join('.opencode', 'scratchpad.md') + " or " + join('.kilocode', 'scratchpad.md') + "). " +
        "The scratchpad is Tori's central brain — use it to track active work, completed tasks, " +
        "decisions, and key artifacts. Call this after every spawn and every delivery.",
      args: { section: {}, content: {} },
      async execute({ section, content }: { section?: string; content?: string }) {
        try {
          const scratchpadRelPath = join(runtime === 'opencode' ? '.opencode' : '.kilocode', 'scratchpad.md');
          const timestamp = new Date().toISOString().split('T')[0];
          const entry = `\n## ${section || 'Entry'} [${timestamp}]\n${content || ''}\n`;
          return JSON.stringify(await writeAppend(projectRoot, scratchpadRelPath, entry));
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
      args: { workflow_id: {}, to_stage: {}, policy: {} },
      async execute({
        workflow_id,
        to_stage,
        policy,
      }: {
        workflow_id?: string;
        to_stage?: string;
        policy?: string;
      }) {
        try {
          let parsedPolicy: VerificationPolicy | undefined;
          if (policy) {
            try {
              parsedPolicy = JSON.parse(policy) as VerificationPolicy;
            } catch {
              // ignore invalid policy JSON
            }
          }
          return JSON.stringify(
            await transitionStage(
              projectRoot,
              workflowPaths,
              workflow_id!,
              to_stage!,
              parsedPolicy ? { policy: parsedPolicy } : undefined,
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
      args: { workflow_id: {}, check_name: {}, status: {}, detail: {}, max_iterations: {} },
      async execute({
        workflow_id,
        check_name,
        status,
        detail,
        max_iterations,
      }: {
        workflow_id?: string;
        check_name?: string;
        status?: string;
        detail?: string;
        max_iterations?: string;
      }) {
        try {
          await recordCheckResult(
            projectRoot,
            workflowPaths,
            workflow_id!,
            check_name!,
            status as "PASS" | "FAIL" | "SKIP",
            detail,
            0.5,
            true,
            max_iterations ? Number(max_iterations) : undefined,
          );
          return JSON.stringify({ success: true });
        } catch (err) {
          return JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    trigger_ci_check: {
      description:
        "Run a CI command and record the result as a workflow check. " +
        "Used automatically on verify stage entry when ci_config is present in workflow frontmatter.",
      args: { workflow_id: {}, config: {} },
      async execute({
        workflow_id,
        config,
      }: {
        workflow_id?: string;
        config?: string;
      }) {
        try {
          if (!workflow_id || !config) {
            return JSON.stringify({ error: 'Missing required arguments: workflow_id, config' });
          }
          const parsed = JSON.parse(config) as CIConfig;
          const result = await trigger_ci_check(projectRoot, parsed, workflow_id!);
          return JSON.stringify(result);
        } catch (err) {
          return JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  };
}
