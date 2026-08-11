/**
 * Lazy-load registry for tori-agent plugin tools.
 *
 * The plugin exposes ~20 tools to the LLM. Shipping every full definition
 * upfront costs ~3-5k tokens per request, most of which is never used.
 *
 * This module keeps a lightweight registry (name + category + short pointer)
 * and exposes two discovery tools:
 *
 *   - `list_available_tools`  → [{name, category, loaded}]
 *   - `load_tool`             → full {name, description, args}
 *
 * Tori calls `list_available_tools` once, then `load_tool` only for the
 * tools it actually needs. This cuts tool-definition tokens by ~85-95%.
 *
 * Extension tools (mcps, lsps, etc.) are not managed
 * here — they are loaded by the runtime. This registry only covers the
 * plugin's own tools.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface LazyToolMeta {
  name: string;
  category: 'core' | 'erpnext' | 'jira' | 'confluence' | 'mcp';
  description: string;
  args: Record<string, unknown>;
  execute: (args: Record<string, unknown>, context?: { sessionID?: string }) => Promise<string>;
}

export interface LazyToolPointer {
  name: string;
  category: string;
  loaded: boolean;
}

export interface LazyToolFull {
  name: string;
  category: string;
  description: string;
  args: Record<string, unknown>;
  loaded: boolean;
}

// ── Registry ─────────────────────────────────────────────────────────────────

const registry = new Map<string, LazyToolMeta>();

export function registerLazyTool(meta: LazyToolMeta): void {
  registry.set(meta.name, meta);
}

export function getLazyTool(name: string): LazyToolMeta | undefined {
  return registry.get(name);
}

export function getAllLazyTools(): LazyToolMeta[] {
  return Array.from(registry.values());
}

export function listLazyTools(): LazyToolPointer[] {
  return getAllLazyTools().map(t => ({
    name: t.name,
    category: t.category,
    loaded: false,
  }));
}

export async function loadLazyTool(name: string): Promise<LazyToolFull> {
  const meta = getLazyTool(name);
  if (!meta) {
    throw new Error(`Tool not found: ${name}. Use list_available_tools to discover tools.`);
  }
  return {
    name: meta.name,
    category: meta.category,
    description: meta.description,
    args: meta.args,
    loaded: true,
  };
}

// ── Tool Wrappers ────────────────────────────────────────────────────────────

export function createLazyToolWrapper(meta: LazyToolMeta): LazyToolMeta {
  return {
    ...meta,
    description: `[Tool: ${meta.name}] Load with load_tool(name="${meta.name}")`,
    execute: async (args: Record<string, unknown>, context?: { sessionID?: string }) => {
      // Auto-load on first use: the full definition is already in registry,
      // we just delegate to the original execute.
      return meta.execute(args, context);
    },
  };
}

// ── Discovery Tools ──────────────────────────────────────────────────────────

export function buildDiscoveryTools(): Record<string, LazyToolMeta> {
  const listTool: LazyToolMeta = {
    name: 'list_available_tools',
    category: 'core',
    description: 'List all available tools with their category. Use this to discover what tools exist before loading any tool.',
    args: {},
    execute: async () => {
      return JSON.stringify({ tools: listLazyTools(), total: registry.size });
    },
  };

  const loadTool: LazyToolMeta = {
    name: 'load_tool',
    category: 'core',
    description: 'Load a tool by name to get its full definition. Call this before using any tool you haven\'t loaded yet.',
    args: { name: {} },
    execute: async ({ name }: Record<string, unknown>) => {
      try {
        const full = await loadLazyTool(name as string);
        return JSON.stringify(full);
      } catch (err) {
        return JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
          hint: 'Use list_available_tools to see what tools exist.',
        });
      }
    },
  };

  return {
    [listTool.name]: listTool,
    [loadTool.name]: loadTool,
  };
}
