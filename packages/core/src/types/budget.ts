// packages/core/src/types/budget.ts
// TaskBudget schema and complexity weights for the Tori workflow model.

export type TaskComplexity = 'trivial' | 'simple' | 'medium' | 'complex';
export type ResumePolicy = 'fresh' | 'same_agent' | 'delegated';

export interface TaskBudget {
  tokens: {
    allocated: number;
    consumed: number;
    checkpoint_at: number;
  };
  tool_calls: {
    allocated: number;
    consumed: number;
  };
  timeout_ms: number;
  complexity: TaskComplexity;
  checkpoints: string[];
  resume_policy: ResumePolicy;
}

export interface ComplexityWeights {
  tokens: number;
  toolCalls: number;
  timeoutMs: number;
}

export const COMPLEXITY_WEIGHTS: Record<TaskComplexity, ComplexityWeights> = {
  trivial: { tokens: 50_000, toolCalls: 5, timeoutMs: 300_000 },
  simple: { tokens: 120_000, toolCalls: 12, timeoutMs: 600_000 },
  medium: { tokens: 250_000, toolCalls: 20, timeoutMs: 1_200_000 },
  complex: { tokens: 500_000, toolCalls: 40, timeoutMs: 2_700_000 },
};

export function computeBudget(complexity: TaskComplexity): TaskBudget {
  const weights = COMPLEXITY_WEIGHTS[complexity];
  return {
    tokens: {
      allocated: weights.tokens,
      consumed: 0,
      checkpoint_at: Math.floor(weights.tokens / 2),
    },
    tool_calls: {
      allocated: weights.toolCalls,
      consumed: 0,
    },
    timeout_ms: weights.timeoutMs,
    complexity,
    checkpoints: [],
    resume_policy: 'fresh',
  };
}
