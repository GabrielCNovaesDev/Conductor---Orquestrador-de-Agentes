export type TaskSource = 'jira' | 'github' | 'manual';
export type AgentId = 'claude' | 'gpt4';

export type TaskStatus =
  | 'received'
  | 'analyzing'
  | 'routing'
  | 'executing'
  | 'consolidating'
  | 'done'
  | 'failed';

export type SubtaskStatus = 'pending' | 'running' | 'done' | 'failed';

export interface RoutingDecision {
  scoresByAgent: Record<AgentId, number>;
  chosenReason: string;
  estimatedCostUsd: number;
  estimatedLatencyMs: number;
}

export interface TaskError {
  code: string;
  message: string;
  retryable: boolean;
  occurredAt: string;
  node: string;
}

export interface Subtask {
  id: string;
  assignedAgent?: AgentId;
  assignedReason?: RoutingDecision;
  inputPrompt: string;
  outputText?: string;
  status: SubtaskStatus;
  tokensUsed?: number;
  costUsd?: number;
  startedAt?: string;
  finishedAt?: string;
  error?: TaskError;
}

export interface AgentContext {
  taskId: string;
  workspaceId: string;
  orgId: string;
  source: TaskSource;
  sourceId?: string;
  title: string;
  description: string;
  status: TaskStatus;
  subtasks: Subtask[];
  lastError?: TaskError;
  sharedMemoryKey: string;
  retryCount: number;
  maxRetries: number;
  maxCostUsd: number;
  accumulatedCostUsd: number;
  createdAt: string;
  updatedAt: string;
}
