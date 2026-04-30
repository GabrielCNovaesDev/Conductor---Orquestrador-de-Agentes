import type { AgentContext } from '@repo/shared';

export function shouldContinueOrFail(ctx: AgentContext): 'route' | 'failed' {
  return ctx.lastError ? 'failed' : 'route';
}

export function shouldConsolidateOrFail(ctx: AgentContext): 'consolidate' | 'failed' {
  return ctx.subtasks.some((subtask) => subtask.status === 'failed') ? 'failed' : 'consolidate';
}
