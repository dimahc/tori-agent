import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { buildRuntimePaths, type RuntimeId } from "@tori-agent/ontology";
import {
  buildReadOnlyTools,
  buildWriteTools,
  createBudgetAwareToolExecutor,
  initializeOntologyRuntime,
  registerToolInLazyRegistry,
  syncBuiltinSkills,
} from "@tori-agent/core";
import type { PluginInput, PluginOutput } from "./types.js";

export function buildPlugin(options: { runtime?: RuntimeId; configPath?: string } = {}) {
  const runtime = options.runtime ?? "opencode";
  const configPath = options.configPath ?? "";

  return async (input: PluginInput): Promise<PluginOutput> => {
    const projectRoot = input.worktree && input.worktree !== "/" ? input.worktree : input.directory ?? ".";
    const configDir = configPath ? dirname(configPath) : join(projectRoot, runtime === "opencode" ? ".opencode" : ".kilocode");
    const runtimePaths = buildRuntimePaths(projectRoot, runtime, configDir);
    const ontologyRuntime = await initializeOntologyRuntime();

    await syncBuiltinSkills(runtimePaths.skillsDir);

    const readOnlyTools = buildReadOnlyTools(projectRoot, runtimePaths, runtimePaths.skillsDir);
    const writeTools = buildWriteTools(projectRoot, runtimePaths, runtime);
    const tools = createBudgetAwareToolExecutor({ ...readOnlyTools, ...writeTools });

    for (const [name, tool] of Object.entries(tools)) {
      registerToolInLazyRegistry(name, "core", tool.description, tool.args, tool.execute);
    }

    return {
      config: async (config) => {
        const compiled = await ontologyRuntime.buildRuntimeAgentConfigs(runtime);
        const existing = (config.agent ?? {}) as Record<string, unknown>;
        config.agent = { ...existing, ...compiled };
        return config;
      },
      tool: tools as Record<string, unknown>,
      event: async ({ event }) => {
        if (event.type !== "session.created") return;
        await Promise.all([
          mkdir(runtimePaths.runtimeRoot, { recursive: true }),
          mkdir(runtimePaths.ontologyDir, { recursive: true }),
          mkdir(runtimePaths.specsDir, { recursive: true }),
          mkdir(runtimePaths.briefsDir, { recursive: true }),
          mkdir(runtimePaths.execPlansDir, { recursive: true }),
          mkdir(runtimePaths.workflowsDir, { recursive: true }),
          mkdir(runtimePaths.checkpointsDir, { recursive: true }),
        ]);
      },
      "chat.message": async ({ sessionID, agent }) => {
        ontologyRuntime.bindSession(sessionID, agent);
      },
      "permission.ask": async (request, output) => {
        const decision = ontologyRuntime.authorizeSession(request.sessionID, request.type, request.pattern, runtimePaths);
        output.status = decision.effect;
      },
    };
  };
}
