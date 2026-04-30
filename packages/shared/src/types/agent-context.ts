export type TaskSource = 'jira' | 'github' | 'manual';

export type TaskStatus =
  | 'received'
  | 'analyzing'
  | 'routing'
  | 'executing'
  | 'consolidating'
  | 'done'
  | 'failed';

export type SubtaskStatus = 'pending' | 'running' | 'done' | 'failed';

export interface Subtask {
  id: string;
  assignedAgent?: 'claude' | 'gpt4';
  assignedReason?: Record<string, unknown>;
  inputPrompt: string;
  outputText?: string;
  status: SubtaskStatus;
  tokensUsed?: number;
  costUsd?: number;
  startedAt?: string;
  finishedAt?: string;
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
  sharedMemoryKey: string;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}
