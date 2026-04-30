# Sprint 1 — Fundação e Arquitetura

> **Duração:** Semanas 1–2  
> **Objetivo:** Ter o monorepo configurado, o orquestrador básico rodando e o grafo de estados validado.  
> **Entregável ao final:** Um agente orquestrador que recebe uma tarefa via `POST /tasks`, percorre o grafo de estados e registra cada transição no console/log.

---

## Contexto para a IA

Esta é a sprint de fundação. Nenhuma funcionalidade de produto é visível ainda — o foco é construir a espinha dorsal do sistema sobre a qual tudo mais será adicionado. Erros de arquitetura aqui são caros de corrigir depois. Priorize clareza, extensibilidade e documentação de decisões.

O resultado desta sprint é um sistema que roda localmente via Docker Compose e aceita uma tarefa simples (texto puro), passa por um grafo de estados mínimo e retorna um resultado fake/mockado — mas com toda a estrutura real no lugar.

---

## Tarefas

---

### TASK-1.1 — Definir arquitetura do orquestrador central
**Responsável:** Claude  
**Tipo:** Decisão de design / documentação

#### O que fazer
Antes de escrever qualquer código, definir formalmente:

1. **Escolha do framework de orquestração:** confirmar LangGraph (Node.js) como escolha e documentar por que não CrewAI ou AutoGen. Critérios: controle granular do grafo, suporte a TypeScript, maturidade da biblioteca, facilidade de debug.

2. **Diagrama do grafo de estados inicial** com os seguintes nós:
   - `receive` — ponto de entrada, valida e persiste a tarefa
   - `analyze` — entende o tipo e complexidade da tarefa
   - `route` — decide qual(is) agente(s) vai(vão) executar
   - `execute` — executa as subtarefas (pode ser paralelo)
   - `consolidate` — junta os resultados
   - `output` — envia resultado para o conector de origem
   - `failed` — nó de falha com lógica de retry

3. **Contratos de interface entre nós** — o que cada nó recebe como input e o que deve produzir como output. Definir o tipo `AgentContext` que trafega pelo grafo.

4. **Estratégia de retry** — quantas tentativas, com qual backoff, quais erros são retriáveis vs fatais.

#### Definição de pronto
- Documento `docs/architecture-decision.md` criado com diagrama ASCII do grafo e os tipos TypeScript do `AgentContext`
- Revisado e aprovado antes de qualquer código ser escrito

#### Tipo TypeScript esperado
```typescript
interface AgentContext {
  taskId: string;
  workspaceId: string;
  orgId: string;
  source: 'jira' | 'github' | 'manual';
  sourceId?: string;
  title: string;
  description: string;
  status: TaskStatus;
  subtasks: Subtask[];
  sharedMemoryKey: string;   // chave no Redis para este contexto
  retryCount: number;
  createdAt: Date;
  updatedAt: Date;
}

type TaskStatus = 'received' | 'analyzing' | 'routing' | 'executing' | 'consolidating' | 'done' | 'failed';
```

---

### TASK-1.2 — Scaffold do monorepo
**Responsável:** Codex  
**Tipo:** Implementação

#### O que fazer
Criar a estrutura completa do monorepo conforme definido no README principal (seção 8).

**Passo a passo:**

1. Inicializar o repositório com `npm workspaces` no `package.json` raiz:
```json
{
  "name": "multi-agent-workspace",
  "private": true,
  "workspaces": ["apps/*", "packages/*"]
}
```

2. Criar os packages com seus `package.json` individuais:
   - `apps/api` — Express + TypeScript
   - `apps/web` — React + Vite + TypeScript + Tailwind
   - `packages/orchestrator` — LangGraph
   - `packages/connectors` — Jira, GitHub
   - `packages/shared` — tipos e utils

3. Configurar **TypeScript** com `tsconfig.json` base na raiz e extends em cada package.

4. Configurar **ESLint** + **Prettier** compartilhados.

5. Criar o `docker-compose.yml` de desenvolvimento com:
   - `postgres:16-alpine` — porta 5432, volume persistente
   - `redis:7-alpine` — porta 6379
   - `api` — build local, hot reload com `ts-node-dev`
   - `web` — build local, Vite dev server

6. Criar `.env.example` com todas as variáveis listadas no README principal (seção 9).

7. Criar script `npm run dev` na raiz que sobe o Docker Compose e inicia os watchers.

#### Definição de pronto
- `docker-compose up` funciona sem erros
- `apps/api` responde `{ "status": "ok" }` em `GET /health`
- `apps/web` exibe uma página em branco sem erros no console
- Sem warnings de TypeScript em nenhum package

---

### TASK-1.3 — Setup do LangGraph com grafo de estados inicial
**Responsável:** Codex  
**Tipo:** Implementação complexa

#### O que fazer
Implementar o grafo de estados do orquestrador em `packages/orchestrator/src/graph/`.

**Estrutura de arquivos:**
```
packages/orchestrator/src/graph/
├── index.ts          # Exporta o grafo compilado
├── nodes/
│   ├── receive.ts    # Nó de entrada
│   ├── analyze.ts    # Análise de tipo/complexidade
│   ├── route.ts      # Decisão de roteamento (mock por ora)
│   ├── execute.ts    # Execução de subtarefas (mock por ora)
│   ├── consolidate.ts
│   ├── output.ts
│   └── failed.ts
└── edges/
    └── conditions.ts # Funções que determinam qual aresta seguir
```

**Implementação do grafo:**
```typescript
import { StateGraph } from '@langchain/langgraph';
import { AgentContext } from '@repo/shared';

const graph = new StateGraph<AgentContext>({
  channels: { /* definir channels conforme AgentContext */ }
});

graph.addNode('receive', receiveNode);
graph.addNode('analyze', analyzeNode);
graph.addNode('route', routeNode);
graph.addNode('execute', executeNode);
graph.addNode('consolidate', consolidateNode);
graph.addNode('output', outputNode);
graph.addNode('failed', failedNode);

graph.addEdge('receive', 'analyze');
graph.addConditionalEdges('analyze', shouldContinueOrFail);
graph.addEdge('route', 'execute');
graph.addEdge('execute', 'consolidate');
graph.addEdge('consolidate', 'output');
graph.setEntryPoint('receive');
```

**Nós de implementação mínima (sem lógica real ainda — será implementada nas sprints seguintes):**
- Cada nó deve logar seu nome, o `taskId` e o timestamp de entrada
- Cada nó deve atualizar o `status` no `AgentContext`
- Nó `execute` deve criar uma subtarefa mock com `output_text: "mock output from [node]"`
- Nó `failed` deve logar o erro e definir `status: 'failed'`

**Endpoint de disparo (em `apps/api`):**
```typescript
POST /tasks
Body: { title: string, description: string, source: 'manual' }
Response: { taskId: string, status: 'received' }
```
O endpoint deve disparar o grafo de forma assíncrona e retornar imediatamente.

#### Definição de pronto
- `POST /tasks` com body válido retorna 202 com `taskId`
- Os logs mostram a sequência completa de nós sendo executados
- `POST /tasks` com body inválido retorna 400 com mensagem de erro clara
- Sem memory leaks (grafo não fica pendente após conclusão)

---

### TASK-1.4 — Revisar e validar o grafo de estados
**Responsável:** Claude  
**Tipo:** Revisão de código e arquitetura

#### O que fazer
Com o grafo implementado pelo Codex, realizar revisão crítica focada em:

1. **Edge cases de transição:**
   - O que acontece se o nó `analyze` lançar uma exceção não tratada?
   - O que acontece se o grafo for interrompido no meio (processo morto)?
   - Existe risco de o grafo ficar preso em loop entre dois nós?

2. **Verificar condições de parada:**
   - Todo caminho possível no grafo tem um nó terminal (`output` ou `failed`)?
   - O nó `failed` pode voltar para `receive` em caso de retry? Se sim, existe um limite máximo?

3. **Validar o tipo `AgentContext`:**
   - Todos os campos necessários estão presentes?
   - Os campos opcionais fazem sentido serem opcionais?
   - O tipo é extensível sem breaking changes?

4. **Revisar os logs:**
   - Os logs produzidos são suficientes para debugar um problema em produção?
   - Existe correlação por `taskId` em todos os logs?

#### Output esperado
- Arquivo `docs/graph-review.md` com lista de problemas encontrados, severidade (crítico/médio/baixo) e sugestão de correção
- Pull request com as correções aplicadas diretamente no código

---

### TASK-1.5 — Definir schema de memória compartilhada
**Responsável:** Ambos (Claude define, Codex implementa)  
**Tipo:** Design + implementação

#### Parte Claude — Design do schema

Definir o schema do objeto que vive no Redis durante a execução de uma tarefa:

```typescript
interface SharedMemory {
  taskId: string;
  workspaceId: string;
  
  // Estado atual
  currentStatus: TaskStatus;
  
  // Artefatos produzidos pelos agentes
  artifacts: {
    id: string;
    producedBy: 'claude' | 'gpt4';
    type: 'code' | 'text' | 'analysis' | 'review';
    content: string;
    createdAt: string; // ISO
  }[];
  
  // Locks ativos (para controle de concorrência)
  locks: {
    resource: string;   // ex: 'subtask:123', 'artifact:456'
    heldBy: string;     // ID do agente
    acquiredAt: string;
    expiresAt: string;
  }[];
  
  // Histórico de ações (append-only dentro da execução)
  history: {
    timestamp: string;
    node: string;
    action: string;
    agentId?: string;
  }[];
}
```

Definir também:
- **TTL padrão** do contexto no Redis (sugestão: 24h)
- **Estratégia de expiração:** o que acontece se o contexto expirar durante uma execução ativa?
- **Convenção de chaves:** `ws:{workspaceId}:task:{taskId}:context`

#### Parte Codex — Implementação

Criar `packages/orchestrator/src/memory/`:

```
memory/
├── index.ts
├── client.ts      # Conexão com Redis (ioredis)
├── context.ts     # get, set, update do SharedMemory
└── locks.ts       # acquireLock, releaseLock, withLock
```

**Funções a implementar:**
```typescript
// context.ts
getContext(taskId: string, workspaceId: string): Promise<SharedMemory | null>
setContext(taskId: string, workspaceId: string, ctx: SharedMemory): Promise<void>
appendHistory(taskId: string, workspaceId: string, entry: HistoryEntry): Promise<void>
appendArtifact(taskId: string, workspaceId: string, artifact: Artifact): Promise<void>

// locks.ts
acquireLock(resource: string, agentId: string, ttlMs: number): Promise<boolean>
releaseLock(resource: string, agentId: string): Promise<void>
withLock<T>(resource: string, agentId: string, fn: () => Promise<T>): Promise<T>
```

**Requisito de `withLock`:** se o lock não puder ser adquirido em até 3 tentativas (com backoff exponencial de 100ms, 200ms, 400ms), deve lançar `LockAcquisitionError`.

#### Definição de pronto
- Testes unitários para `acquireLock`, `releaseLock` e `withLock` (incluindo cenário de lock já adquirido)
- Testes para `appendHistory` (verificar que é append-only e não sobrescreve)
- Redis sendo usado nos nós do grafo (mesmo que passando contexto mock)

---

## Checklist de Conclusão da Sprint

- [ ] `docker-compose up` sobe tudo sem erros
- [ ] `GET /health` retorna 200
- [ ] `POST /tasks` dispara o grafo e loga todos os nós
- [ ] Grafo revisado por Claude com documento de review gerado
- [ ] Schema de memória compartilhada implementado e testado
- [ ] Sem warnings de TypeScript em nenhum package
- [ ] `.env.example` atualizado com todas as variáveis necessárias
- [ ] README da sprint atualizado com quaisquer decisões tomadas durante a implementação

---

## Dependências e Bloqueios

- **TASK-1.1 deve ser concluída antes de TASK-1.3** — o grafo só pode ser implementado após os tipos e a arquitetura serem definidos
- **TASK-1.3 deve estar minimamente funcional antes de TASK-1.4** — a revisão precisa de código para revisar
- **TASK-1.5 (Codex) pode começar em paralelo com TASK-1.3** após a parte de design (Claude) estar concluída

---

## Notas Técnicas

- Usar **ioredis** (não `redis` package) — melhor suporte a TypeScript e operações atômicas
- LangGraph para Node.js: `@langchain/langgraph` — verificar a versão mais recente antes de instalar
- Todos os logs devem incluir `{ taskId, workspaceId, timestamp, node }` no mínimo — usar **pino** como logger
- Não usar `console.log` em nenhum ponto — apenas o logger pino
- O grafo deve ser **stateless** — todo estado vive no `AgentContext` ou no Redis, nunca em variáveis globais do processo
