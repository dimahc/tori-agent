import type { AgentSpec, PersonaEntry } from '../codegen/types.js';
import type { PersonaDefinition, PersonaHierarchy, PersonaMatch } from '../types/persona.js';

export function buildHierarchy(specs: AgentSpec[]): PersonaHierarchy {
  const hierarchy: PersonaHierarchy = {};

  for (const spec of specs) {
    const entries = spec.personas ?? spec.modes;
    if (!entries) continue;

    for (const [id, entry] of Object.entries(entries)) {
      const extended = entry as PersonaEntry & {
        expertise_tags?: string[];
        parent_id?: string;
        weight?: number;
      };
      hierarchy[id] = {
        id,
        description: entry.description,
        expertise_tags: extended.expertise_tags ?? [],
        parent_id: extended.parent_id,
        weight: extended.weight ?? 1.0,
        instructions: entry.instructions,
        permissions: entry.permissions as Record<string, unknown> | undefined,
      };
    }
  }

  return hierarchy;
}

export function resolveInheritedTags(
  persona: PersonaDefinition,
  hierarchy: PersonaHierarchy,
  seen = new Set<string>()
): string[] {
  if (seen.has(persona.id)) return [];
  seen.add(persona.id);

  const tags = new Set<string>(persona.expertise_tags);

  if (persona.parent_id && hierarchy[persona.parent_id]) {
    const parent = hierarchy[persona.parent_id];
    for (const tag of resolveInheritedTags(parent, hierarchy, seen)) {
      tags.add(tag);
    }
  }

  return Array.from(tags);
}

export function matchPersona(
  taskDescription: string,
  hierarchy: PersonaHierarchy
): PersonaMatch | null {
  const tokens = tokenize(taskDescription);

  let best: { id: string; score: number; matched: string[]; inherited: string[] } | null = null;

  for (const [id, persona] of Object.entries(hierarchy)) {
    const inherited = resolveInheritedTags(persona, hierarchy);
    const allTags = Array.from(new Set([...persona.expertise_tags, ...inherited]));
    const matched = tokens.filter((t) => allTags.includes(t));

    if (matched.length === 0) continue;

    const score = (matched.length / Math.max(allTags.length, 1)) * persona.weight;

    if (!best || score > best.score) {
      best = { id, score, matched, inherited };
    }
  }

  if (!best) return null;

  return {
    persona_id: best.id,
    confidence: Math.min(best.score, 1.0),
    matched_tags: best.matched,
    inherited_tags: best.inherited,
  };
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .split(/[\s-]+/)
    .filter((t) => t.length > 2);
}
