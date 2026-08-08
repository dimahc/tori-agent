export function createConversationClient(serverUrl: string | URL): { baseUrl: URL } {
  return { baseUrl: new URL(serverUrl) };
}

import type { TaskBudget } from '../types/budget.js';
import { BUDGET_STATUS, advanceCheckpoint, shouldCheckpoint } from '../tools/budget.js';
import { setBudget, getBudget, updateSessionBudget, clearBudget, setProjectRoot } from './session-store.js';
import { writeCheckpoint } from '../tools/checkpoint.js';
import type { Checkpoint } from '../types/checkpoint.js';
import type { ToolRegistry, ToolExecutionContext } from '../plugin/tools.js';

export function createBudgetAwareToolExecutor(
  baseTools: ToolRegistry,
  root: string,
  makeCheckpoint: (sessionId: string) => Checkpoint,
): ToolRegistry {
  setProjectRoot(root);
  const wrapped: ToolRegistry = {};

  for (const [name, tool] of Object.entries(baseTools)) {
    wrapped[name] = {
      description: tool.description,
      args: tool.args,
      async execute(args, context) {
        const sessionId = context?.sessionID ?? (args as Record<string, unknown>)?.sessionID as string | undefined;
        const result = await tool.execute(args, context);

        if (!sessionId) return result;

        const budget = getBudget(sessionId);
        if (!budget) return result;

        const tokensUsed = Math.max(1, Math.ceil((result?.length ?? 0) / 4));
        const updated = updateSessionBudget(sessionId, tokensUsed, 1);
        if (!updated) return result;

        if (updated.tokens.consumed >= updated.tokens.allocated) {
          const checkpoint = makeCheckpoint(sessionId);
          try {
            const path = `docs/checkpoints/${sessionId}-exhausted.md`;
            await writeCheckpoint(root, path, checkpoint);
            setBudget(sessionId, { ...updated, checkpoints: [...updated.checkpoints, path] });
            clearBudget(sessionId);
            return JSON.stringify({ status: BUDGET_STATUS.BUDGET_EXHAUSTED, checkpoint: path });
          } catch {
            clearBudget(sessionId);
            return JSON.stringify({ status: BUDGET_STATUS.BUDGET_EXHAUSTED, checkpoint: null });
          }
        }

        if (shouldCheckpoint(updated)) {
          const checkpoint = makeCheckpoint(sessionId);
          try {
            const path = `docs/checkpoints/${sessionId}-checkpoint.md`;
            await writeCheckpoint(root, path, checkpoint);
            const next = advanceCheckpoint(updated);
            setBudget(sessionId, { ...next, checkpoints: [...next.checkpoints, path] });
            return JSON.stringify({ status: BUDGET_STATUS.CHECKPOINT_REQUIRED, checkpoint: path });
          } catch {
            return JSON.stringify({ status: BUDGET_STATUS.CHECKPOINT_REQUIRED, checkpoint: null });
          }
        }

        return result;
      },
    };
  }

  return wrapped;
}
