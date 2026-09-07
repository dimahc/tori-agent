/**
 * @file packages/core/src/tools/workflow.ts
 * @description Workflow state machine tools.
 * 
 * Manages workflow state, tasks, and checks.
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type { WorkflowPaths, WorkflowStateData, VerificationPolicy } from '../types/workflow.js';

// Re-export types for plugin consumption
export type { WorkflowPaths };

const __dirname = dirname(fileURLToPath(import.meta.url));

const WORKFLOW_DIR = '.opencode/workflows';

function getWorkflowFile(projectRoot: string, workflowId: string): string {
  return join(projectRoot, WORKFLOW_DIR, `${workflowId}.yaml`);
}

function parseWorkflow(content: string): WorkflowStateData {
  const data = parseYaml(content) as WorkflowStateData;
  return {
    workflow_id: data.workflow_id,
    state: data.state || { current_stage: 'init', iteration: 0, status: 'active', started_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    tasks: data.tasks || [],
    checks: data.checks || [],
  };
}

function serializeWorkflow(data: WorkflowStateData): string {
  return `# Workflow: ${data.workflow_id}\nworkflow_id: ${data.workflow_id}\nstate:\n  current_stage: ${data.state.current_stage}\n  iteration: ${data.state.iteration}\n  status: ${data.state.status}\n  started_at: ${data.state.started_at}\n  updated_at: ${data.state.updated_at}\ntasks:\n${data.tasks.map(t => `  - task_id: ${t.task_id}\n    agent: ${t.agent}\n    status: ${t.status}\n    plan_file: ${t.plan_file || ''}\n    block_name: ${t.block_name || ''}\n    started_at: ${t.started_at || ''}\n    completed_at: ${t.completed_at || ''}\n    error: ${t.error || ''}`).join('\n')}\nchecks:\n${data.checks.map(c => `  - check_name: ${c.check_name}\n    status: ${c.status}\n    detail: ${c.detail}\n    max_iterations: ${c.max_iterations}\n    current_iteration: ${c.current_iteration}\n    timestamp: ${c.timestamp}`).join('\n')}\n`;
}

export async function getWorkflowState(
  projectRoot: string,
  paths: WorkflowPaths,
  workflowId: string
): Promise<WorkflowStateData | null> {
  const filePath = getWorkflowFile(projectRoot, workflowId);
  try {
    const content = await readFile(filePath, 'utf-8');
    return parseWorkflow(content);
  } catch {
    return null;
  }
}

export async function transitionStage(
  projectRoot: string,
  paths: WorkflowPaths,
  workflowId: string,
  toStage: string,
  options?: { policy?: VerificationPolicy }
): Promise<WorkflowStateData> {
  const filePath = getWorkflowFile(projectRoot, workflowId);
  
  let workflow: WorkflowStateData;
  try {
    const content = await readFile(filePath, 'utf-8');
    workflow = parseWorkflow(content);
  } catch {
    // Create new workflow
    workflow = {
      workflow_id: workflowId,
      state: {
        current_stage: 'init',
        iteration: 0,
        status: 'active',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      tasks: [],
      checks: [],
    };
  }

  // Validate transition (simplified)
  const validStages = ['init', 'requirements', 'planning', 'execution', 'verification', 'delivery', 'completed'];
  if (!validStages.includes(toStage)) {
    throw new Error(`Invalid stage: ${toStage}`);
  }

  workflow.state.current_stage = toStage;
  workflow.state.iteration += 1;
  workflow.state.updated_at = new Date().toISOString();

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, serializeWorkflow(workflow), 'utf-8');

  return workflow;
}

export async function incrementDeliberationCount(
  projectRoot: string,
  paths: WorkflowPaths,
  workflowId: string
): Promise<number> {
  const workflow = await getWorkflowState(projectRoot, paths, workflowId);
  return workflow?.state.iteration || 0;
}

export async function recordTaskResult(
  projectRoot: string,
  paths: WorkflowPaths,
  workflowId: string,
  taskId: string,
  agent: string,
  status: 'done' | 'failed' | 'running' | 'pending',
  planFile?: string,
  blockName?: string
): Promise<void> {
  const workflow = await getWorkflowState(projectRoot, paths, workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

  const existingIndex = workflow.tasks.findIndex(t => t.task_id === taskId);
  const task = {
    task_id: taskId,
    agent,
    status,
    plan_file: planFile,
    block_name: blockName,
    started_at: existingIndex >= 0 ? workflow.tasks[existingIndex].started_at : new Date().toISOString(),
    completed_at: status === 'done' || status === 'failed' ? new Date().toISOString() : undefined,
    error: status === 'failed' ? 'Task failed' : undefined,
  };

  if (existingIndex >= 0) {
    workflow.tasks[existingIndex] = task;
  } else {
    workflow.tasks.push(task);
  }

  const filePath = getWorkflowFile(projectRoot, workflowId);
  await writeFile(filePath, serializeWorkflow(workflow), 'utf-8');
}

export async function recordCheckResult(
  projectRoot: string,
  paths: WorkflowPaths,
  workflowId: string,
  checkName: string,
  status: 'PASS' | 'FAIL' | 'SKIP',
  detail: string,
  maxIterations: number,
  currentIteration: number
): Promise<void> {
  const workflow = await getWorkflowState(projectRoot, paths, workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

  const check = {
    check_name: checkName,
    status,
    detail,
    max_iterations: maxIterations,
    current_iteration: currentIteration,
    timestamp: new Date().toISOString(),
  };

  workflow.checks.push(check);

  const filePath = getWorkflowFile(projectRoot, workflowId);
  await writeFile(filePath, serializeWorkflow(workflow), 'utf-8');
}