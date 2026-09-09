import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { buildRuntimePaths, type RuntimeId } from "@tori-agent/ontology";
import {
  createAuthorizedToolExecutor,
  buildReadOnlyTools,
  buildWriteTools,
  createBudgetAwareToolExecutor,
  deriveNativeMutationAuthorizationPattern,
  isNativeMutationTool,
  initializeOntologyRuntime,
  normalizeOfficialPermissionName,
  registerToolInLazyRegistry,
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

export function buildPlugin(options: { runtime?: RuntimeId; configPath?: string } = {}) {
  const runtime = options.runtime ?? "opencode";
  const configPath = options.configPath ?? "";

  return async (input: PluginInput): Promise<PluginOutput> => {
    const projectRoot = input.worktree && input.worktree !== "/" ? input.worktree : input.directory ?? ".";
    const configDir = configPath ? dirname(configPath) : join(projectRoot, runtime === "opencode" ? ".opencode" : ".kilocode");
    const runtimePaths = buildRuntimePaths(projectRoot, runtime, configDir);
    const ontologyRuntime = await initializeOntologyRuntime({ runtimePaths });

    const readOnlyTools = buildReadOnlyTools(projectRoot, runtimePaths);
    const writeTools = buildWriteTools(projectRoot, runtimePaths, runtime);
    const tools = createAuthorizedToolExecutor(
      createBudgetAwareToolExecutor({ ...readOnlyTools, ...writeTools }, { ontologyRuntime }),
      { ontologyRuntime, projectRoot, runtimePaths },
    );

    for (const [name, tool] of Object.entries(tools)) {
      registerToolInLazyRegistry(name, "core", tool.description, tool.args, tool.execute);
    }

    const bindSessionFromChatMessage = async (message: ChatMessageHookInput, _output: ChatMessageHookOutput): Promise<void> => {
      if (message.agent) ontologyRuntime.bindSession(message.sessionID, message.agent);
    };

    const handlePermissionAsk = async (request: PermissionAskHookInput, output: PermissionAskHookOutput): Promise<void> => {
      const permission = normalizeOfficialPermissionName(request.permission);
      if (!ontologyRuntime.isOntologyGovernedToolName(permission)) return;
      const decision = ontologyRuntime.authorizeSession(request.sessionID, permission, request.patterns, runtimePaths);
      output.status = decision.effect;
    };

    const enforceNativeToolExecution = async (
      input: { tool: string; sessionID: string },
      output: ToolExecuteBeforeHookOutput,
    ): Promise<void> => {
      const toolName = normalizeOfficialPermissionName(input.tool);
      if (!isNativeMutationTool(toolName)) return;
      const decision = ontologyRuntime.authorizeSession(
        input.sessionID,
        toolName,
        deriveNativeMutationAuthorizationPattern(toolName, output.args),
        runtimePaths,
      );
      if (decision.effect !== "allow") {
        throw new Error(`Unauthorized native tool execution for ${toolName}: ${decision.reason}`);
      }
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

    return {
      config: async (config: ConfigLike) => {
        await ontologyRuntime.integrateHostConfigInPlace(runtime, config);
      },
      tool: tools as Record<string, unknown>,
      event: async ({ event }) => {
        if (event.type !== "session.created") return;
        await Promise.all([
          mkdir(runtimePaths.runtimeRoot, { recursive: true }),
          mkdir(runtimePaths.specsDir, { recursive: true }),
          mkdir(runtimePaths.briefsDir, { recursive: true }),
          mkdir(runtimePaths.execPlansDir, { recursive: true }),
          mkdir(runtimePaths.workflowsDir, { recursive: true }),
          mkdir(runtimePaths.checkpointsDir, { recursive: true }),
          mkdir(runtimePaths.skillsDir, { recursive: true }),
        ]);
        const resolvedSessionID = typeof event.properties?.sessionID === "string" ? event.properties.sessionID : undefined;
        if (resolvedSessionID) ontologyRuntime.unbindSession(resolvedSessionID);
      },
      "chat.message": async (message, output) => {
        await bindSessionFromChatMessage(message, output);
      },
      "permission.ask": async (request, output) => {
        await handlePermissionAsk(request, output);
      },
      "tool.execute.before": async (input, output) => {
        await enforceNativeToolExecution(input, output);
      },
      "experimental.text.complete": async (input, output) => {
        await rewriteAssistantText(input, output);
      },
    };
  };
}
