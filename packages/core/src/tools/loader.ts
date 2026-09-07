/**
 * @file packages/core/src/tools/loader.ts
 * @description Utility functions for loading prompt files and other resources.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load the human tone prompt from the prompts directory.
 * Returns empty string if the file doesn't exist (silent disable).
 */
export async function loadHumanTone(): Promise<string> {
  const humanTonePath = join(__dirname, "..", "spec", "prompts", "human-tone.md");
  
  try {
    const content = await readFile(humanTonePath, "utf-8");
    return content.trim();
  } catch {
    // File doesn't exist or can't be read - return empty string to disable injection silently
    return "";
  }
}