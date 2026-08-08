// packages/core/src/types/checkpoint.ts
// Checkpoint schema for the Tori orchestration redesign.
// Checkpoints capture execution state at delegation, compaction, budget,
// and verification-loop boundaries so work can be resumed deterministically.

export type CheckpointTrigger = "delegation" | "compaction" | "budget" | "verification_loop";

export interface TodoWriteItem {
  id: string;
  text: string;
  status: "pending" | "in_progress" | "done";
}

export interface Decision {
  id: string;
  description: string;
  rationale?: string;
}

export interface CheckpointState {
  todowrite: TodoWriteItem[];
  workflow_stage: string;
  iteration: number;
  artifacts_modified: string[];
  decisions: Decision[];
}

export interface CheckpointParent {
  task_id: string;
  agent: string;
  depth: number;
  checkpoint_ref?: string;
}

export interface CheckpointChildTask {
  task_id: string;
  agent: string;
  scope: string;
}

export interface Checkpoint {
  version: string;
  created_at: string;
  trigger: CheckpointTrigger;
  parent: CheckpointParent;
  state: CheckpointState;
  context_summary: string; // ≤500 tokens — enforced at runtime
  resume_instructions: string;
  child_tasks: CheckpointChildTask[];
}
