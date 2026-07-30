import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAgents, trackSessionAgent, agentForSession, evaluatePermission } from './agents.js';
import { loadAndCompileAllAgents } from '../codegen/loader.js';
import { buildReadOnlyTools, buildWriteTools } from './tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface PluginInput {
  directory?: string;
  worktree?: string;
  serverUrl?: string | URL;
  runtime?: 'opencode' | 'kilocode';
  configPath?: string;
}

export interface PluginOutput {
  config?: (input: Record<string, unknown>) => Promise<void>;
  tool?: Record<string, unknown>;
  event?: (input: { event: { type: string } }) => Promise<void>;
  'chat.message'?: (input: { sessionID: string; agent?: string }) => Promise<void>;
  'permission.ask'?: (
    input: { type: string; pattern?: string | string[]; sessionID: string },
    output: { status: 'ask' | 'deny' | 'allow' }
  ) => Promise<void>;
}

export function buildPlugin(options: { runtime?: 'opencode' | 'kilocode'; configPath?: string } = {}) {
  const runtime = options.runtime ?? 'opencode';
  const configPath = options.configPath ?? '';

  return async (input: PluginInput): Promise<PluginOutput> => {
    const directory = input.directory ?? '.';
    const worktree = input.worktree;
    const projectRoot = (worktree && worktree !== '/') ? worktree : directory;

    const paths = {
      specs: 'docs/specs',
      execPlans: 'docs/exec-plans',
      briefs: 'docs/briefs',
      workflows: 'docs/workflows',
    };

    const allAgents = await loadAndCompileAllAgents();

    const readOnlyTools = buildReadOnlyTools(projectRoot, paths);
    const writeTools = buildWriteTools(projectRoot, paths);

    return {
      config: async (input) => {
        const userConfig = (input.agent ?? {}) as Record<string, unknown>;
        await registerAgents(input as unknown as { agent?: Record<string, unknown> }, userConfig, allAgents, runtime, configPath);
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
            mkdir(join(projectRoot, paths.workflows), { recursive: true }),
          ]).catch(() => {});
        }
      },
      'chat.message': async ({ sessionID, agent }) => {
        trackSessionAgent(sessionID, agent);
      },
      'permission.ask': async (input, output) => {
        // Only adjudicate for sessions running a tori agent — anything else
        // keeps the host's default behavior.
        const agentId = agentForSession(input.sessionID);
        if (!agentId) return;
        const agent = allAgents.find((a) => a.id === agentId);
        if (!agent) return;
        output.status = evaluatePermission(agent.permission, input.type, input.pattern);
      },
    };
  };
}
