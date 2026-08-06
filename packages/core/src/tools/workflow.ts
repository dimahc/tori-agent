// packages/core/src/tools/workflow.ts
// Workflow state management for the Tori workflow/state-machine model.
// Stores workflow state as markdown files with YAML frontmatter,
// consistent with the existing exec-plan / spec / brief artifact model.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, isAbsolute, resolve, sep } from 'node:path';
import { existsSync } from 'node:fs';
import { markBlockDone } from '../tools/lifecycle.js';

export interface WorkflowPaths {
  workflows: string;
}

export interface WorkflowState {
  id: string;
  workflow: string;
  current_stage: string;
  iteration: number;
  max_iterations: number;
  status: 'active' | 'done' | 'needs_human';
  created: string;
  deliberation_count: number;
}

export interface WorkflowTask {
  id: string;
  agent: string;
  status: 'pending' | 'running' | 'done' | 'failed';
}

export interface WorkflowFile {
  state: WorkflowState;
  tasks: WorkflowTask[];
  checks: Array<{ name: string; status: string; detail?: string }>;
}

// ── Path helpers ─────────────────────────────────────────────────────────────

function resolveArtifact(projectRoot: string, relPath: string): string {
  const resolved = isAbsolute(relPath) ? relPath : join(projectRoot, relPath);
  const normalizedRoot = resolve(projectRoot) + sep;
  const normalizedPath = resolve(resolved);
  if (!normalizedPath.startsWith(normalizedRoot)) {
    throw new Error(`Path escapes project root: ${relPath}`);
  }
  return normalizedPath;
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key) result[key] = value;
  }
  return result;
}

function setFrontmatterField(content: string, key: string, value: string): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const fmMatch = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!fmMatch) {
    return `---${eol}${key}: ${value}${eol}---${eol}${eol}${content}`;
  }
  const [full, open, body, close] = fmMatch;
  const lines = body.split(/\r?\n/);
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keyRegex = new RegExp(`^${escapedKey}\\s*:`, 'm');
  const idx = lines.findIndex((l) => keyRegex.test(l));
  if (idx !== -1) {
    lines[idx] = `${key}: ${value}`;
  } else {
    lines.push(`${key}: ${value}`);
  }
  return content.replace(full, `${open}${lines.join(eol)}${close}`);
}

function countCheckboxes(content: string, section: string): { total: number; checked: number } {
  const sectionStart = content.indexOf(`## ${section}`);
  if (sectionStart === -1) return { total: 0, checked: 0 };
  const nextSection = content.indexOf('\n## ', sectionStart + 1);
  const sectionContent = nextSection === -1 ? content.slice(sectionStart) : content.slice(sectionStart, nextSection);
  const checked = (sectionContent.match(/^- \[x\]/gm) ?? []).length;
  const unchecked = (sectionContent.match(/^- \[ \]/gm) ?? []).length;
  return { total: checked + unchecked, checked };
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function createWorkflow(projectRoot: string, paths: WorkflowPaths, workflowId: string, definition: Partial<WorkflowState>): Promise<string> {
  const absDir = join(projectRoot, paths.workflows);
  await mkdir(absDir, { recursive: true });

  const absPath = join(absDir, `${workflowId}.md`);
  if (existsSync(absPath)) {
    throw new Error(`Workflow '${workflowId}' already exists.`);
  }

  const now = new Date().toISOString().slice(0, 10);
  const state: WorkflowState = {
    id: workflowId,
    workflow: definition.workflow ?? 'unknown',
    current_stage: definition.current_stage ?? 'new',
    iteration: definition.iteration ?? 0,
    max_iterations: definition.max_iterations ?? 2,
    status: definition.status ?? 'active',
    created: now,
    deliberation_count: 0,
  };

  const frontmatter = `---\nid: ${state.id}\nworkflow: ${state.workflow}\ncurrent_stage: ${state.current_stage}\niteration: ${state.iteration}\nmax_iterations: ${state.max_iterations}\nstatus: ${state.status}\ncreated: ${state.created}\ndeliberation_count: ${state.deliberation_count}\n---\n\n# Workflow: ${state.workflow}\n\n## Tasks\n\n## Checks\n`;

  await writeFile(absPath, frontmatter, 'utf-8');
  return workflowId;
}

export async function getWorkflowState(projectRoot: string, paths: WorkflowPaths, workflowId: string): Promise<WorkflowFile | null> {
  const relPath = join(paths.workflows, `${workflowId}.md`);
  const absPath = resolveArtifact(projectRoot, relPath);

  try {
    const content = await readFile(absPath, 'utf-8');
    const fm = parseFrontmatter(content);

    const state: WorkflowState = {
      id: fm.id ?? workflowId,
      workflow: fm.workflow ?? 'unknown',
      current_stage: fm.current_stage ?? 'new',
      iteration: Number(fm.iteration ?? 0),
      max_iterations: Number(fm.max_iterations ?? 2),
      status: (fm.status as WorkflowState['status']) ?? 'active',
      created: fm.created ?? new Date().toISOString().slice(0, 10),
      deliberation_count: Number(fm.deliberation_count ?? 0),
    };

    const tasks: WorkflowTask[] = [];
    const taskSection = content.match(/## Tasks\n([\s\S]*?)(?=\n## |$)/);
    if (taskSection) {
      const taskRegex = /^- \[([ x])\] (\S+) \((\S+)\) — status: (\S+)/g;
      let match;
      while ((match = taskRegex.exec(taskSection[1])) !== null) {
        tasks.push({
          id: match[2],
          agent: match[3],
          status: match[4] as WorkflowTask['status'],
        });
      }
    }

    const checks: Array<{ name: string; status: string; detail?: string }> = [];
    const checkSection = content.match(/## Checks\n([\s\S]*?)(?=\n## |$)/);
    if (checkSection) {
      const checkRegex = /^- \[([ x])\] (\S+) — (\S+)(?: \((.+)\))?/g;
      let match;
      while ((match = checkRegex.exec(checkSection[1])) !== null) {
        checks.push({
          name: match[2],
          status: match[3],
          detail: match[4],
        });
      }
    }

    return { state, tasks, checks };
  } catch {
    return null;
  }
}

export async function incrementDeliberationCount(projectRoot: string, paths: WorkflowPaths, workflowId: string): Promise<number> {
  const relPath = join(paths.workflows, `${workflowId}.md`);
  const absPath = resolveArtifact(projectRoot, relPath);

  let content: string;
  try {
    content = await readFile(absPath, 'utf-8');
  } catch {
    throw new Error(`Workflow not found: ${workflowId}`);
  }

  const fm = parseFrontmatter(content);
  const current = Number(fm.deliberation_count ?? 0);
  const updated = setFrontmatterField(content, 'deliberation_count', String(current + 1));
  await writeFile(absPath, updated, 'utf-8');
  return current + 1;
}

export async function transitionStage(projectRoot: string, paths: WorkflowPaths, workflowId: string, toStage: string): Promise<WorkflowFile> {
  const relPath = join(paths.workflows, `${workflowId}.md`);
  const absPath = resolveArtifact(projectRoot, relPath);

  let content: string;
  try {
    content = await readFile(absPath, 'utf-8');
  } catch {
    throw new Error(`Workflow not found: ${workflowId}`);
  }

  const validTransitions: Record<string, string[]> = {
    'new': ['requirements'],
    'requirements': ['plan'],
    'plan': ['execute'],
    'execute': ['verify'],
    'verify': ['done', 'execute', 'needs_human'],
    'done': [],
    'needs_human': [],
  };

  const fm = parseFrontmatter(content);
  const currentStage = fm.current_stage ?? 'new';
  const allowed = validTransitions[currentStage] ?? [];

  if (!allowed.includes(toStage)) {
    throw new Error(`Invalid transition: ${currentStage} → ${toStage}. Allowed: ${allowed.join(', ') || 'none (terminal state)'}`);
  }

  let updated = setFrontmatterField(content, 'current_stage', toStage);
  updated = setFrontmatterField(updated, 'deliberation_count', '0');
  if (toStage === 'execute') {
    const iteration = Number(fm.iteration ?? 0) + 1;
    updated = setFrontmatterField(updated, 'iteration', String(iteration));
  }
  if (toStage === 'done') {
    updated = setFrontmatterField(updated, 'status', 'done');
  }
  if (toStage === 'needs_human') {
    updated = setFrontmatterField(updated, 'status', 'needs_human');
  }

  await writeFile(absPath, updated, 'utf-8');

  const state = await getWorkflowState(projectRoot, paths, workflowId);
  if (!state) {
    throw new Error(`Workflow state lost after transition: ${workflowId}`);
  }
  return state;
}

export async function recordTaskResult(projectRoot: string, paths: WorkflowPaths, workflowId: string, taskId: string, agent: string, status: 'done' | 'failed' | 'running' | 'pending', planFile?: string, blockName?: string): Promise<void> {
  const relPath = join(paths.workflows, `${workflowId}.md`);
  const absPath = resolveArtifact(projectRoot, relPath);

  let content: string;
  try {
    content = await readFile(absPath, 'utf-8');
  } catch {
    throw new Error(`Workflow not found: ${workflowId}`);
  }

  const taskLine = `- [${status === 'done' ? 'x' : ' '}] ${taskId} (${agent}) — status: ${status}`;

  const tasksSectionIndex = content.indexOf('## Tasks');
  const checksSectionIndex = content.indexOf('## Checks');

  if (tasksSectionIndex === -1) {
    throw new Error(`Malformed workflow file: ${workflowId}`);
  }

  const insertPoint = checksSectionIndex === -1 ? content.length : checksSectionIndex;
  const taskRegex = new RegExp(`^- \\[. \\] ${taskId} \\(\\S+\\) — status: \\S+`, 'm');
  const existingMatch = content.match(taskRegex);

  let updated: string;
  if (existingMatch) {
    updated = content.replace(taskRegex, taskLine);
  } else {
    const tasksBlock = content.slice(tasksSectionIndex, insertPoint).trimEnd();
    updated = content.replace(tasksBlock, `${tasksBlock}\n${taskLine}`);
  }

  await writeFile(absPath, updated, 'utf-8');

  if (status === 'done' && planFile && blockName) {
    await markBlockDone(projectRoot, planFile, blockName);
  }
}

export async function recordCheckResult(projectRoot: string, paths: WorkflowPaths, workflowId: string, checkName: string, status: 'PASS' | 'FAIL' | 'SKIP', detail?: string): Promise<void> {
  const relPath = join(paths.workflows, `${workflowId}.md`);
  const absPath = resolveArtifact(projectRoot, relPath);

  let content: string;
  try {
    content = await readFile(absPath, 'utf-8');
  } catch {
    throw new Error(`Workflow not found: ${workflowId}`);
  }

  const checkLine = detail
    ? `- [${status === 'PASS' ? 'x' : ' '}] ${checkName} — ${status} (${detail})`
    : `- [${status === 'PASS' ? 'x' : ' '}] ${checkName} — ${status}`;

  const checksSectionIndex = content.indexOf('## Checks');
  if (checksSectionIndex === -1) {
    throw new Error(`Malformed workflow file: ${workflowId}`);
  }

  const checkRegex = new RegExp(`^- \\[. \\] ${checkName} — \\S+`, 'm');
  const existingMatch = content.match(checkRegex);

  let updated: string;
  if (existingMatch) {
    updated = content.replace(checkRegex, checkLine);
  } else {
    updated = content.replace('## Checks', `## Checks\n\n${checkLine}`);
  }

  await writeFile(absPath, updated, 'utf-8');
}
