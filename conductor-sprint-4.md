# Sprint 4 — Frontend do Workspace

> **Duração:** Semanas 7–8  
> **Objetivo:** Construir o dashboard React que permite ao usuário ver os agentes trabalhando em tempo real, acompanhar o audit log visualmente e configurar o workspace.  
> **Entregável ao final:** Um usuário consegue acessar o dashboard, ver as tarefas em andamento com os agentes sendo executados, e navegar pelo histórico de decisões.

---

## Contexto para a IA

Esta sprint torna o produto visível pela primeira vez. O backend das sprints anteriores é completamente funcional, mas invisível para quem não lê logs. O frontend resolve isso.

O stack é **React + TypeScript + Tailwind CSS** — tecnologias que o desenvolvedor já conhece bem. O foco deve ser em clareza e usabilidade, não em design elaborado. O produto precisa parecer uma ferramenta profissional, não um protótipo.

Dados em tempo real chegam via **WebSocket** (Socket.io no backend, socket.io-client no frontend). O grafo de execução é o elemento visual mais importante e diferenciador do produto.

---

## Tarefas

---

### TASK-4.1 — Dashboard principal: lista de tarefas e agentes ativos
**Responsável:** Codex  
**Tipo:** Implementação

#### O que fazer

Criar as telas principais em `apps/web/src/pages/` e os componentes em `apps/web/src/components/`.

**Estrutura de rotas (React Router):**
```
/                    → redirect para /dashboard
/dashboard           → visão geral: tarefas recentes + agentes ativos
/tasks               → lista completa de tarefas com filtros
/tasks/:taskId       → detalhe de uma tarefa (grafo + audit log)
/settings            → configuração do workspace (conectores, LLMs)
```

**Componente: `AgentStatusCard`**
```
┌─────────────────────────────────────┐
│  Claude (Anthropic)          ● ativo │
│  ───────────────────────────────── │
│  Tasks hoje: 12    Custo: $0.43     │
│  Latência média: 1.2s               │
│  Taxa de erro: 0%                   │
│  Capability: code-review, analysis  │
└─────────────────────────────────────┘
```

Props:
```typescript
interface AgentStatusCardProps {
  agentId: string;
  name: string;
  isActive: boolean;
  metrics: {
    tasksToday: number;
    costUsd: number;
    avgLatencyMs: number;
    errorRate: number;
  };
  capabilities: AgentCapability[];
}
```

**Componente: `TaskListItem`**
```
┌────────────────────────────────────────────────────────┐
│ PROJ-42  Revisar PR de autenticação           ● running │
│ Jira · há 2 min · Claude + GPT-4 · $0.03              │
└────────────────────────────────────────────────────────┘
```

Props:
```typescript
interface TaskListItemProps {
  taskId: string;
  title: string;
  source: 'jira' | 'github' | 'manual';
  sourceId?: string;
  status: TaskStatus;
  agentsUsed: string[];
  costUsd: number;
  createdAt: Date;
  onClick: (taskId: string) => void;
}
```

**Página `/dashboard`:**
- Header: nome do workspace + total de tarefas hoje + custo acumulado do dia
- Seção "Agentes": dois cards (`AgentStatusCard`) lado a lado
- Seção "Tarefas recentes": lista dos últimos 10 itens com `TaskListItem`
- Atualização via WebSocket (sem polling)

**Setup do WebSocket no cliente:**
```typescript
// apps/web/src/lib/socket.ts
import { io, Socket } from 'socket.io-client';

let socket: Socket;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(import.meta.env.VITE_API_URL, {
      transports: ['websocket'],
      autoConnect: true
    });
  }
  return socket;
}
```

**Setup do WebSocket no servidor (apps/api):**
```typescript
import { Server } from 'socket.io';

// Emitir eventos quando o orquestrador atualiza o estado
io.emit('task:updated', { taskId, status, updatedAt });
io.emit('task:node:entered', { taskId, node, timestamp });
io.emit('task:subtask:completed', { taskId, subtaskId, agentId, result });
```

#### Definição de pronto
- Dashboard carrega com dados reais vindos da API
- Indicador de status dos agentes atualiza em tempo real via WebSocket
- Clicar em uma tarefa navega para `/tasks/:taskId`
- Página funciona com lista vazia (zero tasks) sem erros visuais
- Responsivo para telas de 1280px e 1440px de largura

---

### TASK-4.2 — Visualizador do grafo de execução em tempo real
**Responsável:** Codex  
**Tipo:** Implementação complexa

#### O que fazer

Criar o componente mais diferenciador do produto: uma visualização do grafo de estados que mostra, em tempo real, em qual nó a tarefa está sendo executada.

**Biblioteca recomendada:** `@xyflow/react` (React Flow) — excelente para grafos interativos, bem documentada, license MIT.

**Layout do grafo (sempre o mesmo — é o grafo de estados do orquestrador):**
```
[receive] → [analyze] → [route] → [execute] → [consolidate] → [output]
                                       ↕
                                   [failed]
```

**Estados visuais dos nós:**
- `idle` — cinza claro, borda fina
- `active` — azul com animação de pulsação (CSS keyframe)
- `completed` — verde
- `failed` — vermelho
- `retrying` — amarelo com contador de tentativas

**Dados do grafo vêm via WebSocket:**
```typescript
// O servidor emite:
io.emit('task:node:entered', { taskId, node: 'execute', timestamp });
io.emit('task:node:exited', { taskId, node: 'execute', status: 'completed', durationMs: 1240 });

// O cliente atualiza o estado visual dos nós em resposta a esses eventos
```

**Componente:**
```typescript
interface ExecutionGraphProps {
  taskId: string;
  initialNodeStates?: Record<string, NodeStatus>;  // para tarefas já concluídas
}

// Nodes fixos do grafo (posições definidas em código)
const GRAPH_NODES: Node[] = [
  { id: 'receive',     position: { x: 0,   y: 100 }, data: { label: 'Receber' } },
  { id: 'analyze',     position: { x: 160, y: 100 }, data: { label: 'Analisar' } },
  { id: 'route',       position: { x: 320, y: 100 }, data: { label: 'Rotear' } },
  { id: 'execute',     position: { x: 480, y: 100 }, data: { label: 'Executar' } },
  { id: 'consolidate', position: { x: 640, y: 100 }, data: { label: 'Consolidar' } },
  { id: 'output',      position: { x: 800, y: 100 }, data: { label: 'Output' } },
  { id: 'failed',      position: { x: 480, y: 220 }, data: { label: 'Falhou' } },
];
```

**Painel lateral do nó `execute`:**
Quando o nó `execute` está ativo, mostrar ao lado do grafo:
```
Em execução:
  Claude         → "Analisar problemas de segurança..."    [1.2s]
  GPT-4          → "Sugerir refatoração da função auth..." [0.8s]
```
Atualizado em tempo real via WebSocket.

#### Definição de pronto
- Grafo renderiza corretamente com todos os 7 nós e arestas
- Nó ativo pulsa visivelmente
- Quando `task:node:entered` é recebido, o nó correspondente muda de estado em < 100ms
- Para tarefas concluídas, o grafo mostra todos os nós com status final correto
- Grafo é read-only (sem drag, sem edição)

---

### TASK-4.3 — Timeline de decisões do orquestrador
**Responsável:** Ambos  
**Tipo:** Implementação + revisão

#### O que fazer

Criar o componente de audit log visual na página `/tasks/:taskId`.

**Codex — implementar o feed:**

Layout: timeline vertical, ordenada do mais recente para o mais antigo (invertível por toggle).

```
14:32:01  ✓ output          Comentário postado no Jira PROJ-42          [0.2s]
14:31:58  ✓ consolidate     Resultados consolidados: 2 artefatos         [0.1s]
14:31:57  ✓ subtask         GPT-4 concluiu geração de código             [2.3s] $0.02
14:31:55  ✓ subtask         Claude concluiu análise de segurança         [3.1s] $0.04
14:31:52  ● execute         2 agentes em execução paralela               ...
14:31:51  ⟳ routing         GPT-4 selecionado para code-gen (score: 78)  [0.1s]
           ↳ Claude selecionado para analysis (score: 84)
14:31:50  ✓ analyze         Tipo detectado: code-review + generation      [0.3s]
14:31:50  ✓ receive         Task recebida do Jira (PROJ-42)               [0.0s]
```

**Componente `AuditTimeline`:**
```typescript
interface AuditTimelineProps {
  taskId: string;
  entries: AuditEntry[];
  isLive: boolean;   // se true, novas entradas chegam via WebSocket
}
```

**Componente `AuditEntryItem`:**
- Ícone: ✓ (verde), ● (azul pulsando se live), ✗ (vermelho), ⟳ (amarelo)
- Timestamp formatado relativo ("há 2min") com tooltip do timestamp absoluto
- Duração em ms/s à direita
- Para evento `routing.decision`: expandível mostrando o breakdown de scoring
- Para evento `subtask.completed`: expandível mostrando o output do agente (truncado em 200 chars, com "ver mais")

**Claude — revisar o design da informação:**
- A ordem dos campos em cada item faz sentido para um desenvolvedor debugando?
- O breakdown de routing está claro o suficiente para justificar a decisão?
- Quais eventos são mais importantes e deveriam ter mais destaque visual?
- Existe alguma informação crítica faltando que um desenvolvedor precisaria ver?

#### Definição de pronto
- Timeline renderiza com dados reais do audit log
- Novas entradas aparecem em tempo real quando `isLive: true`
- Breakdown de routing é expandível e mostra todos os agentes avaliados
- Output de subtarefa é expandível
- Toggle cronológico/anti-cronológico funciona

---

### TASK-4.4 — Revisão de UX e acessibilidade
**Responsável:** Claude  
**Tipo:** Revisão

#### O que fazer

Com o dashboard funcional, realizar revisão completa de UX e acessibilidade.

**1. Fluxo de navegação:**
- O que um usuário novo vê quando abre o dashboard pela primeira vez (zero tarefas)?
- Existe um empty state claro com orientação de próximo passo?
- O caminho mais comum (ver tarefa → ver audit log → ver resultado no Jira) é intuitivo?

**2. Consistência visual:**
- Os status de tarefa (running, done, failed) têm cores consistentes em todos os componentes?
- Os valores monetários seguem a mesma formatação em todos os lugares?
- Os timestamps seguem o mesmo padrão?

**3. Feedback de erros:**
- O que o usuário vê se a conexão WebSocket cair?
- O que aparece se uma tarefa falhar?
- Os erros da API são tratados e exibidos de forma útil?

**4. Acessibilidade básica:**
- Todos os botões têm `aria-label` quando não têm texto visível?
- A paleta de cores tem contraste suficiente (WCAG AA)?
- A navegação por teclado funciona nas ações principais?

**5. Performance:**
- A lista de tarefas com 100 itens renderiza sem travar? (usar `react-virtual` se necessário)
- Múltiplas atualizações de WebSocket em sequência causam re-renders excessivos? (considerar debounce)

#### Output esperado
- Documento `docs/ux-review.md` com issues encontrados e prioridade
- PRs de correção para os problemas críticos e de alta prioridade nesta sprint
- Issues criados para os de média e baixa prioridade (a ser resolvido na Sprint 5)

---

### TASK-4.5 — Configuração de workspace multi-tenant
**Responsável:** Codex  
**Tipo:** Implementação

#### O que fazer

Criar a página de settings em `/settings` e os endpoints correspondentes.

**Seções da página de settings:**

**1. Conectores:**
```
Jira
  Status: ● Conectado (workspace: PROJ)   [Desconectar]
  Projeto: PROJECT_KEY
  Label de trigger: agent-task
  Último sync: há 5 min

GitHub  
  Status: ○ Não configurado               [Conectar]
  [Campo: GitHub Token]
  [Campo: Owner/Repo]
```

**2. Agentes:**
```
Claude (Anthropic)
  Status: ● Ativo
  [Campo: API Key]  ●●●●●●●●●●●●●●●●●sk-ant-...  [Editar]
  Capabilities: code-review, analysis, summarization
  
GPT-4 (OpenAI)  
  Status: ● Ativo
  [Campo: API Key]  ●●●●●●●●●●●●●●●●●sk-...       [Editar]
  Capabilities: code-generation, refactoring
```

**3. Limites:**
```
Custo máximo por tarefa: $[  0.50  ]
Timeout de subtarefa:    [  60    ] segundos
Concorrência máxima:     [  5     ] tarefas simultâneas
```

**Endpoints necessários (apps/api):**
```
GET  /workspaces/:id/settings
PUT  /workspaces/:id/settings
POST /workspaces/:id/connectors/jira
DELETE /workspaces/:id/connectors/jira
POST /workspaces/:id/connectors/github
DELETE /workspaces/:id/connectors/github
POST /workspaces/:id/agents/:agentId/apikey    # atualiza API key (encripta antes de salvar)
```

**Segurança:**
- API keys nunca são retornadas pela API (apenas os últimos 8 caracteres para identificação)
- Salvar criptografadas com `AES-256-GCM` e a chave de criptografia em variável de ambiente
- Formulário de API key tem campo `type="password"` com botão de reveal

#### Definição de pronto
- É possível conectar e desconectar o Jira pela interface
- API keys podem ser atualizadas sem revelar a key atual
- Limites de custo e timeout são salvos e aplicados pelo orquestrador
- Página carrega os valores atuais do workspace corretamente

---

## Checklist de Conclusão da Sprint

- [ ] Dashboard abre e exibe dados reais (tarefas + agentes)
- [ ] Grafo de execução atualiza em tempo real durante execução de uma tarefa
- [ ] Timeline de audit log é legível e expandível
- [ ] WebSocket reconecta automaticamente após queda
- [ ] Empty states presentes em todas as seções
- [ ] Página de settings funciona para conectar/desconectar Jira
- [ ] Revisão de UX concluída com issues documentados
- [ ] Sem warnings de TypeScript no frontend
- [ ] Console do browser sem erros em nenhuma das páginas

---

## Dependências e Bloqueios

- Sprint 3 deve estar 100% concluída
- **TASK-4.1 deve ser feita antes de TASK-4.2** — o grafo vive dentro da página de detalhe de tarefa
- **TASK-4.3 pode começar em paralelo com TASK-4.2**
- **TASK-4.4 só começa quando TASK-4.1, 4.2 e 4.3 estiverem funcionais**
- **TASK-4.5 pode ser feita em paralelo com todas as outras**

---

## Notas Técnicas

- Usar `@xyflow/react` versão 12+ para o React Flow
- `socket.io-client` deve ser a mesma versão major do `socket.io` no servidor
- Usar `react-query` (TanStack Query) para gerenciar as chamadas à API REST — não usar `useEffect` + `fetch` diretamente
- O WebSocket é complementar à API REST — não substituir: dados iniciais vêm da API, atualizações em tempo real vêm do WebSocket
- Tailwind: configurar apenas os breakpoints necessários (`md:` para 768px, `lg:` para 1280px)
- Não usar `localStorage` para nenhum dado — autenticação e estado via React Query + contexto
