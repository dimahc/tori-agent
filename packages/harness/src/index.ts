/**
 * @file packages/harness/src/index.ts
 * @description Unified Tori Agent Runtime - Works for OpenCode and KiloCode.
 *
 * This is the single runtime entry point. It uses the OntologyRuntime
 * from core to provide the plugin interface for both runtimes.
 *
 * The runtime detects which environment it's running in (OpenCode vs KiloCode)
 * and loads the appropriate configuration.
 */

import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { PluginInput, PluginOutput } from './types.js';
import { buildPlugin } from './plugin.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Detect the runtime environment.
 */
export function detectRuntime(): 'opencode' | 'kilocode' {
  // Check environment variable first
  const envRuntime = process.env.TORI_RUNTIME;
  if (envRuntime === 'opencode' || envRuntime === 'kilocode') {
    return envRuntime;
  }

  // Check for config files
  const projectRoot = join(__dirname, '../../../');
  const opencodeConfig = join(projectRoot, '.opencode', 'AGENTS.md');
  const kilocodeConfig = join(projectRoot, '.kilocode', 'AGENTS.md');
  const kiloConfig = join(projectRoot, '.kilo', 'AGENTS.md');

  if (existsSync(opencodeConfig)) return 'opencode';
  if (existsSync(kilocodeConfig) || existsSync(kiloConfig)) return 'kilocode';

  // Default to opencode
  return 'opencode';
}

/**
 * Detect the configuration directory for the current runtime.
 */
export function detectConfigDir(runtime: 'opencode' | 'kilocode'): string {
  const projectRoot = join(__dirname, '../../../');
  const homeDir = homedir();

  const candidates: string[] = [];

  if (runtime === 'opencode') {
    candidates.push(
      join(projectRoot, '.opencode'),
      join(homeDir, '.config', 'opencode')
    );
  } else {
    candidates.push(
      join(projectRoot, '.kilocode'),
      join(projectRoot, '.kilo'),
      join(homeDir, '.config', 'kilocode'),
      join(homeDir, '.config', 'kilo')
    );
  }

  const detected = candidates.find(d => existsSync(d)) ?? candidates[candidates.length - 1];
  return detected;
}

/**
 * Build the plugin for the detected or specified runtime.
 */
export async function createRuntimePlugin(
  options: { runtime?: 'opencode' | 'kilocode'; configPath?: string } = {}
): Promise<(input: PluginInput) => Promise<PluginOutput>> {
  const runtime = options.runtime ?? detectRuntime();
  const configDir = options.configPath ? dirname(options.configPath) : detectConfigDir(runtime);
  const configPath = options.configPath ?? join(configDir, 'AGENTS.md');

  return buildPlugin({ runtime, configPath });
}

/**
 * Default export - creates the plugin for the detected runtime.
 * This is what OpenCode/KiloCode will import.
 */
const runtime = detectRuntime();
const configDir = detectConfigDir(runtime);
const configPath = join(configDir, 'AGENTS.md');

const plugin = buildPlugin({ runtime, configPath });

export default plugin;
export { runtime, configDir, configPath };
