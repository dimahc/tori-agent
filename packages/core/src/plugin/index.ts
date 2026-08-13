import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendFile } from 'node:fs/promises';
import { registerAgents, trackSessionAgent, agentForSession, evaluatePermission, checkDoomLoop, resetDoomLoop, checkDenyDoomLoop, resetDenyDoomLoop, initSessionStore } from './agents.js';
import { loadAndCompileAllAgents } from '../codegen/loader.js';
import { syncBuiltinSkills } from '../codegen/skills.js';
import { buildReadOnlyTools, buildWriteTools, registerToolInLazyRegistry, getDiscoveryTools } from './tools.js';
import { createBudgetAwareToolExecutor } from '../runtime/sdk-adapter.js';
import type { Checkpoint } from '../types/checkpoint.js';
import type { LazyToolMeta } from './lazy-load.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG = '/tmp/tori-debug.log';

function log(...args: unknown[]): void {
  appendFile(LOG, args.map(a => typeof a === 'string' ? a : JSON.stringify(a, null, 2)).join(' ') + '\n').catch(() => {});
}

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
    log('[PLUGIN] buildPlugin called', { runtime, configPath, inputKeys: Object.keys(input) });

    const directory = input.directory ?? '.';
    const worktree = input.worktree;
    const projectRoot = (worktree && worktree !== '/') ? worktree : directory;

    const runtimeDir = runtime === 'opencode' ? '.opencode' : '.kilocode';
    const paths = {
      specs: join(runtimeDir, 'specs'),
      execPlans: join(runtimeDir, 'plans'),
      briefs: join(runtimeDir, 'briefs'),
      workflows: join(runtimeDir, 'workflows'),
    };

    const allAgents = await loadAndCompileAllAgents();
    log('[PLUGIN] agents loaded', allAgents.map(a => ({ id: a.id, mode: a.mode, permKeys: Object.keys(a.permission) })));

    const configDir = configPath ? dirname(configPath) : join(directory, runtime === 'opencode' ? '.opencode' : '.kilocode');
    initSessionStore(configDir);

    try {
      const synced = await syncBuiltinSkills(join(configDir, 'skills'));
      log('[PLUGIN] skills synced', { count: synced.length, skills: synced.map(s => s.name) });
    } catch (err) {
      log('[PLUGIN] skills sync failed', (err as Error).message ?? String(err));
    }

    const readOnlyTools = buildReadOnlyTools(projectRoot, paths, join(configDir, 'skills'));
    const writeTools = buildWriteTools(projectRoot, paths, configDir, runtime);

    // ── Lazy-load registry ──────────────────────────────────────────────────
    const discoveryTools = getDiscoveryTools();
    const allCoreTools = { ...readOnlyTools, ...writeTools, ...discoveryTools };

    for (const [name, tool] of Object.entries(readOnlyTools)) {
      registerToolInLazyRegistry(name, 'core', tool.description, tool.args, tool.execute as LazyToolMeta['execute']);
    }
    for (const [name, tool] of Object.entries(writeTools)) {
      registerToolInLazyRegistry(name, 'core', tool.description, tool.args, tool.execute as LazyToolMeta['execute']);
    }
    for (const [name, tool] of Object.entries(discoveryTools)) {
      registerToolInLazyRegistry(name, 'core', tool.description, tool.args, tool.execute as LazyToolMeta['execute']);
    }

    const makeCheckpoint = (sessionId: string): Checkpoint => {
      const agent = agentForSession(sessionId);
      return {
        version: '1.0',
        created_at: new Date().toISOString(),
        trigger: 'budget',
        parent: { task_id: sessionId, agent: agent ?? 'unknown', depth: 0 },
        state: {
          todowrite: [],
          workflow_stage: 'unknown',
          iteration: 0,
          artifacts_modified: [],
          decisions: [],
        },
        context_summary: `Automatic checkpoint for session ${sessionId}`,
        resume_instructions: `Resume work for session ${sessionId}. Read this checkpoint and continue.`,
        child_tasks: [],
      };
    };

    const baseTools = { ...readOnlyTools, ...writeTools };
    const budgetAwareTools = createBudgetAwareToolExecutor(baseTools, projectRoot, makeCheckpoint);

    const pluginToolNames = new Set<string>();
    for (const name of Object.keys(readOnlyTools)) pluginToolNames.add(name);
    for (const name of Object.keys(writeTools)) pluginToolNames.add(name);
    for (const name of Object.keys(discoveryTools)) pluginToolNames.add(name);
    log('[PLUGIN] pluginToolNames', [...pluginToolNames]);

    return {
      config: async (input) => {
        log('[CONFIG] hook called');
        log('[CONFIG] existing agents in input', Object.keys((input.agent ?? {})));
        const userConfig = (input.agent ?? {}) as Record<string, unknown>;
        await registerAgents(input as { agent?: Record<string, unknown> }, userConfig, allAgents, runtime, configPath, pluginToolNames);
        log('[CONFIG] agents after registration', Object.keys((input.agent ?? {})));

        const agents = input.agent as Record<string, Record<string, unknown>> | undefined;
        if (agents) {
          for (const [id, cfg] of Object.entries(agents)) {
            if (id === 'tori' || id.startsWith('specialist') || id.startsWith('scribe')) {
              log(`[CONFIG] ${id} config keys:`, Object.keys(cfg));
              const c = cfg as { tools?: unknown; permission?: unknown };
              if (c.tools) log(`[CONFIG] ${id} tools:`, c.tools);
              if (c.permission) log(`[CONFIG] ${id} permission:`, c.permission);
            }
          }
        }
      },
      tool: {
        ...budgetAwareTools,
        ...discoveryTools,
      } as Record<string, unknown>,
      event: async ({ event }) => {
        log('[EVENT] event received', { type: event.type, full: JSON.stringify(event) });
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
        log('[CHAT.MESSAGE] called', { sessionID, agent });
        trackSessionAgent(sessionID, agent);
        log('[CHAT.MESSAGE] tracked', { sessionID, agent });
      },
      'permission.ask': async (input, output) => {
        const agentId = agentForSession(input.sessionID);
        log('[PERMISSION.ASK] called', { sessionID: input.sessionID, agentId, type: input.type, pattern: input.pattern });
        if (!agentId) {
          // Untracked session — let host decide (no override)
          log('[PERMISSION.ASK] untracked session → no override');
          return;
        }
        if (checkDoomLoop(input.sessionID, input.type, input.pattern)) {
          log('[PERMISSION.ASK] doom loop detected — escalating to ask');
          resetDoomLoop(input.sessionID, input.type);
          resetDenyDoomLoop(input.sessionID, input.type);
          output.status = 'ask';
          return;
        }
        const agent = allAgents.find((a) => a.id === agentId);
        if (!agent) {
          log('[PERMISSION.ASK] agent not found → no override');
          return;
        }
        const result = evaluatePermission(agent.permission, input.type, input.pattern);
        log('[PERMISSION.ASK] evaluated', { agentId, tool: input.type, result, agentPermKeys: Object.keys(agent.permission) });
        if (result === 'deny' && checkDenyDoomLoop(input.sessionID, input.type)) {
          log('[PERMISSION.ASK] deny doom loop detected — escalating to ask');
          resetDenyDoomLoop(input.sessionID, input.type);
          resetDoomLoop(input.sessionID, input.type);
          output.status = 'ask';
          return;
        }
        output.status = result;
        if (result === 'allow') {
          resetDoomLoop(input.sessionID, input.type);
          resetDenyDoomLoop(input.sessionID, input.type);
        }
      },
    };
  };
}
