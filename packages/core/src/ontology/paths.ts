import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIST_DIR = dirname(fileURLToPath(import.meta.url));

export function getBuiltinOntologySpecDir(): string {
  return join(DIST_DIR, "..", "..", "spec", "ontology");
}

export function getBuiltinOntologyPromptDir(): string {
  return join(getBuiltinOntologySpecDir(), "prompts");
}

export function getBuiltinSkillsDir(): string {
  return join(DIST_DIR, "..", "..", "spec", "skills");
}
