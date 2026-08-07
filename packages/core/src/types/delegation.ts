// packages/core/src/types/delegation.ts
// Delegation tree schema for recursive task delegation tracking.

export interface DelegationNode {
  task_id: string;
  parent_id: string | null;
  depth: number;
  agent: string;
  scope: string;
  children: string[];
  checkpoint_ref: string;
}

export interface DelegationTree {
  root: string;
  max_depth: number;
  current_depth: number;
  nodes: Record<string, DelegationNode>;
}

export class DepthExceededError extends Error {
  constructor(depth: number, maxDepth: number, workflowId: string) {
    super(`Delegation depth ${depth} exceeds max_depth ${maxDepth} in workflow ${workflowId}`);
    this.name = 'DepthExceededError';
  }
}
