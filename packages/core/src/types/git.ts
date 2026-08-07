// packages/core/src/types/git.ts
// Git delivery state, rollback levels, and push boundary semantics.

export type RollbackLevel = 'commit' | 'stage' | 'workflow';

export type PushBoundary = 'manual' | 'auto_after_verify' | 'auto_after_human';

export interface GitDeliveryState {
  rollback_level: RollbackLevel;
  push_boundary: PushBoundary;
  last_commit_sha: string;
}
