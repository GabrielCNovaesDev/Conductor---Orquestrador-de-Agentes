import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { AgentContext, Subtask, TaskError } from '@repo/shared';
import { shouldConsolidateOrFail, shouldContinueOrFail } from './edges/conditions.js';
import { analyzeNode } from './nodes/analyze.js';
import { consolidateNode } from './nodes/consolidate.js';
import { executeNode } from './nodes/execute.js';
import { failedNode } from './nodes/failed.js';
import { outputNode } from './nodes/output.js';
import { receiveNode } from './nodes/receive.js';
import { routeNode } from './nodes/route.js';

export const AgentContextAnnotation = Annotation.Root({
  taskId: Annotation<string>(),
  workspaceId: Annotation<string>(),
  orgId: Annotation<string>(),
  source: Annotation<AgentContext['source']>(),
  sourceId: Annotation<string | undefined>(),
  title: Annotation<string>(),
  description: Annotation<string>(),
  status: Annotation<AgentContext['status']>(),
  subtasks: Annotation<Subtask[]>(),
  lastError: Annotation<TaskError | undefined>(),
  sharedMemoryKey: Annotation<string>(),
  retryCount: Annotation<number>(),
  maxRetries: Annotation<number>(),
  maxCostUsd: Annotation<number>(),
  accumulatedCostUsd: Annotation<number>(),
  createdAt: Annotation<string>(),
  updatedAt: Annotation<string>(),
});

export const taskGraph = new StateGraph(AgentContextAnnotation)
  .addNode('receive', receiveNode)
  .addNode('analyze', analyzeNode)
  .addNode('route', routeNode)
  .addNode('execute', executeNode)
  .addNode('consolidate', consolidateNode)
  .addNode('output', outputNode)
  .addNode('failed', failedNode)
  .addEdge(START, 'receive')
  .addEdge('receive', 'analyze')
  .addConditionalEdges('analyze', shouldContinueOrFail)
  .addEdge('route', 'execute')
  .addConditionalEdges('execute', shouldConsolidateOrFail)
  .addEdge('consolidate', 'output')
  .addEdge('output', END)
  .addEdge('failed', END)
  .compile();
