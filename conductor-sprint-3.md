# Sprint 3 — Integrações Externas (Jira + GitHub)

> **Duração:** Semanas 5–6  
> **Objetivo:** Conectar o orquestrador ao Jira e ao GitHub, completando o primeiro fluxo end-to-end real: uma issue do Jira é recebida, processada pelos agentes e atualizada automaticamente com o resultado.  
> **Entregável ao final:** Uma issue criada no Jira com a label `agent-task` é automaticamente analisada pelo orquestrador, processada pelo LLM adequado, e comentada com o resultado — tudo sem intervenção manual.

---

## Contexto para a IA

Esta sprint é a mais importante para a proposta de valor do produto. Até agora o sistema funciona de forma isolada. Agora ele passa a operar dentro do fluxo real de trabalho de uma equipe de desenvolvimento.

O protocolo principal para Jira é o **MCP (Model Context Protocol)** — não REST direto. Para GitHub, usamos REST API + Webhooks. Cada conector é implementado no package `packages/connectors/`.

**Atenção crítica:** os conectores têm acesso a dados reais de clientes. A segurança e o controle de o que os agentes podem e não podem fazer são requisitos não-negociáveis nesta sprint.

---

## Tarefas

---

### TASK-3.1 — Conector Jira via MCP
**Responsável:** Codex  
**Tipo:** Implementação complexa

#### O que fazer

Criar `packages/connectors/src/jira/` para comunicação com o Jira via MCP.

**Estrutura:**
```
packages/connectors/src/jira/
├── index.ts
├── client.ts         # Cliente MCP configurado para Atlassian
├── operations.ts     # Operações de alto nível (listIssues, addComment, etc.)
├── types.ts          # Tipos específicos do Jira
└── polling.ts        # Polling periódico de novas issues
```

**Configuração do cliente MCP:**
```typescript
// packages/connectors/src/jira/client.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

export async function createJiraClient(config: JiraConnectorConfig): Promise<JiraMCPClient> {
  const transport = new SSEClientTransport(
    new URL('https://mcp.atlassian.com/v1/mcp')
  );
  const client = new Client({ name: 'multi-agent-workspace', version: '1.0.0' });
  await client.connect(transport);
  return new JiraMCPClient(client, config);
}
```

**Operações a implementar em `operations.ts`:**

```typescript
export class JiraMCPClient {
  // Listar issues de um projeto com filtros
  async listIssues(input: {
    projectKey: string;
    status?: string;
    labels?: string[];
    maxResults?: number;
  }): Promise<JiraIssue[]>
  
  // Ler detalhes completos de uma issue
  async getIssue(issueKey: string): Promise<JiraIssueDetail>
  
  // Adicionar comentário (agente reporta resultado)
  async addComment(issueKey: string, body: string): Promise<void>
  
  // Atualizar status da issue
  async transitionIssue(issueKey: string, transitionName: string): Promise<void>
  
  // Criar sub-task dentro de uma issue
  async createSubtask(parentKey: string, input: {
    summary: string;
    description: string;
    assignee?: string;
  }): Promise<string>   // retorna a key da nova subtask
}
```

**Tipos:**
```typescript
interface JiraIssue {
  key: string;              // ex: 'PROJ-42'
  summary: string;
  status: string;
  priority: string;
  labels: string[];
  assignee?: string;
  created: string;
  updated: string;
}

interface JiraIssueDetail extends JiraIssue {
  description: string;
  comments: JiraComment[];
  attachments: JiraAttachment[];
  linkedIssues: string[];
}
```

**Polling de novas issues:**
```typescript
// packages/connectors/src/jira/polling.ts
export class JiraPoller {
  constructor(
    private client: JiraMCPClient,
    private config: { projectKey: string; pollIntervalMs: number; triggerLabel: string }
  ) {}
  
  // Inicia polling e chama callback para cada nova issue encontrada
  start(onNewIssue: (issue: JiraIssueDetail) => Promise<void>): void
  stop(): void
  
  private async poll(): Promise<void>
  // Salva timestamp da última verificação para não processar issues já vistas
  // Usa Redis: `connector:jira:{workspaceId}:last_checked`
}
```

A label de trigger padrão é `agent-task`. Somente issues com essa label são processadas. Isso dá controle ao time sobre o que o agente toca.

#### Definição de pronto
- `listIssues` retorna issues reais de um projeto Jira de teste
- `addComment` posta comentário visível no Jira
- `transitionIssue` muda o status de uma issue
- Polling detecta nova issue com label `agent-task` em até `pollIntervalMs` ms
- Issues já processadas não são reprocessadas (usar Redis para controle)
- Erros de autenticação geram log claro e não derrubam o processo

---

### TASK-3.2 — Conector GitHub (REST + Webhooks)
**Responsável:** Codex  
**Tipo:** Implementação complexa

#### O que fazer

Criar `packages/connectors/src/github/` para comunicação com o GitHub.

**Estrutura:**
```
packages/connectors/src/github/
├── index.ts
├── client.ts         # Cliente REST (Octokit)
├── operations.ts     # Operações de alto nível
├── webhook.ts        # Receptor de webhooks
└── types.ts
```

**Cliente REST com Octokit:**
```typescript
import { Octokit } from '@octokit/rest';

export class GitHubClient {
  private octokit: Octokit;
  
  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }
}
```

**Operações a implementar:**
```typescript
// Listar PRs abertos
async listOpenPRs(owner: string, repo: string): Promise<GitHubPR[]>

// Ler diff de um PR
async getPRDiff(owner: string, repo: string, prNumber: number): Promise<string>

// Ler conteúdo de um arquivo do repo
async getFileContent(owner: string, repo: string, path: string, ref?: string): Promise<string>

// Criar comentário de review num PR (geral ou em linha específica)
async createPRComment(input: {
  owner: string;
  repo: string;
  prNumber: number;
  body: string;
  commitId?: string;
  path?: string;
  line?: number;
}): Promise<void>

// Criar issue no repo
async createIssue(owner: string, repo: string, input: {
  title: string;
  body: string;
  labels?: string[];
}): Promise<string>  // retorna URL da issue criada
```

**Receptor de webhooks:**
```typescript
// packages/connectors/src/github/webhook.ts
// Registrar em apps/api/src/routes/webhooks.ts

export function createGitHubWebhookHandler(secret: string) {
  return async (req: Request, res: Response) => {
    // 1. Verificar assinatura HMAC do webhook (obrigatório — rejeitar se inválida)
    // 2. Identificar evento: 'pull_request', 'push', 'issues'
    // 3. Para 'pull_request' com action 'opened' ou 'synchronize':
    //    → Disparar orquestrador com source: 'github'
    // 4. Responder 200 imediatamente (GitHub exige resposta < 10s)
    // 5. Processamento real acontece de forma assíncrona (BullMQ)
  };
}
```

**Verificação HMAC obrigatória:**
```typescript
import { createHmac, timingSafeEqual } from 'crypto';

function verifyWebhookSignature(payload: Buffer, signature: string, secret: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

#### Definição de pronto
- `listOpenPRs` retorna PRs de um repo real
- `getPRDiff` retorna o diff completo de um PR
- `createPRComment` posta comentário visível no GitHub
- Webhook recebe evento de PR, verifica assinatura e dispara tarefa no orquestrador
- Webhook responde 200 em < 500ms (processamento vai para a fila)
- Assinatura inválida retorna 401 e loga tentativa

---

### TASK-3.3 — Pipeline end-to-end: Jira → Agentes → Jira
**Responsável:** Ambos  
**Tipo:** Integração e validação

#### O que fazer

Este é o fluxo mais importante do MVP. Implementar e validar o ciclo completo:

```
Issue Jira (label: agent-task)
    ↓ [JiraPoller detecta]
    ↓ [Conector envia para API]
POST /tasks { source: 'jira', sourceId: 'PROJ-42', ... }
    ↓ [Orquestrador recebe]
    ↓ [Nó analyze lê detalhes completos da issue via JiraMCPClient.getIssue]
    ↓ [Nó route decide: Claude para análise, GPT-4 para sugestão de código]
    ↓ [Nó execute: ambos rodam em paralelo]
    ↓ [Nó consolidate: junta os resultados]
    ↓ [Nó output: chama JiraMCPClient.addComment com resultado formatado]
    ↓ [Nó output: chama JiraMCPClient.transitionIssue para 'In Review']
Issue Jira atualizada com comentário do agente
```

**Codex — implementar a integração no orquestrador:**

Atualizar o nó `analyze` do grafo para, quando `source === 'jira'`, chamar o conector Jira e enriquecer o `AgentContext` com os dados completos da issue.

Atualizar o nó `output` para, quando `source === 'jira'`, formatar e postar o resultado como comentário no Jira.

**Formato do comentário do agente no Jira:**
```markdown
## Análise do Agente Multi-Agent Workspace

**Task ID:** maw-{taskId}  
**Agentes utilizados:** Claude (análise), GPT-4 (sugestão de código)  
**Tempo de execução:** {duration}s  
**Custo estimado:** ${cost}

---

### Análise (Claude)
{resultado do Claude}

### Sugestão de implementação (GPT-4)
{resultado do GPT-4}

---
*Gerado automaticamente pelo Multi-Agent Workspace. [Ver audit log completo](http://app/{taskId}/audit)*
```

**Claude — validar o fluxo e escrever o roteiro de teste:**

Criar `docs/e2e-test-jira.md` com:
1. Pré-requisitos (projeto Jira de teste, credenciais configuradas)
2. Passo a passo para executar o teste manualmente
3. O que verificar em cada etapa (o que deve aparecer no log, no Jira, no Redis)
4. Critérios de sucesso e falha
5. Troubleshooting dos erros mais comuns

#### Definição de pronto
- Issue criada no Jira com `agent-task` gera comentário automático em < 2 minutos
- Comentário está formatado corretamente e inclui o `taskId` para rastreamento
- Status da issue é atualizado para `In Review`
- Audit log no banco registra todas as etapas do fluxo
- Redis não tem vazamento de contexto após a tarefa concluir (TTL aplicado)

---

### TASK-3.4 — Audit log persistente no PostgreSQL
**Responsável:** Claude  
**Tipo:** Implementação + design

#### O que fazer

Criar a camada de persistência do audit log em PostgreSQL. O audit log é imutável — apenas INSERTs, nunca UPDATEs ou DELETEs.

**Migration SQL:**
```sql
-- infra/migrations/003_audit_log.sql

CREATE TABLE audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES tasks(id),
  subtask_id  UUID REFERENCES subtasks(id),
  
  event_type  TEXT NOT NULL,
  -- Valores possíveis:
  -- 'task.received' | 'task.analyzing' | 'task.routing' | 'task.executing'
  -- 'task.consolidating' | 'task.done' | 'task.failed'
  -- 'subtask.started' | 'subtask.completed' | 'subtask.failed' | 'subtask.timeout'
  -- 'routing.decision' | 'connector.jira.read' | 'connector.jira.write'
  -- 'connector.github.read' | 'connector.github.write'
  -- 'memory.lock.acquired' | 'memory.lock.released' | 'memory.lock.failed'
  
  payload     JSONB NOT NULL DEFAULT '{}',
  -- Conteúdo varia por event_type. Exemplos:
  -- routing.decision: { agentId, score, reasoning, breakdown }
  -- subtask.completed: { agentId, model, inputTokens, outputTokens, costUsd, durationMs }
  -- task.failed: { error, retryCount, lastNode }
  
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para as queries mais comuns
CREATE INDEX idx_audit_log_task_id ON audit_log(task_id);
CREATE INDEX idx_audit_log_event_type ON audit_log(event_type);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at DESC);

-- Garantir que a tabela não aceita updates ou deletes (via trigger)
CREATE RULE no_update_audit AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE no_delete_audit AS ON DELETE TO audit_log DO INSTEAD NOTHING;
```

**Camada de acesso:**
```typescript
// packages/orchestrator/src/audit/logger.ts
export class AuditLogger {
  async log(entry: {
    taskId: string;
    subtaskId?: string;
    eventType: AuditEventType;
    payload: Record<string, unknown>;
  }): Promise<void>
  
  async getByTaskId(taskId: string): Promise<AuditEntry[]>
  async getByEventType(eventType: AuditEventType, limit?: number): Promise<AuditEntry[]>
}
```

**Integração:** o `AuditLogger` deve ser chamado em cada nó do grafo ao entrar e ao sair, e em cada operação dos conectores.

#### Definição de pronto
- Migration aplicada sem erros
- Rule de no-update e no-delete testadas (tentar UPDATE deve ser silenciosamente ignorado)
- `GET /tasks/{taskId}/audit` retorna log completo ordenado por `created_at`
- Cada entrada de routing inclui o `breakdown` completo do scoring
- Log de um fluxo completo (receive → done) tem no mínimo 8 entradas

---

### TASK-3.5 — Sistema de filas com BullMQ
**Responsável:** Codex  
**Tipo:** Implementação

#### O que fazer

Criar `packages/orchestrator/src/queue/` para gerenciar a execução assíncrona das tarefas.

**Por que filas?** O webhook do GitHub precisa responder em < 10s. O processamento de uma tarefa pode levar minutos. A fila desacopla recepção de execução.

**Estrutura de filas:**
```
orchestrator-tasks      # fila principal de tarefas
orchestrator-retries    # fila de retry com backoff
orchestrator-dead       # dead letter queue (falhas após N tentativas)
```

**Implementação:**
```typescript
// packages/orchestrator/src/queue/producer.ts
import { Queue } from 'bullmq';

export const taskQueue = new Queue('orchestrator-tasks', {
  connection: { url: process.env.REDIS_URL },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 500 }
  }
});

export async function enqueueTask(task: TaskPayload): Promise<string> {
  const job = await taskQueue.add('process-task', task, {
    jobId: task.taskId,       // idempotência
    priority: task.urgency === 'high' ? 1 : 10
  });
  return job.id!;
}

// packages/orchestrator/src/queue/worker.ts
import { Worker } from 'bullmq';

export function createWorker(orchestrator: Orchestrator): Worker {
  return new Worker('orchestrator-tasks', async (job) => {
    const { taskId, workspaceId } = job.data;
    await orchestrator.run(taskId, workspaceId);
  }, {
    connection: { url: process.env.REDIS_URL },
    concurrency: 5       // até 5 tarefas em paralelo por worker
  });
}
```

**Monitoramento básico:**
- Expor `GET /queue/stats` com: jobs ativos, aguardando, concluídos, falhos
- Mover jobs da dead letter queue aparecem em log com alerta

#### Definição de pronto
- Webhook do GitHub encaminha tarefa para a fila e responde 200 imediatamente
- Worker processa tarefas da fila e chama o orquestrador
- Retry automático acontece após falha (verificar nos logs)
- `GET /queue/stats` retorna contagens corretas
- Dead letter queue captura tarefas após 3 tentativas falhas

---

## Checklist de Conclusão da Sprint

- [ ] Issue Jira com `agent-task` gera comentário automático com resultado dos agentes
- [ ] PR aberto no GitHub dispara análise via webhook e posta comentário de review
- [ ] Audit log persistente com todas as etapas do fluxo
- [ ] Fila BullMQ processando tarefas de forma assíncrona
- [ ] Webhook do GitHub responde 200 em < 500ms
- [ ] Verificação HMAC funcionando (rejeita requisições inválidas)
- [ ] Issues já processadas não são reprocessadas (idempotência)
- [ ] Roteiro de teste E2E documentado e executado com sucesso

---

## Dependências e Bloqueios

- Sprint 2 deve estar 100% concluída antes desta sprint começar
- **TASK-3.1 e TASK-3.2 podem ser desenvolvidas em paralelo**
- **TASK-3.3 depende de TASK-3.1 estar funcional**
- **TASK-3.5 (filas) pode começar imediatamente** — não depende dos conectores

---

## Notas de Segurança (Críticas)

- **Credenciais dos conectores** (token GitHub, OAuth Jira) nunca ficam em variáveis de ambiente globais — são armazenadas criptografadas na tabela `connectors` e descriptografadas em runtime usando `AES-256-GCM`
- **O conteúdo dos prompts enviados aos LLMs** deve ser sanitizado: remover qualquer dado que pareça ser credencial (padrões: `ghp_`, `xoxb-`, `sk-`, URLs com tokens em query params)
- **Rate limiting por workspace:** máximo de 100 chamadas de conector por hora para evitar que um workspace abuse das APIs externas
- **O agente não pode deletar issues ou fechar PRs** — as operações de escrita permitidas são: adicionar comentário, criar subtask, atualizar label, transicionar status para estados pré-aprovados
