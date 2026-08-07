import yaml from "js-yaml";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentPermissions, AgentSpec, CompiledAgent } from "./types.js";
import { mergePermissionSets } from "../runtime/permissions.js";

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

  const permission = buildPermissions(spec.permissions);

  return {
    id: spec.id,
    description: spec.description,
    temperature: spec.temperature,
    mode: spec.mode,
    color: spec.color ?? "info",
    prompt: promptContent,
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

  return result;
}

export function mergePermissions(
  base: AgentPermissions,
  override: AgentPermissions,
): AgentPermissions {
  return { ...base, ...override };
}

export { mergePermissionSets } from "../runtime/permissions.js";

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
      prompt: `${basePrompt}\n\n${instructions}`,
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
