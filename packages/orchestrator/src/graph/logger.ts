import pino from 'pino';
import type { AgentContext } from '@repo/shared';
import type { GraphNodeName } from './types.js';

export const graphLogger = pino({
  name: 'orchestrator-graph',
  level: process.env.LOG_LEVEL ?? 'info',
});

export function logNodeEntry(node: GraphNodeName, ctx: AgentContext) {
  graphLogger.info(
    {
      taskId: ctx.taskId,
      workspaceId: ctx.workspaceId,
      node,
      timestamp: new Date().toISOString(),
    },
    'Entering graph node',
  );
}
