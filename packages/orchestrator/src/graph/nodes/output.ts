import type { NodeFn } from '../types.js';
import { logNodeEntry } from '../logger.js';

export const outputNode: NodeFn = async (ctx) => {
  logNodeEntry('output', ctx);

  return {
    status: 'done',
    updatedAt: new Date().toISOString(),
  };
};
