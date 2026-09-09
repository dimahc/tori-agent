import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { buildRuntimePaths, type RuntimeId } from "@tori-agent/ontology";
import {
  governAssistantOutputText,
  createAuthorizedToolExecutor,
  buildReadOnlyTools,
  buildWriteTools,
  createBudgetAwareToolExecutor,
  initializeOntologyRuntime,
  registerToolInLazyRegistry,
  SessionTitleTracker,
} from "@tori-agent/core";
import type {
  AssistantOutputMutation,
  PluginInput,
  PluginOutput,
  SessionAgentHookInput,
  SessionAgentMutation,
  SessionTitleHookInput,
  SessionTitleMutation,
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
    const sessionTitleTracker = new SessionTitleTracker();

    const resolveSessionAgent = async (
      message: SessionAgentHookInput,
      output: SessionAgentMutation,
    ): Promise<void> => {
      const binding = ontologyRuntime.bindSessionToDefaultMainAgent(message.sessionID, runtime);
      output.agent = binding.agent;
      output.agentId = binding.agentId;
      output.authoritative = binding.authoritative;
      output.source = binding.source;
    };

    for (const [name, tool] of Object.entries(tools)) {
      registerToolInLazyRegistry(name, "core", tool.description, tool.args, tool.execute);
    }

    const resolveSessionTitle = async (message: SessionTitleHookInput, output?: SessionTitleMutation): Promise<void> => {
      const proposal = sessionTitleTracker.observe({
        sessionID: message.sessionID,
        role: message.role,
        message: message.message,
        currentTitle: message.currentTitle,
      });
      if (!output || !proposal.shouldRename || !proposal.title) return;
      output.title = proposal.title;
      output.shouldRename = true;
      output.source = proposal.source;
    };

    const inspectAssistantOutput = async (
      message: { sessionID: string; agent?: string; text: string; attempt?: number },
      output: AssistantOutputMutation,
    ): Promise<void> => {
      if (message.agent) ontologyRuntime.bindSession(message.sessionID, message.agent);
      const agentId = ontologyRuntime.getBoundAgent(message.sessionID);
      if (!agentId) {
        output.status = "block";
        output.reason = `Session ${message.sessionID} not bound to ontology agent`;
        return;
      }
      const decision = governAssistantOutputText(
        message.text,
        ontologyRuntime.getOutputGovernancePolicy(agentId),
        message.attempt ?? 0,
      );
      output.status = decision.action === "allow" || decision.action === "rewrite" ? "allow" : decision.action;
      if (decision.text !== undefined) output.text = decision.text;
      if (decision.reason) output.reason = decision.reason;
      if (decision.action === "allow" && decision.text === undefined) output.text = message.text;
    };

    return {
      config: async (config) => {
        return ontologyRuntime.integrateHostConfig(runtime, config);
      },
      tool: tools as Record<string, unknown>,
      event: async ({ event, sessionID, agent }, output) => {
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
        const resolvedSessionID = event.sessionID ?? sessionID;
        if (resolvedSessionID && output) {
          await resolveSessionAgent({ sessionID: resolvedSessionID, agent: event.agent ?? agent }, output);
        }
      },
      "session.agent": async (message, output) => {
        await resolveSessionAgent(message, output);
      },
      "chat.message": async (message, output) => {
        ontologyRuntime.bindSession(message.sessionID, message.agent);
        await resolveSessionTitle(message, output);
      },
      "session.title": async (message, output) => {
        await resolveSessionTitle(message, output);
      },
      "assistant.output": async (message, output) => {
        await inspectAssistantOutput(message, output);
      },
      "permission.ask": async (request, output) => {
        const decision = ontologyRuntime.authorizeSession(request.sessionID, request.type, request.pattern, runtimePaths);
        output.status = decision.effect;
        output.reason = decision.reason;
      },
    };
  };
}
