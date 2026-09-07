/**
 * @file packages/core/src/types/workflow.ts
 * @description Type definitions for workflow state machine.
 */

export interface WorkflowPaths {
  workflows: string;
}

export interface WorkflowStateData {
  workflow_id: string;
  state: WorkflowState;
  tasks: WorkflowTask[];
  checks: WorkflowCheck[];
}

export interface WorkflowState {
  current_stage: string;
  iteration: number;
  status: 'active' | 'completed' | 'failed' | 'paused';
  started_at: string;
  updated_at: string;
}

export interface WorkflowTask {
  task_id: string;
  agent: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  plan_file?: string;
  block_name?: string;
  started_at?: string;
  completed_at?: string;
  error?: string;
}

export interface WorkflowCheck {
  check_name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  detail: string;
  max_iterations: number;
  current_iteration: number;
  timestamp: string;
}

export interface VerificationPolicy {
  require_mechanical_checks?: boolean;
  require_tests?: boolean;
  require_lint?: boolean;
  max_deliberations?: number;
  auto_advance?: boolean;
}

export interface StageTransition {
  from: string;
  to: string;
  trigger: string;
  timestamp: string;
}