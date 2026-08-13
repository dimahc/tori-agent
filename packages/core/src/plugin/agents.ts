import { loadHumanTone } from '../codegen/loader.js';
import type { CompiledAgent } from '../codegen/types.js';
import { agentForSession as storeLookup, trackSessionAgent as storeTrack } from '../runtime/session-store.js';
export { initSessionStore } from '../runtime/session-store.js';

export type { CompiledAgent };

const doomLoopCounters = new Map<string, { tool: string; args: string; count: number; ts: number }>();
const denyDoomCounters = new Map<string, { tool: string; count: number; ts: number }>();
const MAX_DOOM_ENTRIES = 100;
const DOOM_WINDOW_MS = 60_000;
const DOOM_SAME_TOOL_THRESHOLD = 5;
const DENY_DOOM_WINDOW_MS = 60_000;
const DENY_DOOM_THRESHOLD = 3;

export function checkDoomLoop(sessionID: string, tool: string, pattern?: string | string[]): boolean {
    if (doomLoopCounters.size >= MAX_DOOM_ENTRIES) {
        doomLoopCounters.clear();
    }
    const key = `${sessionID}:${tool}`;
    const args = JSON.stringify(pattern ?? []);
    const now = Date.now();
    const current = doomLoopCounters.get(key);
    if (current && current.args === args) {
        current.count++;
        if (current.count >= 3) return true;
    } else {
        doomLoopCounters.set(key, { tool, args, count: 1, ts: now });
    }
    return false;
}

export function checkToolDoomLoop(sessionID: string, tool: string): boolean {
    pruneDoomLoop();
    if (doomLoopCounters.size >= MAX_DOOM_ENTRIES) {
        doomLoopCounters.clear();
    }
    const now = Date.now();
    const cutoff = now - DOOM_WINDOW_MS;
    const key = `${sessionID}:${tool}`;
    const existing = doomLoopCounters.get(key);
    let count: number;
    if (existing && existing.ts >= cutoff) {
        existing.ts = now;
        existing.count++;
        count = existing.count;
    } else {
        doomLoopCounters.set(key, { tool, args: '', count: 1, ts: now });
        count = 1;
    }
    return count >= DOOM_SAME_TOOL_THRESHOLD;
}

export function resetDoomLoop(sessionID: string, tool: string): void {
    doomLoopCounters.delete(`${sessionID}:${tool}`);
}

export function pruneDoomLoop(): void {
    const cutoff = Date.now() - DOOM_WINDOW_MS;
    for (const [key, entry] of doomLoopCounters.entries()) {
        if (entry.ts < cutoff) {
            doomLoopCounters.delete(key);
        }
    }
}

export function pruneDenyDoomLoop(): void {
    const cutoff = Date.now() - DENY_DOOM_WINDOW_MS;
    for (const [key, entry] of denyDoomCounters.entries()) {
        if (entry.ts < cutoff) {
            denyDoomCounters.delete(key);
        }
    }
}

export function checkDenyDoomLoop(sessionID: string, tool: string): boolean {
    pruneDenyDoomLoop();
    if (denyDoomCounters.size >= MAX_DOOM_ENTRIES) {
        denyDoomCounters.clear();
    }
    const now = Date.now();
    const cutoff = now - DENY_DOOM_WINDOW_MS;
    const key = `${sessionID}:${tool}`;
    const existing = denyDoomCounters.get(key);
    let count: number;
    if (existing && existing.ts >= cutoff) {
        existing.ts = now;
        existing.count++;
        count = existing.count;
    } else {
        denyDoomCounters.set(key, { tool, count: 1, ts: now });
        count = 1;
    }
    return count >= DENY_DOOM_THRESHOLD;
}

export function resetDenyDoomLoop(sessionID: string, tool: string): void {
    denyDoomCounters.delete(`${sessionID}:${tool}`);
}

export function trackSessionAgent(sessionID: string, agent?: string): void {
    if (agent) storeTrack(sessionID, agent);
}

export function agentForSession(sessionID: string): string | undefined {
    return storeLookup(sessionID);
}

function mergeCompiledPermissions(
    defaults: Record<string, unknown>,
    overrides: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
    if (!overrides || typeof overrides !== 'object') return { ...defaults };
    const result = { ...defaults };
    for (const [key, override] of Object.entries(overrides)) {
        const base = result[key];
        if (
            base !== null &&
            typeof base === 'object' &&
            !Array.isArray(base) &&
            override !== null &&
            typeof override === 'object' &&
            !Array.isArray(override)
        ) {
            result[key] = { ...(base as Record<string, unknown>), ...(override as Record<string, unknown>) };
        } else {
            if (Array.isArray(override) && base !== null && typeof base === 'object' && !Array.isArray(base)) {
                console.warn(`[tori-core] permission key "${key}" received an array override — expected an object.`);
            }
            result[key] = override;
        }
    }
    return result;
}

export function buildPermissionContext(
    agentId: string,
    overrides: Record<string, unknown> | null | undefined,
    allAgents: CompiledAgent[],
): Record<string, unknown> {
    const agent = allAgents.find((a) => a.id === agentId);
    if (!agent) {
        return { '*': 'deny' };
    }
    return mergeCompiledPermissions(agent.permission, overrides ?? null);
}

export function buildToolsMap(
    permission: Record<string, unknown>,
    pluginToolNames?: Set<string>,
): Record<string, boolean> {
    const tools: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(permission)) {
        if (key === '*') continue;
        if (value === 'allow') {
            tools[key] = true;
        } else if (value === 'deny') {
            if (pluginToolNames && pluginToolNames.has(key)) {
                tools[key] = false;
            }
        }
    }
    return tools;
}

export function buildHostPermission(
    permission: Record<string, unknown>,
    pluginToolNames?: Set<string>,
): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(permission)) {
        if (key === '*') {
            // Don't propagate catch-all deny — MCP server tools (context7, deepwiki, etc.)
            // are dynamically registered by the host and must pass through to agents.
            // Call-time enforcement is handled by evaluatePermission / permission.ask hook.
            if (value !== 'deny') {
                result[key] = value;
            }
            continue;
        }
        if (typeof value === 'string' && value === 'deny' && pluginToolNames && !pluginToolNames.has(key)) {
            continue;
        }
        result[key] = value;
    }
    if (result.edit === undefined && result.write === 'allow') {
        result.edit = 'allow';
    }
    if (result.external_directory === undefined) {
        result.external_directory = 'deny';
    }
    return result;
}

export function evaluatePermission(
    permission: Record<string, unknown>,
    tool: string,
    pattern?: string | string[],
): 'allow' | 'deny' {
    if ((tool === 'read' || tool === 'edit' || tool === 'write') && pattern) {
        const patterns = Array.isArray(pattern) ? pattern : [pattern];
        for (const p of patterns) {
            if (typeof p === 'string' && /(^|\/|\\)\.env($|\.(?!example($|\/|\\)))/i.test(p)) {
                return 'deny';
            }
        }
    }
    let rule = permission[tool];
    if (rule === undefined && tool === 'edit') {
        rule = permission.write;
    }
    if (rule === undefined || rule === 'deny') {
        // MCP tools are user-configured and should be available to agents.
        // Note: only applies when no rule exists (rule === undefined).
        // Tools with explicit "deny" rules are still blocked — the exception
        // does not override intentional denials.
        if (rule === undefined && isMcpTool(tool)) {
            return 'allow';
        }
        return 'deny';
    }
    if (rule === 'allow') return 'allow';
    if (rule !== null && typeof rule === 'object' && !Array.isArray(rule)) {
        const patterns = Array.isArray(pattern) ? pattern : pattern ? [pattern] : [];
        if (patterns.length === 0) return 'deny';
        const entries = Object.entries(rule as Record<string, string>);
        for (const p of patterns) {
            const matched = matchPattern(entries, p);
            if (matched !== 'allow') return 'deny';
        }
        return 'allow';
    }
    return 'deny';
}

function matchPattern(entries: [string, string][], value: string): string | undefined {
    let action: string | undefined;
    for (const [pattern, act] of entries) {
        if (pattern === '*') {
            action = act;
            continue;
        }
        if (pattern.endsWith('*') && value.startsWith(pattern.slice(0, -1))) {
            action = act;
            continue;
        }
        if (pattern === value) {
            action = act;
        }
    }
    return action;
}

function isMcpTool(tool: string): boolean {
    // Built-in MCP management tools
    if (tool.startsWith('list_mcp_') || tool.startsWith('read_mcp_') || tool.startsWith('mcp_')) return true;
    // MCP server tools use __ as namespace separator (e.g., context7__get-library-docs).
    // The MCP SDK convention is server_name__tool_name. This is a broad heuristic —
    // any tool containing __ will match, but no non-MCP tools in the ecosystem use
    // this naming pattern currently.
    if (tool.includes('__')) return true;
    return false;
}

export async function registerAgents(
    input: { agent?: Record<string, unknown> },
    userConfig: Record<string, unknown>,
    allAgents: CompiledAgent[],
    runtime: 'opencode' | 'kilocode',
    configPath: string,
    pluginToolNames?: Set<string>,
): Promise<void> {
    const humanTone = await loadHumanTone();
    const userAgents = (input.agent ?? {}) as Record<string, unknown>;
    input.agent = input.agent ?? {};

    for (const agent of allAgents) {
        const userCfg = (userAgents[agent.id] ?? {}) as Record<string, unknown> & { soul?: boolean };
        const { soul, ...userCfgRest } = userCfg;

        const finalPrompt =
            agent.mode === 'all' && soul !== false && humanTone
                ? `${agent.prompt}\n\nInstructions from: ${configPath}\n${humanTone}`
                : agent.prompt;

        const mergedPermission = mergeCompiledPermissions(
            agent.permission,
            (userCfgRest.permission as Record<string, unknown>) ?? null,
        );
        const userTools = (userCfgRest.tools ?? {}) as Record<string, boolean>;

        input.agent[agent.id] = {
            description: agent.description,
            temperature: agent.temperature,
            mode: agent.mode,
            color: agent.color,
            ...userCfgRest,
            prompt: finalPrompt,
            tools: { ...buildToolsMap(mergedPermission, pluginToolNames), ...userTools },
            permission: buildHostPermission(mergedPermission, pluginToolNames),
        } as never;
    }
}
