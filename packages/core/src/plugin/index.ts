import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAgents } from './agents.js';
import { loadAndCompileAllAgents } from '../codegen/loader.js';
import { buildReadOnlyTools, buildWriteTools } from './tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface PluginInput {
  directory?: string;
  worktree?: string;
  serverUrl?: string | URL;
}

export interface PluginOutput {
  config?: (input: Record<string, unknown>) => Promise<void>;
  tool?: Record<string, unknown>;
  event?: (input: { event: { type: string } }) => Promise<void>;
}

export function buildPlugin() {
  return async (input: PluginInput): Promise<PluginOutput> => {
    const directory = input.directory ?? '.';
    const worktree = input.worktree;
    const projectRoot = (worktree && worktree !== '/') ? worktree : directory;

    const paths = {
      specs: 'docs/specs',
      execPlans: 'docs/exec-plans',
      briefs: 'docs/briefs',
    };

    const allAgents = await loadAndCompileAllAgents();

    const readOnlyTools = buildReadOnlyTools(projectRoot, paths);
    const writeTools = buildWriteTools(projectRoot, paths);

    return {
      config: async (input) => {
        const userConfig = (input.agent ?? {}) as Record<string, unknown>;
        await registerAgents(input as unknown as { agent?: Record<string, unknown> }, userConfig, allAgents);
      },
      tool: {
        ...readOnlyTools,
        ...writeTools,
      } as Record<string, unknown>,
      event: async ({ event }) => {
        if (event.type === 'session.created') {
          const { mkdir } = await import('node:fs/promises');
          await Promise.all([
            mkdir(join(projectRoot, paths.execPlans), { recursive: true }),
            mkdir(join(projectRoot, paths.briefs), { recursive: true }),
            mkdir(join(projectRoot, paths.specs), { recursive: true }),
          ]).catch(() => {});
        }
      },
    };
  };
}
