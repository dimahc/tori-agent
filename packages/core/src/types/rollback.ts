// packages/core/src/types/rollback.ts
// Rollback plan and result types for the systematic revert workflow.

import type { RollbackLevel } from "./git.js";

export interface RollbackPlan {
  level: RollbackLevel;
  target_sha?: string;
  target_stage?: string;
  preserve_checkpoints: boolean;
  dry_run: boolean;
}

export interface RollbackResult {
  level: RollbackLevel;
  executed: boolean;
  actions: string[];
  archived_path?: string;
  new_workflow_id?: string;
  reverted_commits: string[];
  error?: string;
}
