// packages/core/src/tools/budget.ts
// Pure budget computation and allocation helpers for the Tori workflow model.
// All functions are side-effect-free and unit-testable.

import type { TaskBudget, TaskComplexity } from '../types/budget.js';
import { computeBudget } from '../types/budget.js';

// ── Complexity Heuristic ──────────────────────────────────────────────────────
//
// `estimateComplexity` maps three input metrics to a `TaskComplexity` tier:
//
//   - scopeSize: abstract measure of work volume (e.g., lines of code, number
//     of requirements, or story points). Higher values indicate more work.
//   - fileCount: number of files the task touches. More files imply more
//     integration surface and coordination overhead.
//   - ambiguity: subjective uncertainty score (0 = crystal clear, 1 = highly
//     ambiguous). Higher ambiguity increases the risk of rework and exploration.
//
// Heuristic:
//   1. Normalize each metric to a 0–1 score against empirically chosen caps:
//        scopeScore  = min(scopeSize / 500, 1)
//        fileScore   = min(fileCount / 20, 1)
//        ambigScore  = min(ambiguity, 1)
//   2. Weighted sum: total = 0.4 * scopeScore + 0.3 * fileScore + 0.3 * ambigScore
//   3. Tier mapping:
//        total < 0.25  → trivial
//        total < 0.50  → simple
//        total < 0.75  → medium
//        total >= 0.75 → complex
//
// The weights favor scope size slightly because raw volume is the most
// predictable cost driver, while ambiguity and file count capture coordination
// and uncertainty risk. Adjust caps/weights if telemetry shows systematic
// misclassification.

const SCOPE_CAP = 500;
const FILE_CAP = 20;

function normalizeScope(scopeSize: number): number {
  return Math.min(scopeSize / SCOPE_CAP, 1);
}

function normalizeFiles(fileCount: number): number {
  return Math.min(fileCount / FILE_CAP, 1);
}

function normalizeAmbiguity(ambiguity: number): number {
  return Math.min(Math.max(ambiguity, 0), 1);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Assign a fresh `TaskBudget` for the given complexity tier.
 *
 * @param complexityHint - Optional complexity tier. Defaults to `"medium"` when
 *   omitted or when an unrecognized value is passed.
 * @returns A new `TaskBudget` with allocated values populated and consumption
 *   counters zeroed.
 */
export function assignBudget(complexityHint?: TaskComplexity): TaskBudget {
  const complexity: TaskComplexity =
    complexityHint === 'trivial' ||
    complexityHint === 'simple' ||
    complexityHint === 'medium' ||
    complexityHint === 'complex'
      ? complexityHint
      : 'medium';

  return computeBudget(complexity);
}

/**
 * Estimate task complexity from scope, file count, and ambiguity metrics.
 *
 * @param scopeSize - Abstract work-volume measure.
 * @param fileCount - Number of files involved.
 * @param ambiguity - Uncertainty score (0–1).
 * @returns The estimated `TaskComplexity` tier.
 */
export function estimateComplexity(scopeSize: number, fileCount: number, ambiguity: number): TaskComplexity {
  const scopeScore = normalizeScope(scopeSize);
  const fileScore = normalizeFiles(fileCount);
  const ambigScore = normalizeAmbiguity(ambiguity);

  const total = 0.4 * scopeScore + 0.3 * fileScore + 0.3 * ambigScore;

  if (total < 0.25) return 'trivial';
  if (total < 0.50) return 'simple';
  if (total < 0.75) return 'medium';
  return 'complex';
}

/**
 * Return an updated `TaskBudget` with consumption counters incremented.
 *
 * This function is pure: it does not mutate the input budget.
 *
 * @param budget - The current budget state.
 * @param tokensUsed - Additional tokens consumed since the last update.
 * @param toolCallsUsed - Additional tool calls consumed since the last update.
 * @returns A new `TaskBudget` reflecting the updated consumption.
 */
export function updateBudgetConsumption(
  budget: TaskBudget,
  tokensUsed: number,
  toolCallsUsed: number,
): TaskBudget {
  const newConsumedTokens = budget.tokens.consumed + tokensUsed;
  const newConsumedToolCalls = budget.tool_calls.consumed + toolCallsUsed;

  return {
    ...budget,
    tokens: {
      ...budget.tokens,
      consumed: newConsumedTokens,
    },
    tool_calls: {
      ...budget.tool_calls,
      consumed: newConsumedToolCalls,
    },
  };
}

/**
 * Determine whether the budget has reached its checkpoint threshold.
 *
 * @param budget - The current budget state.
 * @returns `true` when consumed tokens are greater than or equal to the
 *   `checkpoint_at` threshold, indicating a checkpoint should be written.
 */
export function shouldCheckpoint(budget: TaskBudget): boolean {
  return budget.tokens.consumed >= budget.tokens.checkpoint_at;
}

export const BUDGET_STATUS = {
  CHECKPOINT_REQUIRED: 'CHECKPOINT_REQUIRED',
  BUDGET_EXHAUSTED: 'BUDGET_EXHAUSTED',
} as const;

export type BudgetStatus = typeof BUDGET_STATUS[keyof typeof BUDGET_STATUS];

export function advanceCheckpoint(budget: TaskBudget): TaskBudget {
  const next = Math.min(budget.tokens.consumed + Math.floor(budget.tokens.allocated / 2), budget.tokens.allocated);
  return {
    ...budget,
    tokens: {
      ...budget.tokens,
      checkpoint_at: next,
    },
  };
}
