import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RuntimeId } from "@tori-agent/ontology";
import type { PluginInput, PluginOutput } from "./types.js";
import { buildPlugin } from "./plugin.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function detectRuntime(): RuntimeId {
  const env = process.env.TORI_RUNTIME;
  if (env === "opencode" || env === "kilocode") return env;
  const argv = process.argv.join(" ").toLowerCase();
  if (argv.includes("kilocode") || argv.includes("kilo")) return "kilocode";
  if (argv.includes("opencode")) return "opencode";
  return "opencode";
}

export function detectConfigDir(runtime: RuntimeId): string {
  const projectRoot = join(__dirname, "../../../");
  const home = homedir();
  const candidates = runtime === "opencode"
    ? [join(projectRoot, ".opencode"), join(home, ".config", "opencode")]
    : [join(projectRoot, ".kilocode"), join(home, ".config", "kilocode")];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[candidates.length - 1];
}

export async function createRuntimePlugin(options: { runtime?: RuntimeId; configPath?: string } = {}): Promise<(input: PluginInput) => Promise<PluginOutput>> {
  const runtime = options.runtime ?? detectRuntime();
  const configDir = options.configPath ? dirname(options.configPath) : detectConfigDir(runtime);
  const configPath = options.configPath ?? join(configDir, "AGENTS.md");
  return buildPlugin({ runtime, configPath });
}

const runtime = detectRuntime();
const configDir = detectConfigDir(runtime);
const configPath = join(configDir, "AGENTS.md");
const server = buildPlugin({ runtime, configPath });

export { runtime, configDir, configPath, server };
export default { server };
