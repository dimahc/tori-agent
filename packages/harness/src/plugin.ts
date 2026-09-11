import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { buildRuntimePaths, type RuntimeId } from "@tori-agent/ontology";
import {
  createAuthorizedToolExecutor,
  buildReadOnlyTools,
  buildWriteTools,
  createBudgetAwareToolExecutor,
  deriveNativeMutationAuthorizationPattern,
  ensureToolRegistryRegistered,
  initializeOntologyRuntime,
  normalizeOfficialPermissionName,
  sanitizeAssistantOutputText,
} from "@tori-agent/core";
import type {
  ChatMessageHookInput,
  ChatMessageHookOutput,
  ConfigLike,
  ExperimentalTextCompleteHookOutput,
  PluginInput,
  PluginOutput,
  PermissionAskHookInput,
  PermissionAskHookOutput,
  ToolExecuteBeforeHookOutput,
} from "./types.js";

interface CachedPluginSetup {
  readonly runtimePaths: ReturnType<typeof buildRuntimePaths>;
  readonly ontologyRuntime: Awaited<ReturnType<typeof initializeOntologyRuntime>>;
  readonly tools: Record<string, unknown>;
  readonly config: (config: ConfigLike) => Promise<void>;
  readonly event: PluginOutput["event"];
  readonly chatMessage: PluginOutput["chat.message"];
  readonly permissionAsk: PluginOutput["permission.ask"];
  readonly toolExecuteBefore: PluginOutput["tool.execute.before"];
  readonly textComplete: PluginOutput["experimental.text.complete"];
}

const pluginSetupCache = new Map<string, Promise<CachedPluginSetup>>();

function firstNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function eventSessionID(properties?: Record<string, unknown>): string | undefined {
  const direct = firstNonEmptyString(properties?.sessionID);
  if (direct) return direct;
  const info = properties?.info;
  if (!info || typeof info !== "object" || Array.isArray(info)) return undefined;
  return firstNonEmptyString((info as Record<string, unknown>).id);
}

function eventSessionAgent(properties?: Record<string, unknown>): string | undefined {
  const info = properties?.info;
  if (info && typeof info === "object" && !Array.isArray(info)) {
    const agent = firstNonEmptyString((info as Record<string, unknown>).agent);
    if (agent) return agent;
  }
  return firstNonEmptyString(properties?.agent);
}

export function buildPlugin(options: { runtime?: RuntimeId; configPath?: string } = {}) {
  const runtime = options.runtime ?? "opencode";
  const configPath = options.configPath ?? "";

  return async (input: PluginInput): Promise<PluginOutput> => {
    const projectRoot = input.worktree && input.worktree !== "/" ? input.worktree : input.directory ?? ".";
    const configDir = configPath ? dirname(configPath) : join(projectRoot, runtime === "opencode" ? ".opencode" : ".kilocode");
    const setup = await getCachedPluginSetup(projectRoot, runtime, configDir);

    return {
      config: setup.config,
      tool: setup.tools,
      event: setup.event,
      "chat.message": setup.chatMessage,
      "permission.ask": setup.permissionAsk,
      "tool.execute.before": setup.toolExecuteBefore,
      "experimental.text.complete": setup.textComplete,
    };
  };
}

function pluginSetupKey(projectRoot: string, runtime: RuntimeId, configDir: string): string {
  const runtimePaths = buildRuntimePaths(projectRoot, runtime, configDir);
  return JSON.stringify({
    projectRoot,
    runtime,
    configDir,
    runtimeRoot: runtimePaths.runtimeRoot,
    ontologyDir: runtimePaths.ontologyDir,
    skillsDir: runtimePaths.skillsDir,
  });
}

async function getCachedPluginSetup(projectRoot: string, runtime: RuntimeId, configDir: string): Promise<CachedPluginSetup> {
  const key = pluginSetupKey(projectRoot, runtime, configDir);
  let pending = pluginSetupCache.get(key);
  if (!pending) {
    pending = createPluginSetup(projectRoot, runtime, configDir);
    pluginSetupCache.set(key, pending);
  }
  return pending;
}

async function createPluginSetup(projectRoot: string, runtime: RuntimeId, configDir: string): Promise<CachedPluginSetup> {
  const runtimePaths = buildRuntimePaths(projectRoot, runtime, configDir);
  const ontologyRuntime = await initializeOntologyRuntime({ runtimePaths });
  let runtimeDirsReady: Promise<void> | null = null;
  const readOnlyTools = buildReadOnlyTools(projectRoot, runtimePaths);
  const writeTools = buildWriteTools(projectRoot, runtimePaths, runtime);
  const tools = createAuthorizedToolExecutor(
    createBudgetAwareToolExecutor({ ...readOnlyTools, ...writeTools }, { ontologyRuntime, runtimePaths }),
    { ontologyRuntime, projectRoot, runtimePaths },
  );
  const nativeBudgetTools = createBudgetAwareToolExecutor({
    read: {
      description: "native read loop guard",
      args: {},
      async execute() {
        return "native-tool-authorized";
      },
    },
    glob: {
      description: "native glob loop guard",
      args: {},
      async execute() {
        return "native-tool-authorized";
      },
    },
    grep: {
      description: "native grep loop guard",
      args: {},
      async execute() {
        return "native-tool-authorized";
      },
    },
    bash: {
      description: "native bash loop guard",
      args: {},
      async execute() {
        return "native-tool-authorized";
      },
    },
    write: {
      description: "native write loop guard",
      args: {},
      async execute() {
        return "native-tool-authorized";
      },
    },
    edit: {
      description: "native edit loop guard",
      args: {},
      async execute() {
        return "native-tool-authorized";
      },
    },
  }, { ontologyRuntime, runtimePaths });
  ensureToolRegistryRegistered(tools);

  const ensureRuntimeDirs = async (): Promise<void> => {
    if (!runtimeDirsReady) {
      runtimeDirsReady = Promise.all([
        mkdir(runtimePaths.runtimeRoot, { recursive: true }),
        mkdir(runtimePaths.specsDir, { recursive: true }),
        mkdir(runtimePaths.briefsDir, { recursive: true }),
        mkdir(runtimePaths.execPlansDir, { recursive: true }),
        mkdir(runtimePaths.workflowsDir, { recursive: true }),
        mkdir(runtimePaths.checkpointsDir, { recursive: true }),
        mkdir(runtimePaths.skillsDir, { recursive: true }),
      ]).then(() => undefined);
      runtimeDirsReady.catch(() => {
        runtimeDirsReady = null;
      });
    }
    await runtimeDirsReady;
  };

  const bindSessionFromChatMessage = async (message: ChatMessageHookInput, _output: ChatMessageHookOutput): Promise<void> => {
    const agent = eventSessionAgent(message as unknown as Record<string, unknown>);
    if (agent) ontologyRuntime.bindSession(message.sessionID, agent);
  };

  const handlePermissionAsk = async (request: PermissionAskHookInput, output: PermissionAskHookOutput): Promise<void> => {
    const permission = normalizeOfficialPermissionName(request.permission);
    if (!ontologyRuntime.isOntologyGovernedToolName(permission)) return;
    const decision = ontologyRuntime.authorizeSession(request.sessionID, permission, request.patterns, runtimePaths);
    output.status = decision.effect;
  };

  function toProjectRelativePatterns(pattern: string | string[] | undefined, projectRoot: string): string | string[] | undefined {
  if (typeof pattern !== "string" || !isAbsolute(pattern)) return pattern;
  const located = relative(projectRoot, resolve(projectRoot, pattern));
  return located !== "" && !isAbsolute(located) && !located.startsWith("..") ? located : pattern;
}

const enforceNativeToolExecution = async (
    input: { tool: string; sessionID: string },
    output: ToolExecuteBeforeHookOutput,
  ): Promise<void> => {
    const toolName = normalizeOfficialPermissionName(input.tool);
    if (!["read", "glob", "grep", "bash", "write", "edit"].includes(toolName)) return;
    if (!ontologyRuntime.isOntologyGovernedToolName(toolName)) return;
    const pattern = deriveNativeMutationAuthorizationPattern(toolName, output.args);
    const decision = ontologyRuntime.authorizeSession(
      input.sessionID,
      toolName,
      toProjectRelativePatterns(pattern, projectRoot),
      runtimePaths,
    );
    if (decision.effect === "deny") {
      throw new Error(`Unauthorized native tool execution for ${toolName}: ${decision.reason}`);
    }
    await nativeBudgetTools[toolName]?.execute?.((output.args ?? {}) as Record<string, unknown>, {
      sessionID: input.sessionID,
      directory: projectRoot,
    });
  };

  const rewriteAssistantText = async (
    input: { sessionID: string },
    output: ExperimentalTextCompleteHookOutput,
  ): Promise<void> => {
    if (typeof output.text !== "string") return;
    const agentId = ontologyRuntime.getBoundAgent(input.sessionID);
    const policy = agentId ? ontologyRuntime.getOutputGovernancePolicy(agentId) : undefined;
    output.text = sanitizeAssistantOutputText(output.text, policy).text;
  };

  const event: PluginOutput["event"] = async ({ event }) => {
    if (event.type === "session.created") {
      const sessionID = eventSessionID(event.properties);
      const agent = eventSessionAgent(event.properties);
      if (sessionID) {
        if (agent) {
          ontologyRuntime.bindSession(sessionID, agent);
        } else if (!ontologyRuntime.getBoundAgent(sessionID)) {
          ontologyRuntime.bindSessionToDefaultMainAgent(sessionID, runtime);
        }
      }
      await ensureRuntimeDirs();
      return;
    }

    if (event.type === "session.updated") {
      const sessionID = eventSessionID(event.properties);
      if (!sessionID) return;
      const agent = eventSessionAgent(event.properties);
      if (agent) {
        ontologyRuntime.bindSession(sessionID, agent);
        return;
      }
      return;
    }

    if (event.type === "session.next.agent.switched") {
      const sessionID = eventSessionID(event.properties);
      if (!sessionID) return;
      const agent = eventSessionAgent(event.properties);
      if (agent) {
        ontologyRuntime.bindSession(sessionID, agent);
        return;
      }
      return;
    }
  };

  return {
    runtimePaths,
    ontologyRuntime,
    tools: tools as Record<string, unknown>,
    config: async (config: ConfigLike) => {
      await ontologyRuntime.integrateHostConfigInPlace(runtime, config);
    },
    event,
    chatMessage: bindSessionFromChatMessage,
    permissionAsk: handlePermissionAsk,
    toolExecuteBefore: enforceNativeToolExecution,
    textComplete: rewriteAssistantText,
  };
}
