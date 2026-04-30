import type { RoutingDecision } from '@repo/shared';
import type { NodeFn } from '../types.js';
import { logNodeEntry } from '../logger.js';

const mockRoutingDecision: RoutingDecision = {
  scoresByAgent: {
    claude: 80,
    gpt4: 72,
  },
  chosenReason: 'Mock routing for Sprint 1: Claude selected as default analysis agent.',
  estimatedCostUsd: 0,
  estimatedLatencyMs: 0,
};

export const routeNode: NodeFn = async (ctx) => {
  logNodeEntry('route', ctx);

  return {
    status: 'routing',
    subtasks: ctx.subtasks.map((subtask) =>
      subtask.status === 'done'
        ? subtask
        : {
            ...subtask,
            assignedAgent: 'claude',
            assignedReason: mockRoutingDecision,
          },
    ),
    updatedAt: new Date().toISOString(),
  };
};
