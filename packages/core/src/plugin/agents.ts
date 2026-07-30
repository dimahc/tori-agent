import type { CompiledAgent } from '../codegen/types.js';
import { loadHumanTone } from '../codegen/loader.js';
import { trackSessionAgent as storeTrack, agentForSession as storeLookup } from '../runtime/session-store.js';
export { initSessionStore } from '../runtime/session-store.js';

export type { CompiledAgent };

const doomLoopCounters = new Map<string, { tool: string; args: string; count: number }>();
const MAX_DOOM_ENTRIES = 100;

export function checkDoomLoop(sessionID: string, tool: string, pattern?: string | string[]): boolean {
  if (doomLoopCounters.size >= MAX_DOOM_ENTRIES) {
    doomLoopCounters.clear();
  }
  const key = `${sessionID}:${tool}`;
  const args = JSON.stringify(pattern ?? []);
  const current = doomLoopCounters.get(key);
  if (current && current.args === args) {
    current.count++;
    if (current.count >= 3) return true;
  } else {
    doomLoopCounters.set(key, { tool, args, count: 1 });
  }
  return false;
}

export function resetDoomLoop(sessionID: string, tool: string): void {
  doomLoopCounters.delete(`${sessionID}:${tool}`);
}

export function trackSessionAgent(sessionID: string, agent?: string): void {
  if (agent) storeTrack(sessionID, agent);
}

export function agentForSession(sessionID: string): string | undefined {
  return storeLookup(sessionID);
}

function mergeCompiledPermissions(
  defaults: Record<string, unknown>,
  overrides: Record<string, unknown> | null | undefined
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
  allAgents: CompiledAgent[]
): Record<string, unknown> {
  const agent = allAgents.find((a) => a.id === agentId);
  if (!agent) {
    return { "*": "deny" };
  }
  return mergeCompiledPermissions(agent.permission, overrides ?? null);
}

export function buildToolsMap(permission: Record<string, unknown>, pluginToolNames?: Set<string>): Record<string, boolean> {
  const tools: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(permission)) {
    if (key === "*") continue;
    if (value === "allow") {
      tools[key] = true;
    } else if (value === "deny") {
      if (pluginToolNames && pluginToolNames.has(key)) {
        tools[key] = false;
      }
    }
  }
  return tools;
}

export function buildHostPermission(permission: Record<string, unknown>, pluginToolNames?: Set<string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(permission)) {
    if (key === "*") {
      result[key] = value;
      continue;
    }
    if (typeof value === "string" && value === "deny" && pluginToolNames && !pluginToolNames.has(key)) {
      continue;
    }
    result[key] = value;
  }
  if (result.edit === undefined && result.write === "allow") {
    result.edit = "allow";
  }
  if (result.external_directory === undefined) {
    result.external_directory = "deny";
  }
  return result;
}

export function evaluatePermission(
  permission: Record<string, unknown>,
  tool: string,
  pattern?: string | string[]
): "allow" | "deny" {
  if ((tool === "read" || tool === "edit" || tool === "write") && pattern) {
    const patterns = Array.isArray(pattern) ? pattern : [pattern];
    for (const p of patterns) {
      if (typeof p === "string" && /(^|\/|\\)\.env($|\.(?!example($|\/|\\)))/i.test(p)) {
        return "deny";
      }
    }
  }
  let rule = permission[tool];
  if (rule === undefined && tool === "edit") {
    rule = permission.write;
  }
  if (rule === undefined || rule === "deny") return "deny";
  if (rule === "allow") return "allow";
  if (rule !== null && typeof rule === "object" && !Array.isArray(rule)) {
    const patterns = Array.isArray(pattern) ? pattern : pattern ? [pattern] : [];
    if (patterns.length === 0) return "deny";
    const entries = Object.entries(rule as Record<string, string>);
    for (const p of patterns) {
      const matched = matchPattern(entries, p);
      if (matched !== "allow") return "deny";
    }
    return "allow";
  }
  return "deny";
}

function matchPattern(entries: [string, string][], value: string): string | undefined {
  let action: string | undefined;
  for (const [pattern, act] of entries) {
    if (pattern === "*") {
      action = act;
      continue;
    }
    if (pattern.endsWith("*") && value.startsWith(pattern.slice(0, -1))) {
      action = act;
      continue;
    }
    if (pattern === value) {
      action = act;
    }
  }
  return action;
}

export async function registerAgents(
  input: { agent?: Record<string, unknown> },
  userConfig: Record<string, unknown>,
  allAgents: CompiledAgent[],
  runtime: 'opencode' | 'kilocode',
  configPath: string,
  pluginToolNames?: Set<string>
): Promise<void> {
  const humanTone = await loadHumanTone();
  const userAgents = (input.agent ?? {}) as Record<string, unknown>;
  input.agent = input.agent ?? {};

  for (const agent of allAgents) {
    const userCfg = (userAgents[agent.id] ?? {}) as Record<string, unknown> & { soul?: boolean };
    const { soul, ...userCfgRest } = userCfg;

    const finalPrompt = agent.mode === 'all' && soul !== false && humanTone
      ? `${agent.prompt}\n\nInstructions from: ${configPath}\n${humanTone}`
      : agent.prompt;

    const mergedPermission = mergeCompiledPermissions(
      agent.permission,
      (userCfgRest.permission as Record<string, unknown>) ?? null
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
