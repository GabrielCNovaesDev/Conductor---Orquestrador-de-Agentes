import type { Subtask } from '@repo/shared';
import type { NodeFn } from '../types.js';
import { logNodeEntry } from '../logger.js';

export const analyzeNode: NodeFn = async (ctx) => {
  logNodeEntry('analyze', ctx);

  const now = new Date().toISOString();
  const subtasks: Subtask[] =
    ctx.subtasks.length > 0
      ? ctx.subtasks
      : [
          {
            id: `${ctx.taskId}-subtask-1`,
            inputPrompt: `${ctx.title}\n\n${ctx.description}`,
            status: 'pending',
            startedAt: undefined,
            finishedAt: undefined,
          },
        ];

  return {
    status: 'analyzing',
    subtasks,
    updatedAt: now,
  };
};
