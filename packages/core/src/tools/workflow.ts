// packages/core/src/tools/workflow.ts
// Workflow state management for the Tori workflow/state-machine model.
// Stores workflow state as markdown files with YAML frontmatter,
// consistent with the existing exec-plan / spec / brief artifact model.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, isAbsolute, resolve, sep } from 'node:path';
import { existsSync } from 'node:fs';
import { markBlockDone } from '../tools/lifecycle.js';
import type { DelegationTree } from '../types/delegation.js';
import type { VerificationPolicy } from '../types/verification.js';
import type { GitDeliveryState } from '../types/git.js';
import type { ADR } from '../types/adr.js';
import type { RollbackPlan } from '../types/rollback.js';
import type { WritePolicy, WriteTier } from '../types/write-path.js';
import type { CIConfig } from '../types/ci.js';
import { trigger_ci_check } from './ci-hook.js';
import { DepthExceededError } from '../types/delegation.js';
import { emitProgress } from '../runtime/feedback.js';
import { isSessionCancelled } from '../runtime/session-store.js';
import { CancelledError } from '../types/feedback.js';

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
  checks: Array<{
    name: string;
    status: string;
    confidence?: number;
    auto_retry?: boolean;
    detail?: string;
    iteration?: number;
    max_iterations?: number;
  }>;
  delegation_tree?: DelegationTree;
  adrs: string[];
  git_delivery_state?: GitDeliveryState;
  write_policy?: WritePolicy;
  rollback_plan?: RollbackPlan;
  ci_config?: CIConfig;
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

function parseDelegationTree(fm: Record<string, string>): DelegationTree | undefined {
  const raw = fm.delegation_tree;
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as DelegationTree;
  } catch {
    return undefined;
  }
}

function serializeDelegationTree(tree: DelegationTree): string {
  return JSON.stringify(tree);
}

function parseGitDeliveryState(fm: Record<string, string>): GitDeliveryState | undefined {
  const raw = fm.git_delivery_state;
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as GitDeliveryState;
  } catch {
    return undefined;
  }
}

function parseAdrs(fm: Record<string, string>): string[] {
  const raw = fm.adrs;
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

function serializeADRs(adrs: string[]): string {
  return JSON.stringify(adrs);
}

function serializeGitDeliveryState(state: GitDeliveryState): string {
  return JSON.stringify(state);
}

function parseRollbackPlan(fm: Record<string, string>): RollbackPlan | undefined {
  const raw = fm.rollback_plan;
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as RollbackPlan;
  } catch {
    return undefined;
  }
}

function serializeRollbackPlan(plan: RollbackPlan): string {
  return JSON.stringify(plan);
}

function parseWritePolicy(fm: Record<string, string>): WritePolicy | undefined {
  const raw = fm.write_policy;
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as WritePolicy;
  } catch {
    return undefined;
  }
}

function serializeWritePolicy(policy: WritePolicy): string {
  return JSON.stringify(policy);
}

function parseCIConfig(fm: Record<string, string>): CIConfig | undefined {
  const raw = fm.ci_config;
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as CIConfig;
  } catch {
    return undefined;
  }
}

function serializeCIConfig(config: CIConfig): string {
  return JSON.stringify(config);
}

export function getDelegationTree(workflowFile: WorkflowFile): DelegationTree | undefined {
  return workflowFile.delegation_tree;
}

export function updateDelegationTree(workflowFile: WorkflowFile, tree: DelegationTree): WorkflowFile {
  return {
    ...workflowFile,
    delegation_tree: tree,
  };
}

export function getGitDeliveryState(workflowFile: WorkflowFile): GitDeliveryState | undefined {
  return workflowFile.git_delivery_state;
}

export function updateGitDeliveryState(workflowFile: WorkflowFile, state: GitDeliveryState): WorkflowFile {
  return {
    ...workflowFile,
    git_delivery_state: state,
  };
}

export function getADRs(workflowFile: WorkflowFile): string[] {
  return workflowFile.adrs;
}

export function updateADRs(workflowFile: WorkflowFile, adrs: string[]): WorkflowFile {
  return {
    ...workflowFile,
    adrs,
  };
}

export function getWritePolicy(workflowFile: WorkflowFile): WritePolicy | undefined {
  return workflowFile.write_policy;
}

export function updateWritePolicy(workflowFile: WorkflowFile, policy: WritePolicy): WorkflowFile {
  return {
    ...workflowFile,
    write_policy: policy,
  };
}

export function getRollbackPlan(workflowFile: WorkflowFile): RollbackPlan | undefined {
  return workflowFile.rollback_plan;
}

export function updateRollbackPlan(workflowFile: WorkflowFile, plan: RollbackPlan): WorkflowFile {
  return {
    ...workflowFile,
    rollback_plan: plan,
  };
}

export async function setWritePolicy(
  projectRoot: string,
  paths: WorkflowPaths,
  workflowId: string,
  tier: WriteTier,
  taskScope?: string,
): Promise<WritePolicy> {
  const { getWritePolicyForTier } = await import('../runtime/write-guard.js');
  const policy = getWritePolicyForTier(tier, taskScope);

  const relPath = join(paths.workflows, `${workflowId}.md`);
  const absPath = resolveArtifact(projectRoot, relPath);

  let content: string;
  try {
    content = await readFile(absPath, 'utf-8');
  } catch {
    throw new Error(`Workflow not found: ${workflowId}`);
  }

  const updated = setFrontmatterField(content, 'write_policy', JSON.stringify(policy));
  await writeFile(absPath, updated, 'utf-8');

  return policy;
}

export function linkADR(workflowFile: WorkflowFile, adrId: string): WorkflowFile {
  const existing = workflowFile.adrs ?? [];
  if (existing.includes(adrId)) return workflowFile;
  return updateADRs(workflowFile, [...existing, adrId]);
}

export function unlinkADR(workflowFile: WorkflowFile, adrId: string): WorkflowFile {
  const existing = workflowFile.adrs ?? [];
  return updateADRs(workflowFile, existing.filter((id) => id !== adrId));
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

  const defaultWritePolicy = JSON.stringify({ tier: 'standard', allow_paths: ['src/**', 'packages/**', 'docs/**', 'spec/**'], deny_paths: ['*.env', '**/.env', 'config/production/**'] });
  const frontmatter = `---\nid: ${state.id}\nworkflow: ${state.workflow}\ncurrent_stage: ${state.current_stage}\niteration: ${state.iteration}\nmax_iterations: ${state.max_iterations}\nstatus: ${state.status}\ncreated: ${state.created}\ndeliberation_count: ${state.deliberation_count}\ngit_delivery_state: ${JSON.stringify({ rollback_level: 'commit', push_boundary: 'manual', last_commit_sha: '' })}\nadrs: []\nwrite_policy: ${defaultWritePolicy}\nci_config: null\n---\n\n# Workflow: ${state.workflow}\n\n## Tasks\n\n## Checks\n`;

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

    const checks: Array<{
      name: string;
      status: string;
      confidence?: number;
      auto_retry?: boolean;
      detail?: string;
      iteration?: number;
      max_iterations?: number;
    }> = [];
    const checkSection = content.match(/## Checks\n([\s\S]*?)(?=\n## |$)/);
    if (checkSection) {
      const checkRegex = /^- \[([ x])\] (\S+) — (\S+)(?: \((.+)\))?/g;
      let match;
      while ((match = checkRegex.exec(checkSection[1])) !== null) {
        const raw = match[4];
        let confidence: number | undefined;
        let auto_retry: boolean | undefined;
        let detail: string | undefined;
        let iteration: number | undefined;
        let max_iterations: number | undefined;

        if (raw) {
          const confidenceMatch = raw.match(/confidence:\s*([0-9.]+)/);
          const autoRetryMatch = raw.match(/auto_retry:\s*(true|false)/);
          const iterationMatch = raw.match(/iteration:\s*(\d+)/);
          const maxIterationsMatch = raw.match(/max_iterations:\s*(\d+)/);
          if (confidenceMatch) {
            confidence = Number(confidenceMatch[1]);
          }
          if (autoRetryMatch) {
            auto_retry = autoRetryMatch[1] === 'true';
          }
          if (iterationMatch) {
            iteration = Number(iterationMatch[1]);
          }
          if (maxIterationsMatch) {
            max_iterations = Number(maxIterationsMatch[1]);
          }
          // Remove metadata tokens from detail
          let cleaned = raw
            .replace(/,\s*confidence:\s*[0-9.]+/g, '')
            .replace(/,\s*auto_retry:\s*(true|false)/g, '')
            .replace(/,\s*iteration:\s*\d+/g, '')
            .replace(/,\s*max_iterations:\s*\d+/g, '')
            .replace(/^,\s*/, '')
            .replace(/,\s*$/, '')
            .trim();
          if (cleaned) {
            detail = cleaned;
          }
        }

        checks.push({
          name: match[2],
          status: match[3],
          confidence,
          auto_retry,
          detail,
          iteration,
          max_iterations,
        });
      }
    }

    const delegationTree = parseDelegationTree(fm);
    const gitDeliveryState = parseGitDeliveryState(fm);
    const adrs = parseAdrs(fm);
    const writePolicy = parseWritePolicy(fm);
    const rollbackPlan = parseRollbackPlan(fm);
    const ciConfig = parseCIConfig(fm);

    return { state, tasks, checks, delegation_tree: delegationTree, adrs, git_delivery_state: gitDeliveryState, write_policy: writePolicy, rollback_plan: rollbackPlan, ci_config: ciConfig };
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

export async function transitionStage(
  projectRoot: string,
  paths: WorkflowPaths,
  workflowId: string,
  toStage: string,
  options?: {
    policy?: VerificationPolicy;
  },
): Promise<WorkflowFile> {
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
  const delegationTree = parseDelegationTree(fm);
  if (delegationTree && delegationTree.current_depth >= delegationTree.max_depth) {
    throw new DepthExceededError(delegationTree.current_depth + 1, delegationTree.max_depth, workflowId);
  }

  const currentStage = fm.current_stage ?? 'new';
  let allowed = validTransitions[currentStage] ?? [];

  const policy = options?.policy;
  if (currentStage === 'verify' && policy) {
    const workflowState = await getWorkflowState(projectRoot, paths, workflowId);
    if (workflowState) {
      let blocked = false;
      for (const check of workflowState.checks) {
        const policyCheck = policy.checks.find(c => c.name === check.name);
        if (policyCheck?.required) {
          const maxIter = check.max_iterations ?? policy.max_iterations;
          if ((check.iteration ?? 0) >= maxIter) {
            blocked = true;
            break;
          }
          if (check.confidence !== undefined && check.confidence < policy.escalate_threshold) {
            blocked = true;
            break;
          }
        }
      }
      if (blocked && toStage !== 'needs_human') {
        toStage = 'needs_human';
      }
    }
  }

  if (currentStage === 'verify' && toStage === 'execute') {
    const iteration = Number(fm.iteration ?? 0);
    if (iteration >= 2) {
      toStage = 'needs_human';
    }
  }

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

  const stagePercent: Record<string, number> = {
    new: 0,
    requirements: 20,
    plan: 40,
    execute: 60,
    verify: 80,
    done: 100,
    needs_human: 100,
  };

  emitProgress({
    session_id: workflowId,
    stage: toStage,
    percent: stagePercent[toStage] ?? 0,
    message: `Transitioned to ${toStage}`,
    timestamp: new Date().toISOString(),
  });

  if (toStage === 'verify') {
    const ciConfig = parseCIConfig(fm);
    if (ciConfig) {
      try {
        const ciResult = await trigger_ci_check(projectRoot, ciConfig, workflowId);
        const checkStatus = ciResult.status === 'passed' ? 'PASS' : ciResult.status === 'timeout' ? 'FAIL' : 'FAIL';
        await recordCheckResult(projectRoot, paths, workflowId, 'ci_check', checkStatus, ciResult.output, 0.8, false);
      } catch {
        await recordCheckResult(projectRoot, paths, workflowId, 'ci_check', 'FAIL', 'CI trigger failed', 0.5, false);
      }
    }
  }

  return state;
}

export async function recordTaskResult(projectRoot: string, paths: WorkflowPaths, workflowId: string, taskId: string, agent: string, status: 'done' | 'failed' | 'running' | 'pending', planFile?: string, blockName?: string, depth?: number): Promise<void> {
  const relPath = join(paths.workflows, `${workflowId}.md`);
  const absPath = resolveArtifact(projectRoot, relPath);

  let content: string;
  try {
    content = await readFile(absPath, 'utf-8');
  } catch {
    throw new Error(`Workflow not found: ${workflowId}`);
  }

  if (depth !== undefined) {
    const fm = parseFrontmatter(content);
    const delegationTree = parseDelegationTree(fm);
    if (delegationTree && depth > delegationTree.max_depth) {
      throw new DepthExceededError(depth, delegationTree.max_depth, workflowId);
    }
  }

  if (isSessionCancelled(workflowId)) {
    throw new CancelledError(workflowId);
  }

  const taskLine = `- [${status === 'done' ? 'x' : ' '}] ${taskId} (${agent}) — status: ${status}`;

  const tasksSectionIndex = content.indexOf('## Tasks');
  const checksSectionIndex = content.indexOf('## Checks');

  if (tasksSectionIndex === -1) {
    throw new Error(`Malformed workflow file: ${workflowId}`);
  }

  const insertPoint = checksSectionIndex === -1 ? content.length : checksSectionIndex;
  const taskRegex = new RegExp(`^- \[[ x]]\\] ${taskId} \\(\\S+\\) — status: \\S+`, 'm');
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

export async function recordCheckResult(
  projectRoot: string,
  paths: WorkflowPaths,
  workflowId: string,
  checkName: string,
  status: 'PASS' | 'FAIL' | 'SKIP',
  detail?: string,
  confidence: number = 0.5,
  auto_retry: boolean = true,
  max_iterations?: number,
): Promise<void> {
  const relPath = join(paths.workflows, `${workflowId}.md`);
  const absPath = resolveArtifact(projectRoot, relPath);

  let content: string;
  try {
    content = await readFile(absPath, 'utf-8');
  } catch {
    throw new Error(`Workflow not found: ${workflowId}`);
  }

  const checksSectionIndex = content.indexOf('## Checks');
  if (checksSectionIndex === -1) {
    throw new Error(`Malformed workflow file: ${workflowId}`);
  }

  const checkRegex = new RegExp(`^- \[[ x]]\\] ${checkName} — \\S+`, 'm');
  const existingMatch = content.match(checkRegex);

  let currentIteration = 0;
  if (existingMatch) {
    const raw = existingMatch[0].match(/— \S+ \((.+)\)/)?.[1];
    if (raw) {
      const iterMatch = raw.match(/iteration:\s*(\d+)/);
      if (iterMatch) {
        currentIteration = Number(iterMatch[1]);
      }
    }
  }
  const newIteration = currentIteration + 1;

  const parts = [`confidence: ${confidence}`, `auto_retry: ${auto_retry}`];
  if (detail) {
    parts.push(`detail: ${detail}`);
  }
  if (max_iterations !== undefined) {
    parts.push(`max_iterations: ${max_iterations}`);
  }
  parts.push(`iteration: ${newIteration}`);
  const parenthetical = parts.join(', ');

  const checkLine = `- [${status === 'PASS' ? 'x' : ' '}] ${checkName} — ${status} (${parenthetical})`;

  let updated: string;
  if (existingMatch) {
    updated = content.replace(checkRegex, checkLine);
  } else {
    updated = content.replace('## Checks', `## Checks\n\n${checkLine}`);
  }

  await writeFile(absPath, updated, 'utf-8');
}
