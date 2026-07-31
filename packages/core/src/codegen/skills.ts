import type { Dirent } from "node:fs";
import { cp, mkdir, readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface BuiltinSkill {
  name: string;
  description: string;
  path: string;
}

export interface SyncedSkill {
  name: string;
  files: string[];
}

function resolveSkillsDir(): string {
  return join(__dirname, "..", "..", "spec", "skills");
}

function parseFrontmatter(
  content: string,
): { name?: unknown; description?: unknown } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return null;
  const parsed = yaml.load(match[1]);
  if (parsed && typeof parsed === "object") {
    return parsed as { name?: unknown; description?: unknown };
  }
  return null;
}

export async function listBuiltinSkills(): Promise<BuiltinSkill[]> {
  const skillsDir = resolveSkillsDir();

  let entries: Dirent[];
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch {
    console.warn(
      "[tori-core] spec/skills/ not found — no builtin skills available",
    );
    return [];
  }

  const skills: BuiltinSkill[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillPath = join(skillsDir, entry.name);
    try {
      const content = await readFile(join(skillPath, "SKILL.md"), "utf-8");
      const frontmatter = parseFrontmatter(content);
      if (frontmatter && typeof frontmatter.name === "string") {
        skills.push({
          name: frontmatter.name,
          description:
            typeof frontmatter.description === "string"
              ? frontmatter.description
              : "",
          path: skillPath,
        });
      }
    } catch (err) {
      console.warn(
        `[tori-core] Failed to load builtin skill ${entry.name}:`,
        (err as Error).message,
      );
    }
  }

  return skills;
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

async function copySkillDirectory(
  src: string,
  dest: string,
): Promise<string[]> {
  const files = await listFilesRecursive(src);
  // fs.cp is available since Node 16.7 and required by engines (>=18), so the
  // recursive copy is guaranteed to succeed on supported runtimes.
  await cp(src, dest, { recursive: true });
  return files.map((file) => relative(src, file));
}

export async function syncBuiltinSkills(
  targetSkillsDir: string,
): Promise<SyncedSkill[]> {
  const skills = await listBuiltinSkills();
  const synced: SyncedSkill[] = [];

  for (const skill of skills) {
    const targetDir = join(targetSkillsDir, basename(skill.path));
    try {
      await mkdir(targetDir, { recursive: true });
      const files = await copySkillDirectory(skill.path, targetDir);
      synced.push({ name: skill.name, files });
    } catch (err) {
      console.warn(
        `[tori-core] Failed to sync builtin skill ${skill.name}:`,
        (err as Error).message,
      );
    }
  }

  return synced;
}
