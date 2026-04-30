import type { NodeFn } from '../types.js';
import { logNodeEntry } from '../logger.js';

export const executeNode: NodeFn = async (ctx) => {
  logNodeEntry('execute', ctx);

  const now = new Date().toISOString();

  return {
    status: 'executing',
    subtasks: ctx.subtasks.map((subtask) =>
      subtask.status === 'done'
        ? subtask
        : {
            ...subtask,
            status: 'done',
            outputText: `mock output from execute for ${subtask.id}`,
            tokensUsed: 0,
            costUsd: 0,
            startedAt: subtask.startedAt ?? now,
            finishedAt: now,
          },
    ),
    accumulatedCostUsd: ctx.accumulatedCostUsd,
    updatedAt: now,
  };
};
