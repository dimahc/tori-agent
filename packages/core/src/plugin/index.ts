import { readFile, stat, mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CHECK_POLICY, WORKFLOW_STAGE, buildRuntimePaths, type RuntimeId, type RuntimePaths } from "@tori-agent/ontology";
import { initializeOntologyRuntime } from "../ontology/runtime.js";
import {
  checkArtifacts,
  completePlan,
  projectState,
  registerSpecImpl,
  runMechanicalChecks,
  saveCheckpoint,
  splitCommandLine,
  truncateOutput,
  writeAppend,
  markBlockDone,
} from "../tools/lifecycle.js";
import {
  createWorkflowRun,
  getWorkflowState,
  recordCheckResult,
  recordTaskResult,
  transitionStage,
} from "../tools/workflow.js";
import { trigger_ci_check } from "../tools/ci-hook.js";
import type { VerificationPolicy } from "../types/verification.js";
import type { CIConfig } from "../types/ci.js";

export interface ToolExecutionContext {
  sessionID: string;
  directory: string;
  worktree?: string;
  agent?: string;
}

export interface ToolRegistryEntry {
  description: string;
  args: Record<string, unknown>;
  execute(args: Record<string, unknown>, context?: ToolExecutionContext): Promise<string>;
}

export interface ToolRegistry {
  [name: string]: ToolRegistryEntry;
}

interface LazyToolMeta extends ToolRegistryEntry {
  name: string;
  category: string;
}

const lazyRegistry = new Map<string, LazyToolMeta>();

export function registerLazyTool(meta: LazyToolMeta): void {
  lazyRegistry.set(meta.name, meta);
}

export function getLazyTool(name: string): LazyToolMeta | undefined {
  return lazyRegistry.get(name);
}

export function getAllLazyTools(): LazyToolMeta[] {
  return Array.from(lazyRegistry.values());
}

export function registerToolInLazyRegistry(
  name: string,
  category: string,
  description: string,
  args: Record<string, unknown>,
  execute: ToolRegistryEntry["execute"],
): void {
  registerLazyTool({ name, category, description, args, execute });
}

export function buildDiscoveryTools(): Record<string, ToolRegistryEntry> {
  return {
    list_available_tools: {
      description: "List available tool names and categories.",
      args: {},
      async execute() {
        return JSON.stringify({ tools: getAllLazyTools().map(({ name, category }) => ({ name, category })), total: lazyRegistry.size });
      },
    },
    load_tools: {
      description: "Return lazy registry entries for requested tools. No dynamic loading.",
      args: { categories: {}, names: {} },
      async execute({ categories, names }) {
        const categorySet = new Set(Array.isArray(categories) ? categories : categories ? [categories] : []);
        const nameSet = new Set(Array.isArray(names) ? names : names ? [names] : []);
        const matches = getAllLazyTools().filter((tool) =>
          (categorySet.size === 0 || categorySet.has(tool.category)) &&
          (nameSet.size === 0 || nameSet.has(tool.name)),
        );
        return JSON.stringify({ tools: matches.map(({ name, category, description, args }) => ({ name, category, description, args })) });
      },
    },
  };
}

function safeResolve(projectRoot: string, relPath: string): string {
  const resolved = resolve(projectRoot, relPath);
  const normalizedRoot = resolve(projectRoot) + sep;
  if (!resolved.startsWith(normalizedRoot) && resolved !== resolve(projectRoot)) {
    throw new Error(`Path escapes project root: ${relPath}`);
  }
  return resolved;
}

export async function syncBuiltinSkills(targetDir: string): Promise<Array<{ name: string; files: string[] }>> {
  const sourceDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "spec", "skills");
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir).catch(() => []);
  const copied: Array<{ name: string; files: string[] }> = [];

  async function copyTree(sourcePath: string, targetPath: string, relativePrefix = ""): Promise<string[]> {
    const entryStat = await stat(sourcePath);
    if (entryStat.isDirectory()) {
      await mkdir(targetPath, { recursive: true });
      const children = await readdir(sourcePath);
      const copiedFiles: string[] = [];
      for (const child of children) {
        const childRelative = relativePrefix ? join(relativePrefix, child) : child;
        copiedFiles.push(...await copyTree(join(sourcePath, child), join(targetPath, child), childRelative));
      }
      return copiedFiles;
    }
    const content = await readFile(sourcePath, "utf8");
    await writeFile(targetPath, content, "utf8");
    return [relativePrefix];
  }

  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry);
    const entryStat = await stat(sourcePath);
    if (!entryStat.isDirectory()) continue;
    const targetPath = join(targetDir, entry);
    const copiedFiles = await copyTree(sourcePath, targetPath);
    copied.push({ name: entry, files: copiedFiles });
  }
  return copied;
}

export function createBudgetAwareToolExecutor(baseTools: ToolRegistry): ToolRegistry {
  return baseTools;
}

export function buildReadOnlyTools(projectRoot: string, runtimePaths: RuntimePaths, skillsDir: string): ToolRegistry {
  return {
    project_state: {
      description: "Return ontology-managed artifact state.",
      args: {},
      async execute() {
        return JSON.stringify(await projectState(projectRoot, runtimePaths));
      },
    },
    check_artifacts: {
      description: "Run ontology cross-artifact consistency scan.",
      args: {},
      async execute() {
        return JSON.stringify(await checkArtifacts(projectRoot, runtimePaths));
      },
    },
    run_mechanical_checks: {
      description: "Run AGENTS.md review checks mechanically.",
      args: {},
      async execute() {
        return JSON.stringify(await runMechanicalChecks(projectRoot));
      },
    },
    workflow_state: {
      description: "Read ontology-native workflow state.",
      args: { workflow_id: {} },
      async execute({ workflow_id }) {
        if (typeof workflow_id !== "string") return JSON.stringify({ error: "workflow_id required" });
        const state = await getWorkflowState(runtimePaths, workflow_id);
        return JSON.stringify(state ?? { error: `workflow not found: ${workflow_id}` });
      },
    },
    skill: {
      description: "Load builtin skill markdown.",
      args: { name: {} },
      async execute({ name }) {
        if (typeof name !== "string") return JSON.stringify({ error: "name required" });
        return readFile(join(skillsDir, name, "SKILL.md"), "utf8");
      },
    },
    ...buildDiscoveryTools(),
  };
}

async function resolveArtifactIdForManagedFile(runtimePaths: RuntimePaths, planFile: string): Promise<string | null> {
  const candidate = join(runtimePaths.execPlansDir, planFile);
  try {
    const content = await readFile(candidate, "utf8");
    const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) return null;
    const artifactIdMatch = match[1].match(/^artifact_id:\s*(.+)$/m);
    return artifactIdMatch ? artifactIdMatch[1].trim() : null;
  } catch {
    return null;
  }
}

export function buildWriteTools(
  projectRoot: string,
  runtimePaths: RuntimePaths,
  runtime: RuntimeId,
): ToolRegistry {
  return {
    mark_block_done: {
      description: "Check exec-plan block.",
      args: { plan_file: {}, block_name: {} },
      async execute({ plan_file, block_name }) {
        return JSON.stringify(await markBlockDone(projectRoot, runtimePaths, String(plan_file), String(block_name)));
      },
    },
    complete_plan: {
      description: "Set exec-plan status to completed when blocks done.",
      args: { plan_file: {} },
      async execute({ plan_file }) {
        return JSON.stringify(await completePlan(projectRoot, runtimePaths, String(plan_file)));
      },
    },
    register_spec: {
      description: "Create managed spec artifact.",
      args: { spec_file: {}, title: {} },
      async execute({ spec_file, title }) {
        return JSON.stringify(await registerSpecImpl(projectRoot, runtimePaths, String(spec_file), String(title)));
      },
    },
    write_append: {
      description: "Append content to file inside project root.",
      args: { file: {}, content: {} },
      async execute({ file, content }) {
        return JSON.stringify(await writeAppend(projectRoot, String(file), String(content)));
      },
    },
    save_checkpoint: {
      description: "Persist ontology checkpoint.",
      args: { file: {}, summary: {}, remaining_work: {} },
      async execute({ file, summary, remaining_work }) {
        return JSON.stringify(await saveCheckpoint(projectRoot, runtimePaths, String(file), String(summary), String(remaining_work)));
      },
    },
    scratchpad: {
      description: "Append scratchpad entry in runtime root.",
      args: { section: {}, content: {} },
      async execute({ section, content }) {
        const entry = `\n## ${String(section)}\n${String(content)}\n`;
        return JSON.stringify(await writeAppend(projectRoot, runtimePaths.scratchpadFile.replace(`${projectRoot}/`, ""), entry));
      },
    },
    transition_stage: {
      description: "Apply ontology transition semantics to workflow run.",
      args: { workflow_id: {}, to_stage: {}, policy: {} },
      async execute({ workflow_id, to_stage, policy }) {
        const runtimeApi = await initializeOntologyRuntime();
        const parsed = typeof policy === "string" && policy ? (JSON.parse(policy) as VerificationPolicy) : undefined;
        return JSON.stringify(await transitionStage(runtimePaths, runtimeApi, String(workflow_id), String(to_stage), parsed));
      },
    },
    record_task_result: {
      description: "Persist ontology task record.",
      args: { workflow_id: {}, task_id: {}, agent: {}, status: {}, plan_file: {}, block_name: {}, detail: {} },
      async execute({ workflow_id, task_id, agent, status, plan_file, block_name, detail }) {
        const related = typeof plan_file === "string" && plan_file ? [await resolveArtifactIdForManagedFile(runtimePaths, plan_file)].filter((value): value is string => Boolean(value)) : [];
        return JSON.stringify(await recordTaskResult(runtimePaths, String(workflow_id), String(task_id), String(agent), String(status), related, block_name ? String(block_name) : undefined, detail ? String(detail) : undefined));
      },
    },
    record_check_result: {
      description: "Persist ontology check record.",
      args: { workflow_id: {}, check_name: {}, status: {}, detail: {}, policy: {} },
      async execute({ workflow_id, check_name, status, detail, policy }) {
        return JSON.stringify(await recordCheckResult(runtimePaths, String(workflow_id), String(check_name), String(status), String(detail ?? ""), String(policy ?? CHECK_POLICY.blocking)));
      },
    },
    trigger_ci_check: {
      description: "Run CI command and persist result.",
      args: { workflow_id: {}, config: {} },
      async execute({ workflow_id, config }) {
        const parsed = typeof config === "string" ? (JSON.parse(config) as CIConfig) : (config as CIConfig);
        return JSON.stringify(await trigger_ci_check(projectRoot, runtimePaths, parsed, String(workflow_id)));
      },
    },
  };
}

export async function createInitialWorkflowIfMissing(runtimePaths: RuntimePaths, workflowRunId: string): Promise<void> {
  const current = await getWorkflowState(runtimePaths, workflowRunId);
  if (!current) {
    await createWorkflowRun(runtimePaths, workflowRunId, undefined, WORKFLOW_STAGE.requirements);
  }
}

export { buildRuntimePaths, safeResolve, splitCommandLine, truncateOutput };
