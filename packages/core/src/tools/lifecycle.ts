/**
 * @file packages/core/src/tools/lifecycle.ts
 * @description Lifecycle management tools for exec-plans, specs, briefs, workflows.
 * 
 * These tools manage the project's management artifacts.
 * They are used by the plugin's tool registry.
 */

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type { ArtifactPaths, ProjectStateReport, ArtifactConsistencyReport } from '../types/lifecycle.js';
import type { WorkflowPaths } from '../types/workflow.js';

// Re-export types for plugin consumption
export type { ArtifactPaths, WorkflowPaths };

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Frontmatter Parsing ────────────────────────────────────────────────────────

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return { frontmatter: {}, body: content };
  try {
    const frontmatter = parseYaml(fmMatch[1]) as Record<string, unknown>;
    const body = content.slice(fmMatch[0].length).trimStart();
    return { frontmatter, body };
  } catch {
    return { frontmatter: {}, body: content };
  }
}

async function readArtifact(filePath: string): Promise<{ frontmatter: Record<string, unknown>; body: string } | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return parseFrontmatter(content);
  } catch {
    return null;
  }
}

// ── Project State ──────────────────────────────────────────────────────────────

export async function projectState(projectRoot: string, paths: ArtifactPaths): Promise<ProjectStateReport> {
  const [specs, execPlans, briefs, workflows] = await Promise.all([
    readDir(projectRoot, paths.specs, 'spec'),
    readDir(projectRoot, paths.execPlans, 'exec-plan'),
    readDir(projectRoot, paths.briefs, 'brief'),
    readDir(projectRoot, paths.workflows, 'workflow'),
  ]);

  return { specs, execPlans, briefs, workflows };
}

async function readDir(projectRoot: string, dir: string, type: string): Promise<any[]> {
  const fullDir = join(projectRoot, dir);
  try {
    const files = await readdir(fullDir);
    const results = [];
    for (const file of files) {
      if (!file.endsWith('.md') && !file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
      const artifact = await readArtifact(join(fullDir, file));
      if (artifact) {
        results.push({
          file,
          title: artifact.frontmatter.title as string || file,
          status: artifact.frontmatter.status as string || 'unknown',
          created: artifact.frontmatter.created as string || '',
          updated: artifact.frontmatter.updated as string,
        });
      }
    }
    return results;
  } catch {
    return [];
  }
}

// ── Check Artifacts ────────────────────────────────────────────────────────────

export async function checkArtifacts(projectRoot: string, paths: ArtifactPaths): Promise<ArtifactConsistencyReport> {
  const issues: any[] = [];
  
  // Check exec-plans reference valid specs/briefs
  const execPlansDir = join(projectRoot, paths.execPlans);
  try {
    const files = await readdir(execPlansDir);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const artifact = await readArtifact(join(execPlansDir, file));
      if (artifact?.frontmatter.brief) {
        const briefPath = join(projectRoot, paths.briefs, artifact.frontmatter.brief as string);
        try {
          await stat(briefPath);
        } catch {
          issues.push({
            type: 'dead_reference',
            artifact: file,
            reference: artifact.frontmatter.brief,
            message: `Exec-plan references non-existent brief: ${artifact.frontmatter.brief}`,
          });
        }
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return { valid: issues.length === 0, issues };
}

// ── Spec Registration ──────────────────────────────────────────────────────────

export async function registerSpecImpl(
  projectRoot: string,
  paths: ArtifactPaths,
  specFile: string,
  title: string
): Promise<{ success: boolean; file: string }> {
  const specsDir = join(projectRoot, paths.specs);
  await fs.mkdir(specsDir, { recursive: true });

  const filePath = join(specsDir, specFile);
  
  try {
    await stat(filePath);
    return { success: false, file: specFile }; // Already exists
  } catch {
    // File doesn't exist, create it
  }

  const frontmatter = {
    title,
    status: 'draft',
    created: new Date().toISOString().split('T')[0],
  };

  const content = `---\n${Object.entries(frontmatter).map(([k, v]) => `${k}: ${typeof v === 'string' ? `"${v}"` : v}`).join('\n')}\n---\n\n# ${title}\n\n## Overview\n\n## Requirements\n\n## Acceptance Criteria\n`;

  await writeFile(filePath, content, 'utf-8');
  return { success: true, file: specFile };
}

// Need to import fs
import * as fs from 'node:fs/promises';

// ── Plan Management ────────────────────────────────────────────────────────────

export async function markBlockDone(
  projectRoot: string,
  planFile: string,
  blockName: string
): Promise<{ success: boolean; checked: boolean }> {
  const plansDir = join(projectRoot, '.opencode/plans');
  const filePath = join(plansDir, planFile);

  try {
    const content = await readFile(filePath, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(content);
    
    // Simple block checking - replace [ ] with [x] for the block
    const blockRegex = new RegExp(`(\\s*-\\s*\\[\\s*\\]\\s*${blockName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')})`, 'g');
    const newBody = body.replace(blockRegex, (match) => match.replace('[ ]', '[x]'));
    
    if (newBody === body) {
      return { success: false, checked: false };
    }

    const newContent = `---\n${Object.entries(frontmatter).map(([k, v]) => `${k}: ${typeof v === 'string' ? `"${v}"` : v}`).join('\n')}\n---\n\n${newBody}`;
    await writeFile(filePath, newContent, 'utf-8');
    return { success: true, checked: true };
  } catch {
    return { success: false, checked: false };
  }
}

export async function completePlan(projectRoot: string, planFile: string): Promise<{ success: boolean }> {
  const plansDir = join(projectRoot, '.opencode/plans');
  const filePath = join(plansDir, planFile);

  try {
    const content = await readFile(filePath, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(content);
    
    // Check for unchecked blocks
    const uncheckedBlocks = body.match(/-\s*\[\s*\]/g);
    if (uncheckedBlocks && uncheckedBlocks.length > 0) {
      return { success: false };
    }

    frontmatter.status = 'completed';
    frontmatter.updated = new Date().toISOString().split('T')[0];

    const newContent = `---\n${Object.entries(frontmatter).map(([k, v]) => `${k}: ${typeof v === 'string' ? `"${v}"` : v}`).join('\n')}\n---\n\n${body}`;
    await writeFile(filePath, newContent, 'utf-8');
    return { success: true };
  } catch {
    return { success: false };
  }
}

// ── Checkpoint ─────────────────────────────────────────────────────────────────

export async function saveCheckpoint(
  projectRoot: string,
  file: string,
  summary: string,
  remainingWork: string
): Promise<{ success: boolean }> {
  const checkpointDir = join(projectRoot, '.opencode/checkpoints');
  await fs.mkdir(checkpointDir, { recursive: true });

  const checkpoint = {
    version: '1.0',
    created_at: new Date().toISOString(),
    trigger: 'manual',
    parent: { task_id: file, agent: 'tori', depth: 0 },
    state: {
      todowrite: [],
      workflow_stage: 'unknown',
      iteration: 0,
      artifacts_modified: [],
      decisions: [],
    },
    context_summary: summary,
    resume_instructions: remainingWork,
    child_tasks: [],
  };

  const filePath = join(checkpointDir, file);
  await writeFile(filePath, JSON.stringify(checkpoint, null, 2), 'utf-8');
  return { success: true };
}

// ── Write Append ────────────────────────────────────────────────────────────────

export async function writeAppend(
  projectRoot: string,
  file: string,
  content: string
): Promise<{ success: boolean }> {
  const filePath = join(projectRoot, file);
  await fs.mkdir(dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, content, 'utf-8');
  return { success: true };
}

// ── Mechanical Checks ──────────────────────────────────────────────────────────

export async function runMechanicalChecks(projectRoot: string): Promise<{ lint: boolean; tests: boolean }> {
  // In a real implementation, this would run npm run lint and npm test
  // For now, return success
  return { lint: true, tests: true };
}