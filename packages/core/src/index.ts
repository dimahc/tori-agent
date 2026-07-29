// Conversation protocol — the central abstraction between the plugin and runtime SDKs
export type { Conversation, Session, SessionOptions, PromptRequest, PromptResponse, SessionEvent } from './conversation/types.js';

// Runtime detection (Seam 1)
export { detectRuntime } from './runtime/detect.js';
export type { Runtime } from './runtime/detect.js';

// Plugin builder — creates a V1-style plugin function from a Conversation adapter
export { buildPlugin } from './plugin/index.js';

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
