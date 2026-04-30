import type { NodeFn } from '../types.js';
import { logNodeEntry } from '../logger.js';

export const receiveNode: NodeFn = async (ctx) => {
  logNodeEntry('receive', ctx);

  return {
    status: 'received',
    sharedMemoryKey: `ws:${ctx.workspaceId}:task:${ctx.taskId}:context`,
    updatedAt: new Date().toISOString(),
  };
};
