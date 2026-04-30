# Architecture Decision Record — Orquestrador Central

> **Sprint:** 1 — Fundação
> **Task:** TASK-1.1
> **Status:** Aprovado
> **Data:** 2026-04-30
> **Autor:** Claude (design)

---

## 1. Contexto

O Multi-Agent Workspace precisa de um motor de orquestração capaz de coordenar múltiplos agentes LLM (Claude, GPT-4) em paralelo, com estado compartilhado, retry, auditoria e capacidade de tomar decisões condicionais entre etapas. Antes de escrever qualquer código de produção, é necessário fixar quatro pontos: (1) o framework, (2) o grafo de estados, (3) o contrato de dados entre nós e (4) a política de retry. As decisões abaixo são vinculantes para as TASK-1.2 e TASK-1.3.

---

## 2. Decisão 1 — Framework de Orquestração

### Decisão

**LangGraph (Node.js / TypeScript)** — pacote `@langchain/langgraph`.

### Alternativas avaliadas

| Critério | LangGraph (Node) | CrewAI | AutoGen |
|---|---|---|---|
| Linguagem nativa | TypeScript / Python | Python only | Python (com camada .NET) |
| Modelo mental | Grafo de estados explícito | Equipes de agentes com papéis | Conversação multi-agente |
| Controle granular do fluxo | Alto — define-se cada nó e aresta | Médio — abstração de "crew" e "tasks" | Baixo — fluxo emerge da conversa |
| Determinismo / debug | Alto (transições explícitas, checkpointing nativo) | Médio | Baixo (conversas livres dificultam reprodução) |
| Streaming + checkpoints | Sim, primeira classe | Limitado | Limitado |
| Maturidade em produção | Boa, usado pelo time LangChain | Crescente, foco em demos | Pesquisa Microsoft, casos de produção limitados |
| Overhead de aprendizado | Médio | Baixo | Médio-alto |

### Justificativa

1. **Stack alinhada.** O backend é Node + TypeScript (definido no README §2). LangGraph é o único dos três com SDK first-class em TS, evitando uma ponte Python desnecessária e mais um runtime para operar.
2. **Controle granular.** Nosso domínio exige roteamento condicional entre nós (`route` decide qual LLM, `failed` decide retry vs abort), execução paralela explícita e checkpoints — primitivas que LangGraph expõe diretamente. CrewAI esconde esses detalhes atrás de abstrações de "papéis"; AutoGen depende de conversas auto-organizadas, o que é incompatível com o requisito de auditoria determinística (README §3.4).
3. **Debug.** Cada transição é uma aresta nomeada. Logs por `taskId` correlacionam 1-para-1 com nós do grafo — essencial para rastrear bugs em produção.
4. **Checkpointing nativo.** LangGraph permite persistir o estado a cada nó. Em uma sprint futura podemos plugar um checkpointer em PostgreSQL para resumir tarefas após crash, sem refatorar o grafo.

### Consequências

- **Positivas:** controle, debugabilidade, alinhamento com a stack, baixo custo de operação.
- **Negativas:** mais código boilerplate por nó vs CrewAI; o time precisa aprender o modelo mental de `StateGraph`. Documentação Node ainda é menos rica que a Python — alguns exemplos terão que ser adaptados.

### Pinning

- Pacote: `@langchain/langgraph` (versão a fixar pela TASK-1.2 — usar `^` apenas após validar em CI).
- Logger: `pino` (já decidido em Sprint 1, Notas Técnicas).
- Redis client: `ioredis`.

---

## 3. Decisão 2 — Grafo de Estados Inicial

### Diagrama

```
                          POST /tasks
                              │
                              ▼
                       ┌─────────────┐
                       │   receive   │  valida payload, persiste task,
                       │             │  cria sharedMemoryKey no Redis
                       └──────┬──────┘
                              │
                              ▼
                       ┌─────────────┐
                       │   analyze   │  classifica tipo/complexidade,
                       │             │  decide se decompõe em subtasks
                       └──────┬──────┘
                              │
                  ┌───────────┴───────────┐
        (ok, prosseguir)          (erro fatal ou inválido)
                  │                       │
                  ▼                       ▼
           ┌─────────────┐          ┌─────────────┐
           │    route    │          │   failed    │◀─┐
           │             │          │             │  │
           └──────┬──────┘          └──────┬──────┘  │
                  │                        │         │
                  ▼                  (retryable?)    │
           ┌─────────────┐                 │         │
           │   execute   │─────erro────────┤         │
           │  (paralelo) │                 │         │
           └──────┬──────┘                 ▼         │
                  │              ┌──────────────────┐│
                  ▼              │  retryCount <    ││
           ┌─────────────┐       │  MAX_RETRIES?    ││
           │ consolidate │       └────┬─────────┬───┘│
           │             │            │ sim     │ não│
           └──────┬──────┘            │         │    │
                  │                   │         ▼    │
                  ▼                   │       (END)  │
           ┌─────────────┐            │              │
           │   output    │            └──────────────┘
           │             │             volta para 'route'
           └──────┬──────┘             com retryCount++
                  │
                  ▼
                (END)
```

### Descrição dos nós

| Nó | Responsabilidade | Pode falhar? | Status final esperado |
|---|---|---|---|
| `receive` | Validar payload, criar registro `tasks` no Postgres, criar `SharedMemory` no Redis | Sim (payload inválido → 400 antes do grafo) | `received` |
| `analyze` | Identificar tipo (review, sumarização, geração, análise), estimar complexidade, decidir se decompõe | Sim (erro do LLM, payload incompreensível) | `analyzing` → próximo |
| `route` | Calcular score de cada agente disponível, atribuir subtarefas | Sim (nenhum agente disponível) | `routing` → próximo |
| `execute` | Disparar subtarefas (potencialmente em paralelo), aguardar conclusão | Sim (timeout, erro do LLM, lock indisponível) | `executing` → próximo |
| `consolidate` | Mesclar outputs em uma resposta final coerente | Raramente | `consolidating` → próximo |
| `output` | Postar resultado no conector (Jira/GitHub/manual), persistir audit_log final | Sim (rede, conector fora) | `done` |
| `failed` | Decidir retry ou abort definitivo, registrar motivo no audit_log | Não (terminal ou volta a `route`) | `failed` (terminal) |

### Arestas

- **Determinísticas:** `receive → analyze`, `route → execute`, `execute → consolidate`, `consolidate → output`, `output → END`.
- **Condicionais:**
  - `analyze`: se erro de validação ou erro fatal → `failed`; senão → `route`.
  - `execute`: se qualquer subtarefa falhou após esgotar tentativas locais → `failed`; senão → `consolidate`.
  - `failed`: se `retryCount < MAX_RETRIES` e o erro é retriável → `route` (com `retryCount++`); senão → `END`.

### Invariantes do grafo

1. **Todo caminho termina.** Cada execução acaba em `END` via `output` (sucesso) ou `failed` (abort).
2. **Sem loops infinitos.** O único caminho de volta é `failed → route`, controlado por `retryCount` (limite duro).
3. **Stateless por processo.** Todo estado vive em `AgentContext` (passado pelas arestas) ou no Redis (`SharedMemory`). Nada em variáveis globais.
4. **Idempotência por nó.** Repetir um nó com o mesmo `AgentContext` não deve gerar artefatos duplicados — usar `taskId + nodeName` como chave de deduplicação no audit_log.

---

## 4. Decisão 3 — Contratos de Interface entre Nós

### `AgentContext` — o estado que trafega pelo grafo

```typescript
// packages/shared/src/types/agent-context.ts

export type TaskStatus =
  | 'received'
  | 'analyzing'
  | 'routing'
  | 'executing'
  | 'consolidating'
  | 'done'
  | 'failed';

export type TaskSource = 'jira' | 'github' | 'manual';

export type AgentId = 'claude' | 'gpt4';

export type SubtaskStatus = 'pending' | 'running' | 'done' | 'failed';

export interface Subtask {
  id: string;
  assignedAgent: AgentId;
  assignedReason: RoutingDecision;   // por que esse agente foi escolhido
  inputPrompt: string;
  outputText?: string;
  status: SubtaskStatus;
  tokensUsed?: number;
  costUsd?: number;
  startedAt?: Date;
  finishedAt?: Date;
  error?: TaskError;
}

export interface RoutingDecision {
  scoresByAgent: Record<AgentId, number>;
  chosenReason: string;             // descrição legível
  estimatedCostUsd: number;
  estimatedLatencyMs: number;
}

export interface TaskError {
  code: string;                     // ex: 'LLM_TIMEOUT', 'LOCK_UNAVAILABLE'
  message: string;
  retryable: boolean;
  occurredAt: Date;
  node: string;                     // nó que originou o erro
}

export interface AgentContext {
  // Identidade
  taskId: string;
  workspaceId: string;
  orgId: string;

  // Origem
  source: TaskSource;
  sourceId?: string;                // id externo (issue Jira, PR GitHub)

  // Conteúdo
  title: string;
  description: string;

  // Estado
  status: TaskStatus;
  subtasks: Subtask[];
  lastError?: TaskError;

  // Memória compartilhada
  sharedMemoryKey: string;          // ws:{workspaceId}:task:{taskId}:context

  // Retry
  retryCount: number;
  maxRetries: number;               // padrão 3, configurável por workspace

  // Limites de custo
  maxCostUsd: number;               // padrão 0.50 (env DEFAULT_MAX_COST_PER_TASK_USD)
  accumulatedCostUsd: number;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}
```

### Contrato `NodeFn`

Todo nó implementa o mesmo tipo. Recebe o contexto, devolve um patch parcial. LangGraph faz o merge (definido pelos `channels`).

```typescript
// packages/orchestrator/src/graph/types.ts

export type NodeUpdate = Partial<AgentContext>;

export interface NodeFn {
  (ctx: AgentContext): Promise<NodeUpdate>;
}
```

### Contrato de Input/Output por nó

| Nó | Lê de `ctx` | Escreve em `ctx` (NodeUpdate) | Efeito colateral |
|---|---|---|---|
| `receive` | `title`, `description`, `source`, `sourceId`, `workspaceId`, `orgId` | `taskId`, `status: 'received'`, `sharedMemoryKey`, `createdAt`, `updatedAt`, `subtasks: []`, `retryCount: 0`, `accumulatedCostUsd: 0` | Insert em `tasks`; cria `SharedMemory` no Redis |
| `analyze` | `title`, `description` | `status: 'analyzing'`, possivelmente `subtasks` (decomposição) | Append `history` no Redis; opcionalmente um artifact de análise |
| `route` | `subtasks`, `accumulatedCostUsd`, `maxCostUsd` | `status: 'routing'`, `subtasks[*].assignedAgent`, `subtasks[*].assignedReason` | Append `history` |
| `execute` | `subtasks` (com agentes atribuídos) | `status: 'executing'`, `subtasks[*].outputText`, `subtasks[*].tokensUsed`, `subtasks[*].costUsd`, `accumulatedCostUsd` | Chamadas a LLMs (mock na Sprint 1); locks no Redis |
| `consolidate` | `subtasks[*].outputText` | `status: 'consolidating'` (artifact final no Redis) | Append `artifact` no Redis |
| `output` | resultado final, `source` | `status: 'done'`, `updatedAt` | Update em `tasks`; chamada ao conector (Jira/GitHub); finaliza `audit_log` |
| `failed` | `lastError`, `retryCount`, `maxRetries` | Decisão: incrementa `retryCount` (volta a `route`) ou `status: 'failed'` (termina) | Audit_log com motivo |

### Regras de mutação

- **Append-only para `subtasks` na `analyze`.** Após a `analyze` decidir as subtarefas, nenhum nó posterior cria novas subtarefas — apenas atualiza as existentes pelo `id`. Exceção: o caminho de retry (`failed → route`) pode marcar subtasks falhas como `pending` novamente.
- **`accumulatedCostUsd` é monotônico crescente.** Apenas `execute` o atualiza.
- **`status` segue a ordem topológica do grafo.** Nenhum nó pula etapas.
- **`updatedAt` deve ser atualizado em todos os nós.** Para correlação temporal com o audit_log.

---

## 5. Decisão 4 — Estratégia de Retry

### Princípios

1. **Erros são retriáveis até prova em contrário.** Cada `TaskError` carrega uma flag `retryable: boolean` populada no ponto de origem. Padrão: `true` para erros de rede/LLM/lock; `false` para erros de validação, custo excedido ou autenticação.
2. **Retry vive em dois níveis distintos.** Não confundir.
   - **Local (dentro do nó):** uma chamada de LLM ou conector pode falhar transitoriamente. O adapter faz retry interno até 3 vezes com backoff antes de propagar o erro ao nó. Não muda o estado do grafo.
   - **Global (no grafo):** se um nó propaga erro, o grafo vai para `failed`, que pode reenviar para `route` reiniciando a fase de execução. Esse retry é contado em `retryCount`.

### Política global

| Parâmetro | Valor padrão | Configurável por |
|---|---|---|
| `maxRetries` (global) | `3` | workspace.config |
| Backoff entre retries globais | `2^retryCount * 1000ms` (1s, 2s, 4s) | global env |
| Tipos retriáveis | `LLM_TIMEOUT`, `LLM_RATE_LIMIT`, `CONNECTOR_5XX`, `LOCK_UNAVAILABLE`, `NETWORK_ERROR` | — |
| Tipos fatais (retryable: false) | `INVALID_INPUT`, `AUTH_ERROR`, `BUDGET_EXCEEDED`, `WORKSPACE_NOT_FOUND`, `LOGIC_ERROR` | — |

### Política local (dentro do adapter de LLM)

| Parâmetro | Valor padrão |
|---|---|
| Tentativas | `3` |
| Backoff | exponencial: 100ms, 200ms, 400ms |
| Erros retriáveis localmente | `429`, `500`, `502`, `503`, `504`, network timeout |
| Jitter | ±20% do delay (evita thundering herd) |

### Comportamento do nó `failed`

```
1. registra TaskError no audit_log
2. se lastError.retryable === false → status: 'failed', END
3. se retryCount >= maxRetries     → status: 'failed', END
4. caso contrário:
     - retryCount += 1
     - aguarda backoff
     - marca subtasks 'failed' como 'pending' (apenas as que falharam)
     - emite evento 'task.retrying' (para WebSocket)
     - vai para 'route'
```

### Idempotência sob retry

- Subtasks que **completaram** com sucesso em uma tentativa anterior **não** são re-executadas. O nó `route` pula subtasks com `status === 'done'`.
- Artefatos no Redis são versionados por `subtaskId + attemptNumber` para evitar sobrescrita.
- Audit_log nunca é apagado entre tentativas — cada tentativa é uma entrada nova.

---

## 6. Pontos abertos (para revisão na TASK-1.4)

- **Checkpointing persistente:** decidir na Sprint 2 se usaremos `PostgresCheckpointer` do LangGraph ou implementação própria.
- **Parallelism em `execute`:** o LangGraph suporta `Send` para fan-out; validar a abordagem na implementação real (Sprint 2/3).
- **Cancelamento:** ainda não há nó de cancel. Se o usuário cancelar do dashboard, o orquestrador precisa interromper a execução. Decidir mecanismo (signal via Redis pub/sub) numa sprint futura.
- **Limite de custo dinâmico:** `accumulatedCostUsd` é checado em `route` e `execute`. Falta definir se a verificação acontece **antes** ou **depois** de cada subtarefa — proposta: antes (preempção), com erro `BUDGET_EXCEEDED` (fatal).

---

## 7. Critérios de aceitação desta decisão

- [x] Framework escolhido com justificativa contra duas alternativas concretas
- [x] Diagrama do grafo com todos os 7 nós exigidos pela TASK-1.1
- [x] Tipo `AgentContext` definido em TypeScript com todos os campos da especificação da sprint
- [x] Tipo `TaskStatus` cobre os 7 estados
- [x] Estratégia de retry: política global + política local + erros classificados
- [x] Invariantes do grafo declaradas (terminação, ausência de loops, statelessness)
- [x] Contratos por nó (input/output/efeitos colaterais) tabelados

---

## 8. Próximos passos

- **TASK-1.2 (Codex):** scaffold do monorepo. O tipo `AgentContext` desta decisão deve ir em `packages/shared/src/types/agent-context.ts`.
- **TASK-1.3 (Codex):** implementar o grafo conforme o diagrama da §3, com cada nó respeitando o contrato da §4.
- **TASK-1.4 (Claude):** revisar o grafo implementado contra as invariantes desta decisão.
- **TASK-1.5:** schema de `SharedMemory` no Redis — tipo já apareceu na sprint, mas o design completo (TTL, expiração, convenção de chaves) é entregável separado.
