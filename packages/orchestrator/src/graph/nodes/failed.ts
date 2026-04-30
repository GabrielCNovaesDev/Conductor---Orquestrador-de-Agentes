import type { NodeFn } from '../types.js';
import { graphLogger, logNodeEntry } from '../logger.js';

export const failedNode: NodeFn = async (ctx) => {
  logNodeEntry('failed', ctx);

  graphLogger.error(
    {
      taskId: ctx.taskId,
      workspaceId: ctx.workspaceId,
      node: 'failed',
      retryCount: ctx.retryCount,
      maxRetries: ctx.maxRetries,
      error: ctx.lastError,
      timestamp: new Date().toISOString(),
    },
    'Task graph entered failed node',
  );

  return {
    status: 'failed',
    updatedAt: new Date().toISOString(),
  };
};
