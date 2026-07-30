import type { CompiledAgent } from '../codegen/types.js';
import { loadAndCompileAllAgents, loadHumanTone, compileAgent, loadAgentSpecs } from '../codegen/loader.js';

export type { CompiledAgent };

/**
 * Tracks which tori agent owns each session so the permission.ask hook can
 * resolve the right compiled permission set at call time.
 */
const sessionAgents = new Map<string, string>();

export function trackSessionAgent(sessionID: string, agent?: string): void {
  if (agent) sessionAgents.set(sessionID, agent);
}

export function agentForSession(sessionID: string): string | undefined {
  return sessionAgents.get(sessionID);
}

function mergePermissions(
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
  return mergePermissions(agent.permission, overrides ?? null);
}

/**
 * Tools whose caller-side wildcard denies the host force-inherits into
 * subagent sessions (TaskTool child permission derivation), where they
 * override the subagent's own allows. The `write` tool rides along because
 * the host gates file writing under the `edit` permission.
 *
 * Never advertise wildcard denies for these in the host-facing config:
 * doing so strips them from every spawned subagent. Call-time enforcement
 * via the permission.ask hook keeps the spec's deny intent intact.
 */
const HOST_INHERITABLE_DENY_TOOLS = new Set(["edit", "write", "bash", "notebook_edit", "notebook_execute"]);

function isWildcardDeny(value: unknown): boolean {
  if (value === "deny") return true;
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return (value as Record<string, unknown>)["*"] === "deny";
  }
  return false;
}

/**
 * Convert a compiled tori permission record into the host-native `tools`
 * boolean map (AgentConfig.tools). `true` == allow all patterns, `false` ==
 * deny. This is what actually controls tool availability in the spawned
 * agent's tool list — a bare `"*": "deny"` in a custom-shaped permission
 * object strips built-in tools (write/edit/bash) from subagents.
 */
export function buildToolsMap(permission: Record<string, unknown>): Record<string, boolean> {
  const tools: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(permission)) {
    if (key === "*") continue;
    if (value === "allow") {
      tools[key] = true;
    } else if (value === "deny") {
      // Omit host-inheritable denies — see HOST_INHERITABLE_DENY_TOOLS.
      if (HOST_INHERITABLE_DENY_TOOLS.has(key)) continue;
      tools[key] = false;
    } else if (value !== null && typeof value === "object") {
      // Pattern-scoped rule (allow_paths / allow_commands): the tool itself
      // stays available; individual patterns are gated at call time via the
      // permission.ask hook.
      tools[key] = true;
    }
  }
  return tools;
}

/**
 * Reshape a compiled tori permission record into the host's AgentConfig
 * permission schema (edit / bash / webfetch / doom_loop / external_directory)
 * while keeping tori-specific tool keys for plugin tools. The `"*": "deny"`
 * catch-all is intentionally dropped: default-deny is enforced at call time
 * by the permission.ask hook instead of by stripping tools from the agent.
 */
export function buildHostPermission(permission: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(permission)) {
    if (key === "*") continue;
    // Omit host-inheritable wildcard denies — see HOST_INHERITABLE_DENY_TOOLS.
    if (HOST_INHERITABLE_DENY_TOOLS.has(key) && isWildcardDeny(value)) continue;
    result[key] = value;
  }
  // The host gates its file-writing built-ins under the `edit` permission —
  // honoring tori specs that allow `write` but don't mention `edit`.
  if (result.edit === undefined && result.write === "allow") {
    result.edit = "allow";
  }
  return result;
}

/**
 * Evaluate a permission request at call time (permission.ask hook).
 * Default-deny: tools not explicitly allowed by the agent's compiled
 * permission record are denied. Pattern-scoped rules (allow_paths /
 * allow_commands) are matched against the request pattern; `"write"` counts
 * as allowed when the host reports the request under the `edit` type.
 */
export function evaluatePermission(
  permission: Record<string, unknown>,
  tool: string,
  pattern?: string | string[]
): "allow" | "deny" {
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
  // Last match wins, mirroring host rule evaluation.
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
  configPath: string
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

    const mergedPermission = mergePermissions(
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
      tools: { ...buildToolsMap(mergedPermission), ...userTools },
      permission: buildHostPermission(mergedPermission),
    } as never;
  }
}
