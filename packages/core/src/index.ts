// Runtime detection (Seam 1)
export { detectRuntime } from './runtime/detect.js';
export type { Runtime } from './runtime/detect.js';

// Plugin builder — creates a V2-style plugin function
export { buildPlugin } from './plugin/index.js';

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
