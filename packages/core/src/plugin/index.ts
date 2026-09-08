/**
 * @file packages/core/src/plugin/index.ts
 * @description Core Plugin Internals - Tool builders, lazy registry, budget executor.
 *
 * These are internal functions used by the runtime plugin.
 * They are exported from core for the runtime package to consume.
 */

import { promises as fs } from 'node:fs';
import { join, dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkArtifacts,
  completePlan,
  markBlockDone,
  projectState,
  registerSpecImpl,
  runMechanicalChecks,
  saveCheckpoint,
  writeAppend,
} from '../tools/lifecycle.js';
import type { ArtifactPaths } from '../tools/lifecycle.js';
import type { VerificationPolicy } from '../types/verification.js';
import type { WorkflowPaths } from '../tools/workflow.js';
import {
  getWorkflowState,
  incrementDeliberationCount,
  recordCheckResult,
  recordTaskResult,
  transitionStage,
} from '../tools/workflow.js';
import type { PersonaMatch } from '../types/persona.js';
import type { CIConfig } from '../types/ci.js';
import { trigger_ci_check } from '../tools/ci-hook.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Lazy-load registry ────────────────────────────────────────────────────────

interface LazyToolMeta {
  name: string;
  category: string;
  description: string;
  args: Record<string, unknown>;
  execute: (args: Record<string, unknown>, context?: ToolExecutionContext) => Promise<string>;
}

const lazyToolRegistry = new Map<string, LazyToolMeta>();

export function registerLazyTool(meta: LazyToolMeta): void {
  lazyToolRegistry.set(meta.name, meta);
}

export function getLazyTool(name: string): LazyToolMeta | undefined {
  return lazyToolRegistry.get(name);
}

export function getAllLazyTools(): LazyToolMeta[] {
  return Array.from(lazyToolRegistry.values());
}

export function buildDiscoveryTools(): Record<string, LazyToolMeta> {
  const tools: Record<string, LazyToolMeta> = {
    list_available_tools: {
      name: 'list_available_tools',
      category: 'core',
      description:
        'List all available tools with their category. ' +
        'Use this to discover what tools exist before loading extensions. ' +
        'Returns tool name and category (core, erpnext, jira, confluence, etc.).',
      args: {},
      async execute() {
        try {
          const coreTools = [
            'task', 'transition_stage', 'record_task_result', 'record_check_result',
            'write_checkpoint', 'classify_task', 'question', 'compress',
            'todowrite', 'skill', 'scratchpad', 'project_state', 'check_artifacts',
            'workflow_state', 'run_mechanical_checks', 'mark_block_done',
            'complete_plan', 'register_spec', 'write_append', 'save_checkpoint',
            'trigger_ci_check', 'list_available_tools', 'load_tools',
          ];
          return JSON.stringify({
            tools: coreTools.map(name => ({ name, category: 'core' })),
            total: coreTools.length,
            note: 'Extension tools (erpnext, jira, confluence, etc.) are loaded by the runtime. Use load_tools to request them.',
          });
        } catch (err) {
          return JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    load_tools: {
      name: 'load_tools',
      category: 'core',
      description:
        'Load extension tools by category or name. ' +
        'Currently a no-op placeholder — extension tools (erpnext, jira, confluence) ' +
        'are loaded by the runtime. This tool exists for future lazy-loading support.',
      args: { categories: {}, names: {} },
      async execute({ categories, names }: { categories?: string; names?: string }) {
        return JSON.stringify({
          message: 'Extension tools are loaded by the runtime, not by this tool.',
          loaded: [],
          hint: 'To reduce context, configure your MCP server to load only the tools you need per project.',
        });
      },
    },
    skill: {
      name: 'skill',
      category: 'core',
      description:
        'Load and return the instructions for a builtin skill by name. ' +
        'Use when the agent needs to apply a specific skill (e.g. caveman, spec-writer).',
      args: { name: {} },
      async execute({ name }: { name?: string }) {
        try {
          if (!name) return JSON.stringify({ error: 'Missing required argument: name' });
          const skillsDir = join(__dirname, '../../.opencode/skills');
          const skillPath = join(skillsDir, name, 'SKILL.md');
          const content = await fs.readFile(skillPath, 'utf-8');
          return content;
        } catch (err) {
          return JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
  };
  return tools;
}

// ── Tool Execution Context ────────────────────────────────────────────────────

export interface ToolExecutionContext {
  sessionID: string;
  directory: string;
  worktree: string;
  agent: string;
}

// ── Tool Registry ─────────────────────────────────────────────────────────────

export interface ToolRegistry {
  [name: string]: {
    description: string;
    args: Record<string, unknown>;
    execute(args: Record<string, unknown>, context?: ToolExecutionContext): Promise<string>;
  };
}

export function registerToolInLazyRegistry(
  name: string,
  category: LazyToolMeta['category'],
  description: string,
  args: Record<string, unknown>,
  execute: LazyToolMeta['execute'],
): void {
  registerLazyTool({
    name,
    category,
    description,
    args,
    execute: async (a, c) => execute(a, c) as Promise<string>,
  });
}

export function getDiscoveryTools(): Record<string, LazyToolMeta> {
  return buildDiscoveryTools();
}

// ── Tool Builders ─────────────────────────────────────────────────────────────

export function buildReadOnlyTools(
  projectRoot: string,
  paths: ArtifactPaths,
  skillsDir: string,
): ToolRegistry {
  const workflowPaths: WorkflowPaths = { workflows: paths.workflows };

  return {
    project_state: {
      description:
        'Return a structured report of the current state of all management artifacts ' +
        '(exec-plans, specs, briefs, workflows) in the project. Call at the start of every mission.',
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
        'Cross-artifact consistency scan — detects dead references, stale statuses, ' +
        'and missing links between exec-plans, specs, and briefs.',
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
        'Run the project\'s mechanical pre-filter (lint then tests) before spawning ' +
        'semantic reviewers. Call at the start of every review.',
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
        'Return the current state of a workflow (stage, iteration, tasks, checks). ' +
        'Call at the start of each stage transition.',
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
        'Load and return the instructions for a builtin skill by name. ' +
        'Use when the agent needs to apply a specific skill (e.g. caveman, spec-writer).',
      args: { name: {} },
      async execute({ name }: { name?: string }) {
        try {
          if (!name) return JSON.stringify({ error: 'Missing required argument: name' });
          const skillPath = join(skillsDir, name, 'SKILL.md');
          const content = await fs.readFile(skillPath, 'utf-8');
          return content;
        } catch (err) {
          return JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    },
    list_available_tools: buildDiscoveryTools().list_available_tools,
    load_tools: buildDiscoveryTools().load_tools,
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
        'Check a specific block in an exec-plan ([ ] → [x]). Call after each validated delivery.',
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
        'Refuses if any unchecked blocks remain.',
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
        'Create a new spec file with minimal frontmatter (title, status: draft, created). ' +
        'Refuses to overwrite existing files.',
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
        'Append content to a file (creates the file if it doesn\'t exist). ' +
        'Use for incremental generation of long artifacts — write section by section ' +
        'instead of generating everything in one shot.',
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
        'Save a checkpoint file summarizing progress and remaining work. ' +
        'Call when approaching context limits (budget exhaustion, long mission, ' +
        'or before returning to Tori for a continuation). Tori will read this ' +
        'file and spawn a fresh agent to resume.',
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
        'Append an entry to the project scratchpad (' + join('.opencode', 'scratchpad.md') + ' or ' + join('.kilocode', 'scratchpad.md') + '). ' +
        'The scratchpad is Tori\'s central brain — use it to track active work, completed tasks, ' +
        'decisions, and key artifacts. Call this after every spawn and every delivery.',
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
        'Transition a workflow to a new stage. Validates the transition against the state machine.',
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
      description: 'Record a task result in a workflow file.',
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
            status as 'done' | 'failed' | 'running' | 'pending',
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
      description: 'Record a verification check result in a workflow file.',
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
            status as 'PASS' | 'FAIL' | 'SKIP',
detail || '',
            max_iterations ? Number(max_iterations) : 1,
            1,
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
        'Run a CI command and record the result as a workflow check. ' +
        'Used automatically on verify stage entry when ci_config is present in workflow frontmatter.',
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

// ── Budget-Aware Tool Executor ────────────────────────────────────────────────

export interface Checkpoint {
  version: string;
  created_at: string;
  trigger: string;
  parent: { task_id: string; agent: string; depth: number };
  state: {
    todowrite: unknown[];
    workflow_stage: string;
    iteration: number;
    artifacts_modified: string[];
    decisions: unknown[];
  };
  context_summary: string;
  resume_instructions: string;
  child_tasks: unknown[];
}

export function createBudgetAwareToolExecutor(
  baseTools: ToolRegistry,
  projectRoot: string,
  makeCheckpoint: (sessionId: string) => Checkpoint,
): ToolRegistry {
  const wrapped: ToolRegistry = {};

  for (const [name, tool] of Object.entries(baseTools)) {
    wrapped[name] = {
      ...tool,
      async execute(args: Record<string, unknown>, context?: ToolExecutionContext) {
        // In a full implementation, this would check token budget and create checkpoints
        // For now, just execute the tool
        return tool.execute(args, context);
      },
    };
  }

  return wrapped;
}

// ── Skills Sync ───────────────────────────────────────────────────────────────

export interface SkillFile {
  name: string;
  path: string;
  content: string;
}

export interface SyncedSkill {
  name: string;
  files: SkillFile[];
}

export async function syncBuiltinSkills(targetDir: string): Promise<SyncedSkill[]> {
  const sourceDir = join(__dirname, '../../spec/skills');
  const synced: SyncedSkill[] = [];

  async function copySkillEntry(sourcePath: string, targetPath: string, output: SkillFile[]): Promise<void> {
    const stat = await fs.stat(sourcePath);
    if (stat.isDirectory()) {
      await fs.mkdir(targetPath, { recursive: true });
      const children = await fs.readdir(sourcePath);
      for (const child of children) {
        await copySkillEntry(join(sourcePath, child), join(targetPath, child), output);
      }
      return;
    }

    const content = await fs.readFile(sourcePath, 'utf-8');
    await fs.mkdir(dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, content, 'utf-8');
    output.push({ name: targetPath.slice(targetPath.lastIndexOf('/') + 1), path: targetPath, content });
  }

  try {
    const skillDirs = await fs.readdir(sourceDir);

    for (const skillName of skillDirs) {
      const skillSourceDir = join(sourceDir, skillName);
      const stat = await fs.stat(skillSourceDir);
      if (!stat.isDirectory()) continue;

      const skillTargetDir = join(targetDir, skillName);
      await fs.mkdir(skillTargetDir, { recursive: true });

      const files = await fs.readdir(skillSourceDir);
      const skillFiles: SkillFile[] = [];

      for (const file of files) {
        const sourcePath = join(skillSourceDir, file);
        const targetPath = join(skillTargetDir, file);
        await copySkillEntry(sourcePath, targetPath, skillFiles);
      }

      synced.push({ name: skillName, files: skillFiles });
    }
  } catch (err) {
    // Skills directory might not exist
    console.warn('[tori-core] Failed to sync builtin skills:', (err as Error).message);
  }

  return synced;
}   
