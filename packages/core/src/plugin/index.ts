import { readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { CHECK_POLICY, WORKFLOW_STAGE, getToolId, type RuntimeId, type RuntimePaths } from "@tori-agent/ontology";
import type { OntologyRuntime } from "../ontology/runtime.js";
import { initializeOntologyRuntime } from "../ontology/runtime.js";
import { getBuiltinSkillsDir } from "../ontology/paths.js";
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
import { normalizeFailureSignature, normalizeToolInvocationSignature } from "../guardrails/output.js";

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

interface ToolLoopSessionState {
  invocationCounts: Map<string, number>;
  failureCounts: Map<string, number>;
  consecutiveFailures: number;
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

function getOrCreateLoopState(store: Map<string, ToolLoopSessionState>, sessionId: string): ToolLoopSessionState {
  let state = store.get(sessionId);
  if (!state) {
    state = {
      invocationCounts: new Map<string, number>(),
      failureCounts: new Map<string, number>(),
      consecutiveFailures: 0,
    };
    store.set(sessionId, state);
  }
  return state;
}

export function createBudgetAwareToolExecutor(
  baseTools: ToolRegistry,
  options: { ontologyRuntime: OntologyRuntime },
): ToolRegistry {
  const loopStates = new Map<string, ToolLoopSessionState>();
  return Object.fromEntries(
    Object.entries(baseTools).map(([name, tool]) => [
      name,
      {
        ...tool,
        async execute(args: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
          if (!context?.sessionID) {
            throw new Error(`Loop guard requires session context for ${name}`);
          }
          const agentId = context.agent
            ? (options.ontologyRuntime.bindSession(context.sessionID, context.agent), options.ontologyRuntime.getBoundAgent(context.sessionID))
            : options.ontologyRuntime.getBoundAgent(context.sessionID);
          if (!agentId) {
            throw new Error(`Loop guard missing bound agent for session ${context.sessionID}`);
          }

          const policy = options.ontologyRuntime.getPolicyEngine().getExecutionLoopPolicy(agentId, getToolId(name));
          const signature = normalizeToolInvocationSignature(name, args);
          const state = getOrCreateLoopState(loopStates, context.sessionID);
          const nextInvocations = (state.invocationCounts.get(signature) ?? 0) + 1;
          if (typeof policy.max_identical_invocations === "number" && nextInvocations > policy.max_identical_invocations) {
            throw new Error(`Loop guard denied ${name}: identical invocation cap ${policy.max_identical_invocations} exceeded`);
          }
          state.invocationCounts.set(signature, nextInvocations);

          try {
            const result = await tool.execute(args, context);
            state.consecutiveFailures = 0;
            return result;
          } catch (error) {
            state.consecutiveFailures += 1;
            const failureSignature = normalizeFailureSignature(name, args, error);
            const nextFailures = (state.failureCounts.get(failureSignature) ?? 0) + 1;
            state.failureCounts.set(failureSignature, nextFailures);
            if (typeof policy.max_identical_failures === "number" && nextFailures > policy.max_identical_failures) {
              throw new Error(`Loop guard denied ${name}: identical failure cap ${policy.max_identical_failures} exceeded`);
            }
            if (typeof policy.max_consecutive_failures === "number" && state.consecutiveFailures > policy.max_consecutive_failures) {
              throw new Error(`Loop guard denied ${name}: consecutive failure cap ${policy.max_consecutive_failures} exceeded`);
            }
            throw error;
          }
        },
      } satisfies ToolRegistryEntry,
    ]),
  );
}

const NATIVE_MUTATION_TOOLS = new Set(["write", "edit", "bash"]);

function asArgsRecord(args: unknown): Record<string, unknown> {
  return args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
}

function firstStringValue(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof args[key] === "string" && args[key]) return String(args[key]);
  }
  return undefined;
}

export function normalizeOfficialPermissionName(permission: string): string {
  return permission.replace(/^tool[.:]/, "");
}

export function isNativeMutationTool(toolName: string): boolean {
  return NATIVE_MUTATION_TOOLS.has(normalizeOfficialPermissionName(toolName));
}

export function deriveNativeMutationAuthorizationPattern(toolName: string, args: unknown): string | string[] | undefined {
  const normalizedToolName = normalizeOfficialPermissionName(toolName);
  const record = asArgsRecord(args);
  switch (normalizedToolName) {
    case "write":
      return firstStringValue(record, ["filePath", "file", "path"]);
    case "edit":
      return firstStringValue(record, ["filePath", "file", "path"]);
    case "bash": {
      const command = firstStringValue(record, ["command", "cmd"]);
      if (command) return command;
      if (Array.isArray(record.argv) && record.argv.every((entry) => typeof entry === "string")) {
        return (record.argv as string[]).join(" ");
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

function deriveAuthorizationPattern(
  toolName: string,
  args: Record<string, unknown>,
  projectRoot: string,
  runtimePaths: RuntimePaths,
): string | string[] | undefined {
  switch (toolName) {
    case "write_append":
      return typeof args.file === "string" ? args.file : undefined;
    case "mark_block_done":
    case "complete_plan":
      return typeof args.plan_file === "string" ? join(relative(projectRoot, runtimePaths.execPlansDir), String(args.plan_file)) : undefined;
    case "register_spec":
      return typeof args.spec_file === "string" ? join(relative(projectRoot, runtimePaths.specsDir), String(args.spec_file)) : undefined;
    case "save_checkpoint":
      return typeof args.file === "string" ? join(relative(projectRoot, runtimePaths.checkpointsDir), String(args.file)) : undefined;
    case "scratchpad":
      return relative(projectRoot, runtimePaths.scratchpadFile);
    default:
      return undefined;
  }
}

export function createAuthorizedToolExecutor(
  baseTools: ToolRegistry,
  options: { ontologyRuntime: OntologyRuntime; projectRoot: string; runtimePaths: RuntimePaths },
): ToolRegistry {
  return Object.fromEntries(
    Object.entries(baseTools).map(([name, tool]) => [
      name,
      {
        ...tool,
        async execute(args: Record<string, unknown>, context?: ToolExecutionContext): Promise<string> {
          const decision = options.ontologyRuntime.authorizeToolExecution(
            { sessionID: context?.sessionID, agent: context?.agent },
            name,
            deriveAuthorizationPattern(name, args, options.projectRoot, options.runtimePaths),
            options.runtimePaths,
          );
          if (decision.effect !== "allow") {
            throw new Error(`Unauthorized tool execution for ${name}: ${decision.reason}`);
          }
          return tool.execute(args, context);
        },
      } satisfies ToolRegistryEntry,
    ]),
  );
}

async function loadSkillContent(skillsDir: string, name: string): Promise<string> {
  const localPath = join(skillsDir, name, "SKILL.md");
  const builtinPath = join(getBuiltinSkillsDir(), name, "SKILL.md");
  for (const candidate of [localPath, builtinPath]) {
    try {
      return await readFile(candidate, "utf8");
    } catch {
      // fallback
    }
  }
  throw new Error(`Unknown skill ${name}`);
}

export function buildReadOnlyTools(projectRoot: string, runtimePaths: RuntimePaths): ToolRegistry {
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
      description: "Load skill markdown with local override and builtin fallback.",
      args: { name: {} },
      async execute({ name }) {
        if (typeof name !== "string") return JSON.stringify({ error: "name required" });
        return loadSkillContent(runtimePaths.skillsDir, name);
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
        const runtimeApi = await initializeOntologyRuntime({ runtimePaths });
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

export { safeResolve, splitCommandLine, truncateOutput };
