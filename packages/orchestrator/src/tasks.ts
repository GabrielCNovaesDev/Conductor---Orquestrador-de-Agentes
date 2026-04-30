import { randomUUID } from 'node:crypto';
import type { AgentContext, TaskSource } from '@repo/shared';
import { taskGraph } from './graph/index.js';
import { graphLogger } from './graph/logger.js';

export interface CreateTaskInput {
  title: string;
  description: string;
  source: TaskSource;
  sourceId?: string;
  workspaceId?: string;
  orgId?: string;
}

export interface TaskCreated {
  taskId: string;
  status: 'received';
}

export function createInitialContext(input: CreateTaskInput): AgentContext {
  const taskId = randomUUID();
  const workspaceId = input.workspaceId ?? 'default-workspace';
  const now = new Date().toISOString();

  return {
    taskId,
    workspaceId,
    orgId: input.orgId ?? 'default-org',
    source: input.source,
    sourceId: input.sourceId,
    title: input.title,
    description: input.description,
    status: 'received',
    subtasks: [],
    sharedMemoryKey: `ws:${workspaceId}:task:${taskId}:context`,
    retryCount: 0,
    maxRetries: 3,
    maxCostUsd: Number(process.env.DEFAULT_MAX_COST_PER_TASK_USD ?? 0.5),
    accumulatedCostUsd: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export async function runTask(input: CreateTaskInput): Promise<AgentContext> {
  const context = createInitialContext(input);
  return taskGraph.invoke(context);
}

export function runTaskInBackground(input: CreateTaskInput): TaskCreated {
  const context = createInitialContext(input);

  void taskGraph.invoke(context).catch((error: unknown) => {
    graphLogger.error(
      {
        taskId: context.taskId,
        workspaceId: context.workspaceId,
        error,
        timestamp: new Date().toISOString(),
      },
      'Task graph execution failed unexpectedly',
    );
  });

  return {
    taskId: context.taskId,
    status: 'received',
  };
}
