import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// From dist/plugin/ (or src/plugin/), two levels up lands in packages/core/,
// then into spec/ — same resolution pattern as src/codegen/loader.ts.
const SKILL_BASE = join(__dirname, '..', '..', 'spec', 'skills', 'spec-writer');

export interface SkillRegistry {
  [name: string]: {
    name: string;
    description: string;
    content: Record<string, string>;
    resources: Record<string, string>;
  };
}

const SPEC_WRITER_REQUIRED_KEYS = ['guide', 'template', 'checklist'];

export async function loadSpecWriterSkill(): Promise<SkillRegistry> {
  const skill: Record<string, string | string[]> = { available: [] as string[] };

  const resources: Record<string, string> = {
    template: join(SKILL_BASE, 'template.md'),
    checklist: join(SKILL_BASE, 'checklist.md'),
    examples: join(SKILL_BASE, 'examples'),
  };

  try {
    skill.guide = await readFile(join(SKILL_BASE, 'SKILL.md'), 'utf-8');
    (skill.available as string[]).push('guide');
  } catch (err) {
    console.warn(`[tori-core] Failed to load spec-writer SKILL.md:`, (err as Error).message);
  }

  try {
    skill.template = await readFile(join(SKILL_BASE, 'template.md'), 'utf-8');
    (skill.available as string[]).push('template');
  } catch (err) {
    console.warn(`[tori-core] Failed to load spec-writer template.md:`, (err as Error).message);
  }

  try {
    skill.checklist = await readFile(join(SKILL_BASE, 'checklist.md'), 'utf-8');
    (skill.available as string[]).push('checklist');
  } catch (err) {
    console.warn(`[tori-core] Failed to load spec-writer checklist.md:`, (err as Error).message);
  }

  const missing = SPEC_WRITER_REQUIRED_KEYS.filter(k => !(skill.available as string[]).includes(k));
  if (missing.length > 0) {
    const fileMap: Record<string, string> = { guide: 'SKILL.md', template: 'template.md', checklist: 'checklist.md' };
    const missingFiles = missing.map(k => fileMap[k]);
    console.warn(`[tori-core] spec-writer skill incomplete — missing files: ${missingFiles.join(', ')}`);
  }

  return {
    'spec-writer': {
      name: 'spec-writer',
      description:
        'Provides templates, examples, and validation checklists for writing agent specification files.',
      get content() {
        const missing = SPEC_WRITER_REQUIRED_KEYS.filter(k => !(skill.available as string[]).includes(k));
        if (missing.length > 0) {
          throw new Error(`spec-writer skill incomplete — missing: ${missing.join(', ')}. Check plugin initialization logs.`);
        }
        return skill as Record<string, string>;
      },
      resources,
    },
  };
}
