import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendFile } from 'node:fs/promises';
import { initializeOntologyRuntime, getOntologyRuntime } from '../ontology/runtime.js';
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

    // Initialize the new ontology runtime
    const ontologyRuntime = await initializeOntologyRuntime();
    log('[PLUGIN] Ontology runtime initialized');

    const configDir = configPath ? dirname(configPath) : join(directory, runtime === 'opencode' ? '.opencode' : '.kilocode');

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
      const agent = ontologyRuntime.getRegistry().getByType("Agent").find(a => a.metadata?.mode === 'all')?.['@id'] || 'tori';
      return {
        version: '1.0',
        created_at: new Date().toISOString(),
        trigger: 'budget',
        parent: { task_id: sessionId, agent, depth: 0 },
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
        await ontologyRuntime.registerAgents(input as { agent?: Record<string, unknown> }, userConfig, runtime, configPath, pluginToolNames);
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
        // Track session agent in ontology registry
        const registry = ontologyRuntime.getRegistry();
        const agentEntity = registry.getByType("Agent").find(a => a.metadata?.original_spec_id === agent || a['@id'] === agent);
        if (agentEntity) {
          log('[CHAT.MESSAGE] tracked in ontology', { sessionID, agent: agentEntity['@id'] });
        }
      },
      'permission.ask': async (input, output) => {
        const registry = ontologyRuntime.getRegistry();
        
        // Find agent by session - for now use the first 'all' mode agent
        // In a full implementation, this would use a session store
        const agentEntity = registry.getByType("Agent").find(a => a.metadata?.mode === 'all');
        const agentId = agentEntity?.['@id'];
        
        log('[PERMISSION.ASK] called', { sessionID: input.sessionID, agentId, type: input.type, pattern: input.pattern });
        
        if (!agentId) {
          // Untracked session — let host decide (no override)
          log('[PERMISSION.ASK] no agent found → no override');
          return;
        }

        // Check doom loop (simplified)
        if (ontologyRuntime.checkDoomLoop(input.sessionID, input.type, input.pattern)) {
          log('[PERMISSION.ASK] doom loop detected — escalating to ask');
          output.status = 'ask';
          return;
        }

        // Evaluate permission using the policy engine
        const result = await ontologyRuntime.evaluatePermission(agentId, input.type, input.pattern);
        log('[PERMISSION.ASK] evaluated', { agentId, tool: input.type, result });

        if (result === 'deny') {
          output.status = 'ask'; // Escalate denials to ask
          return;
        }
        
        output.status = result;
      },
    };
  };
}