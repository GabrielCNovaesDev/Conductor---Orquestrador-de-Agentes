import type { NodeFn } from '../types.js';
import { logNodeEntry } from '../logger.js';

export const consolidateNode: NodeFn = async (ctx) => {
  logNodeEntry('consolidate', ctx);

  return {
    status: 'consolidating',
    updatedAt: new Date().toISOString(),
  };
};
