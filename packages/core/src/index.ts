// Runtime detection (Seam 1)
export { detectRuntime } from './runtime/detect.js';
export type { Runtime } from './runtime/detect.js';

// SDK adapters — thin wrappers over host SDKs
export { createConversationClient } from './runtime/sdk-adapter.js';

// Plugin builder — creates a V2-style plugin function
export { buildPlugin } from './plugin/index.js';
export type { PluginInput, PluginOutput } from './plugin/index.js';

// Standalone default export — allows @tori-agent/core to be loaded directly
// as an opencode plugin without going through a runtime adapter.
import { buildPlugin as _buildPlugin, type PluginInput } from './plugin/index.js';
import { detectRuntime as _detectRuntime } from './runtime/detect.js';

export default async function (input: PluginInput) {
  const runtime = input.runtime ?? _detectRuntime();
  const pluginFn = _buildPlugin({ runtime, configPath: input.configPath ?? '' });
  return await pluginFn(input);
}

// Agent registration helpers — host-native tools/permission shaping
export { buildToolsMap, buildHostPermission, evaluatePermission } from './plugin/agents.js';

// Lifecycle tools — deterministic bookkeeping operations for exec-plans, specs, briefs
export {
  projectState,
  markBlockDone,
  completePlan,
  registerSpec,
  checkArtifacts,
  runMechanicalChecks,
  executeCheckCommand,
  truncateOutput,
  splitCommandLine,
} from './tools/lifecycle.js';
export type { ArtifactPaths } from './tools/lifecycle.js';

// Codegen — YAML-based agent spec loading and compilation
export { loadAndCompileAllAgents } from './codegen/index.js';

// Codegen — builtin skill discovery and syncing into a host runtime
export { listBuiltinSkills, syncBuiltinSkills } from './codegen/index.js';
export type { BuiltinSkill, SyncedSkill } from './codegen/index.js';

// Session persistence — JSON-file-backed session→agent tracking
export { initSessionStore, trackSessionAgent, agentForSession, clearSession } from './runtime/session-store.js';
