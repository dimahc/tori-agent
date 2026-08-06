export type Runtime = 'opencode' | 'kilocode';

/**
 * Detect which runtime is loading the plugin.
 * Prefers explicit env var over any heuristic.
 */
export function detectRuntime(): Runtime {
  const env = process.env.TORI_RUNTIME;
  if (env === 'opencode' || env === 'kilocode') return env;

  // Last resort: heuristic (only used in dev)
  if (typeof process !== 'undefined' && process.argv?.some(a => a.includes('opencode'))) return 'opencode';
  if (typeof process !== 'undefined' && process.argv?.some(a => a.includes('kilocode'))) return 'kilocode';

  // Default to opencode for backwards compatibility
  return 'opencode';
}
