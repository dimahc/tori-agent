import type { CompiledAgent } from '../codegen/types.js';
import { loadAndCompileAllAgents, loadHumanTone, compileAgent, loadAgentSpecs } from '../codegen/loader.js';

export type { CompiledAgent };

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

export async function registerAgents(
  input: { agent?: Record<string, unknown> },
  userConfig: Record<string, unknown>,
  allAgents: CompiledAgent[]
): Promise<void> {
  const humanTone = await loadHumanTone();
  const userAgents = (input.agent ?? {}) as Record<string, unknown>;
  input.agent = input.agent ?? {};

  for (const agent of allAgents) {
    const userCfg = (userAgents[agent.id] ?? {}) as Record<string, unknown> & { soul?: boolean };
    const { soul, ...userCfgRest } = userCfg;

    const finalPrompt = agent.mode === 'all' && soul !== false && humanTone
      ? `${agent.prompt}\n\nInstructions from: ~/.config/opencode/AGENTS.md\n${humanTone}`
      : agent.prompt;

    input.agent[agent.id] = {
      description: agent.description,
      temperature: agent.temperature,
      mode: agent.mode,
      color: agent.color,
      ...userCfgRest,
      prompt: finalPrompt,
      permission: mergePermissions(agent.permission, (userCfgRest.permission as Record<string, unknown>) ?? null),
    } as never;
  }
}
