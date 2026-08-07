import { readFileSync, existsSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { TaskBudget } from '../types/budget.js';
import type { TaskClassification } from '../types/classification.js';
import { updateBudgetConsumption, shouldCheckpoint, advanceCheckpoint } from '../tools/budget.js';
import { writeCheckpoint } from '../tools/checkpoint.js';
import type { Checkpoint } from '../types/checkpoint.js';
import { createCancellationToken, clearCancellation } from './feedback.js';

const DEBOUNCE_MS = 200;

let storePath = '';
let projectRoot = '';
let data: Record<string, { agent: string; timestamp: number }> = {};
let dirty = false;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

const budgets = new Map<string, TaskBudget>();
const timeoutTimers = new Map<string, ReturnType<typeof setTimeout>>();
const cancellationToken = createCancellationToken();
const classifications = new Map<string, TaskClassification>();

export function setClassification(taskId: string, classification: TaskClassification): void {
  classifications.set(taskId, classification);
}

export function getClassification(taskId: string): TaskClassification | undefined {
  return classifications.get(taskId);
}

export function clearClassification(taskId: string): void {
  classifications.delete(taskId);
}

export function setProjectRoot(root: string): void {
  projectRoot = root;
}

export function initSessionStore(configDir: string): void {
  storePath = join(configDir, '.tori-sessions.json');
  if (existsSync(storePath)) {
    try {
      data = JSON.parse(readFileSync(storePath, 'utf-8'));
    } catch {
      data = {};
    }
  }
}

function scheduleWrite(): void {
  dirty = true;
  if (writeTimer) return;
  writeTimer = setTimeout(async () => {
    if (!dirty) {
      writeTimer = null;
      return;
    }
    dirty = false;
    writeTimer = null;
    try {
      await mkdir(dirname(storePath), { recursive: true });
      await writeFile(storePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[tori-core] Failed to persist sessions:', err);
    }
  }, DEBOUNCE_MS);
}

export function trackSessionAgent(sessionID: string, agent?: string): void {
  if (agent) {
    data[sessionID] = { agent, timestamp: Date.now() };
    scheduleWrite();
  }
}

export function agentForSession(sessionID: string): string | undefined {
  return data[sessionID]?.agent;
}

export function clearSession(sessionID: string): void {
  delete data[sessionID];
  clearCancellation(sessionID);
  scheduleWrite();
}

export function cancelSession(sessionID: string): void {
  cancellationToken.cancel(sessionID);
}

export function isSessionCancelled(sessionID: string): boolean {
  return cancellationToken.isCancelled(sessionID);
}

export function persistNow(): Promise<void> {
  dirty = false;
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  const dir = dirname(storePath);
  return mkdir(dir, { recursive: true }).then(() => writeFile(storePath, JSON.stringify(data, null, 2), 'utf-8'));
}

export function setBudget(sessionID: string, budget: TaskBudget): void {
  budgets.set(sessionID, budget);
  if (timeoutTimers.has(sessionID)) {
    clearTimeout(timeoutTimers.get(sessionID)!);
  }
  timeoutTimers.set(sessionID, setTimeout(() => handleTimeout(sessionID), budget.timeout_ms));
}

export function getBudget(sessionID: string): TaskBudget | undefined {
  return budgets.get(sessionID);
}

export function clearBudget(sessionID: string): void {
  budgets.delete(sessionID);
  if (timeoutTimers.has(sessionID)) {
    clearTimeout(timeoutTimers.get(sessionID)!);
    timeoutTimers.delete(sessionID);
  }
}

export function updateSessionBudget(sessionID: string, tokensUsed: number, toolCallsUsed: number): TaskBudget | undefined {
  const budget = budgets.get(sessionID);
  if (!budget) return undefined;
  const updated = updateBudgetConsumption(budget, tokensUsed, toolCallsUsed);
  budgets.set(sessionID, updated);
  return updated;
}

export function checkSessionBudget(sessionID: string): { needsCheckpoint: boolean; exhausted: boolean } | undefined {
  const budget = budgets.get(sessionID);
  if (!budget) return undefined;
  return {
    needsCheckpoint: shouldCheckpoint(budget),
    exhausted: budget.tokens.consumed >= budget.tokens.allocated,
  };
}

async function handleTimeout(sessionID: string): Promise<void> {
  const budget = budgets.get(sessionID);
  if (!budget) return;
  const checkpoint: Checkpoint = {
    version: '1.0',
    created_at: new Date().toISOString(),
    trigger: 'budget',
    parent: { task_id: sessionID, agent: '', depth: 0 },
    state: {
      todowrite: [],
      workflow_stage: 'timeout',
      iteration: 0,
      artifacts_modified: [],
      decisions: [],
    },
    context_summary: `Timeout after ${budget.timeout_ms}ms`,
    resume_instructions: 'Resume from timeout checkpoint',
    child_tasks: [],
  };
  try {
    await writeCheckpoint(projectRoot, `docs/checkpoints/${sessionID}-timeout.md`, checkpoint);
  } catch {
    // best effort
  }
  budgets.delete(sessionID);
  timeoutTimers.delete(sessionID);
}
