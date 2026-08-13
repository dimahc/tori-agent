import yaml from "js-yaml";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifySpecSignature, computeContentHash } from "./signing.js";
import { validateSkillPermissions } from "./skill-validation.js";
import type { AgentPermissions, AgentSpec, CompiledAgent, PersonaEntry } from "./types.js";
import { mergePermissionSets } from "../runtime/permissions.js";
import { buildHierarchy, matchPersona } from "../runtime/persona-registry.js";
import type { PersonaHierarchy, PersonaMatch } from "../types/persona.js";
import type { WritePolicy } from "../types/write-path.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveSpecDir(): string {
  return join(__dirname, "..", "..", "spec");
}

export async function loadAgentSpecs(): Promise<AgentSpec[]> {
  const specDir = resolveSpecDir();
  const agentsDir = join(specDir, "agents");

  let files: string[];
  try {
    files = await readdir(agentsDir);
  } catch {
    console.warn(
      "[tori-core] spec/agents/ not found — using fallback agent definitions",
    );
    return [];
  }

  const specs: AgentSpec[] = [];

  for (const file of files) {
    if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;

    const filePath = join(agentsDir, file);
    try {
      const content = await readFile(filePath, "utf-8");
      const spec = yaml.load(content) as AgentSpec;
      if (spec && spec.id) {
        if (spec.content_hash) {
          const actualHash = computeContentHash(content);
          if (actualHash !== spec.content_hash) {
            console.warn(
              `[tori-core] Agent spec ${file} content_hash mismatch: expected ${spec.content_hash}, actual ${actualHash}`,
            );
            continue;
          }
        }

        if (spec.signature) {
          const publicKeyHex = process.env.TORI_AGENT_PUBLIC_KEY_HEX;
          if (!publicKeyHex) {
            console.warn(
              `[tori-core] Agent spec ${file} has a signature but TORI_AGENT_PUBLIC_KEY_HEX is not set — skipping verification`,
            );
          } else {
            const valid = await verifySpecSignature(filePath, spec.signature, publicKeyHex);
            if (!valid) {
              console.warn(
                `[tori-core] Agent spec ${file} signature verification failed`,
              );
              continue;
            }
          }
        }

        specs.push(spec);
      }
    } catch (err) {
      console.warn(
        `[tori-core] Failed to load agent spec ${file}:`,
        (err as Error).message,
      );
    }
  }

  return specs;
}

export async function loadPrompt(relativePath: string): Promise<string | null> {
  const specDir = resolveSpecDir();
  const promptPath = join(specDir, relativePath);
  try {
    return await readFile(promptPath, "utf-8");
  } catch {
    return null;
  }
}

export async function loadHumanTone(): Promise<string> {
  const specDir = resolveSpecDir();
  const path = join(specDir, "prompts", "human-tone.md");
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}

async function loadReferences(
  references?: string[],
): Promise<string> {
  if (!references || references.length === 0) return "";

  const fragments: string[] = [];
  for (const ref of references) {
    const content = await loadPrompt(ref);
    if (content) {
      fragments.push(content);
    } else {
      console.warn(`[tori-core] Reference not found: ${ref}`);
    }
  }
  return fragments.join("\n\n");
}

export async function compileAgent(
  spec: AgentSpec,
): Promise<CompiledAgent | null> {
  const promptContent = await loadPrompt(spec.prompt);
  if (!promptContent) {
    console.warn(
      `[tori-core] Prompt not found for agent "${spec.id}": ${spec.prompt}`,
    );
    return null;
  }

  const references = await loadReferences(spec.references);

  const permission = buildPermissions(spec.permissions);

  return {
    id: spec.id,
    description: spec.description,
    temperature: spec.temperature,
    mode: spec.mode,
    color: spec.color ?? "info",
    prompt: references
      ? `${references}\n\n${promptContent}`
      : promptContent,
    permission,
    humanTone: spec.human_tone,
  };
}

function buildPermissions(p: AgentPermissions): Record<string, unknown> {
  const result: Record<string, unknown> = { "*": "deny" };

  if (p.allow) {
    for (const tool of p.allow) {
      if (!(tool in result)) {
        result[tool] = "allow";
      }
    }
  }

  if (p.deny) {
    for (const tool of p.deny) {
      result[tool] = "deny";
    }
  }

  if (p.allow_paths) {
    for (const [tool, paths] of Object.entries(p.allow_paths)) {
      const entry: Record<string, string> = { "*": "deny" };
      for (const path of paths) {
        entry[path] = "allow";
      }
      result[tool] = entry;
    }
  }

  if (p.allow_commands) {
    for (const [tool, commands] of Object.entries(p.allow_commands)) {
      const entry: Record<string, string> = { "*": "deny" };
      for (const cmd of commands) {
        entry[cmd] = "allow";
      }
      result[tool] = entry;
    }
  }

  // Universal Skill Format: deny_write protects identity files by default
  const writeEntry: Record<string, string> = { "*": "deny" };
  if (p.deny_write) {
    for (const path of p.deny_write) {
      writeEntry[path] = "deny";
    }
  }
  result["write"] = writeEntry;
  result["edit"] = writeEntry;

  // Universal Skill Format: network.allow is a domain allowlist, not a boolean
  if (p.network) {
    const networkEntry: Record<string, string> = { "*": "deny" };
    if (p.network.allow) {
      for (const domain of p.network.allow) {
        networkEntry[domain] = "allow";
      }
    }
    if (p.network.deny) {
      for (const domain of p.network.deny) {
        networkEntry[domain] = "deny";
      }
    }
    result["network"] = networkEntry;
  }

  return result;
}

const VALID_RISK_TIERS = new Set(['L0', 'L1', 'L2', 'L3']);
const VALID_MODES = new Set(['all', 'subagent']);
const VALID_PLATFORMS = new Set(['openclaw', 'claude', 'cursor', 'vscode']);

export function validateAgentSpec(spec: unknown): string[] {
  const errors: string[] = [];
  if (!spec || typeof spec !== "object") {
    return ["Agent spec must be an object"];
  }

  const s = spec as Record<string, unknown>;

  if (typeof s.id !== "string" || !s.id.trim()) {
    errors.push("id must be a non-empty string");
  }

  if (typeof s.name !== "string" || !s.name.trim()) {
    errors.push("name must be a non-empty string");
  }

  if (!VALID_MODES.has(s.mode as string)) {
    errors.push(`mode must be one of: ${[...VALID_MODES].join(", ")}`);
  }

  if (typeof s.temperature !== "number") {
    errors.push("temperature must be a number");
  }

  if (typeof s.description !== "string") {
    errors.push("description must be a string");
  }

  if (typeof s.prompt !== "string") {
    errors.push("prompt must be a string");
  }

  if (typeof s.human_tone !== "boolean") {
    errors.push("human_tone must be a boolean");
  }

  if (s.risk_tier && !VALID_RISK_TIERS.has(s.risk_tier as string)) {
    errors.push(`risk_tier must be one of: ${[...VALID_RISK_TIERS].join(", ")}`);
  }

  if (s.platforms && Array.isArray(s.platforms)) {
    for (const platform of s.platforms) {
      if (!VALID_PLATFORMS.has(platform as string)) {
        errors.push(`platform "${platform}" is not recognized; valid: ${[...VALID_PLATFORMS].join(", ")}`);
      }
    }
  }

  if (s.author && typeof s.author === "object") {
    const author = s.author as Record<string, unknown>;
    if (author.identity && typeof author.identity !== "string") {
      errors.push("author.identity must be a string when present");
    }
    if (author.signing_key && typeof author.signing_key !== "string") {
      errors.push("author.signing_key must be a string when present");
    }
  }

  if (s.scan_status && typeof s.scan_status === "object") {
    const scan = s.scan_status as Record<string, unknown>;
    if (scan.last_scanned && typeof scan.last_scanned !== "string") {
      errors.push("scan_status.last_scanned must be a string when present");
    }
    if (scan.result && typeof scan.result !== "string") {
      errors.push("scan_status.result must be a string when present");
    }
  }

  if (s.changelog && Array.isArray(s.changelog)) {
    for (const entry of s.changelog) {
      if (entry && typeof entry === "object") {
        const e = entry as Record<string, unknown>;
        if (e.version && typeof e.version !== "string") {
          errors.push("changelog entries must have string version when present");
        }
        if (e.date && typeof e.date !== "string") {
          errors.push("changelog entries must have string date when present");
        }
      }
    }
  }

  if (s.permissions && typeof s.permissions === "object") {
    const permWarnings = validateSkillPermissions(
      (s.id as string) || 'unknown',
      s.permissions as Record<string, unknown>,
    );
    for (const warning of permWarnings) {
      console.warn(`[tori-core] Agent spec ${s.id}: ${warning}`);
    }
  }

  return errors;
}

export function mergePermissions(
  base: AgentPermissions,
  override: AgentPermissions,
): AgentPermissions {
  return { ...base, ...override };
}

export function mergeWritePolicyIntoPermissions(
  base: Record<string, unknown>,
  policy: WritePolicy,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };

  const writeEntry: Record<string, string> = { "*": "deny" };
  for (const path of policy.allow_paths) {
    writeEntry[path] = "allow";
  }
  for (const path of policy.deny_paths) {
    writeEntry[path] = "deny";
  }

  result["write"] = writeEntry;
  result["edit"] = writeEntry;

  return result;
}

export { mergePermissionSets } from "../runtime/permissions.js";
export { buildHierarchy, matchPersona } from "../runtime/persona-registry.js";
export type { PersonaHierarchy, PersonaMatch } from "../types/persona.js";

export async function buildPersonaHierarchy(): Promise<PersonaHierarchy> {
  const specs = await loadAgentSpecs();
  return buildHierarchy(specs);
}

export async function matchPersonaForTask(taskDescription: string): Promise<PersonaMatch | null> {
  const hierarchy = await buildPersonaHierarchy();
  return matchPersona(taskDescription, hierarchy);
}

export async function expandPersonas(
  spec: AgentSpec,
): Promise<CompiledAgent[]> {
  const entries = spec.personas ?? spec.modes;

  if (!entries) {
    const agent = await compileAgent(spec);
    return agent ? [agent] : [];
  }

  const basePrompt = await loadPrompt(spec.prompt);
  if (!basePrompt) {
    console.warn(
      `[tori-core] Prompt not found for agent "${spec.id}": ${spec.prompt}`,
    );
    return [];
  }

  const references = await loadReferences(spec.references);
  const referencesText = references ? `${references}\n\n` : "";

  const results: CompiledAgent[] = [];

  for (const [key, entry] of Object.entries(entries)) {
    const instructions = await loadPrompt(entry.instructions);
    if (!instructions) {
      console.warn(
        `[tori-core] Instructions not found for "${spec.id}:${key}": ${entry.instructions}`,
      );
      continue;
    }

    const mergedPerms = entry.permissions
      ? mergePermissions(spec.permissions, entry.permissions)
      : spec.permissions;

    results.push({
      id: `${spec.id}:${key}`,
      description: entry.description,
      temperature: spec.temperature,
      mode: spec.mode,
      color: spec.color ?? "info",
      prompt: `${referencesText}${basePrompt}\n\n${instructions}`,
      permission: buildPermissions(mergedPerms),
      humanTone: spec.human_tone,
    });
  }

  return results;
}

export async function loadAndCompileAllAgents(): Promise<CompiledAgent[]> {
  const specs = await loadAgentSpecs();
  const compiled: CompiledAgent[] = [];

  for (const spec of specs) {
    const agents = await expandPersonas(spec);
    compiled.push(...agents);
  }

  return compiled;
}
