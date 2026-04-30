import type { AgentContext } from '@repo/shared';

export type NodeUpdate = Partial<AgentContext>;

export interface NodeFn {
  (ctx: AgentContext): Promise<NodeUpdate>;
}

export type GraphNodeName =
  | 'receive'
  | 'analyze'
  | 'route'
  | 'execute'
  | 'consolidate'
  | 'output'
  | 'failed';
