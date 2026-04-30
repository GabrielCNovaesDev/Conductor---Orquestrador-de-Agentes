# Multi-Agent Workspace — Documento Principal

> **Versão:** 1.0  
> **Stack:** Node.js · TypeScript · LangGraph · PostgreSQL · Redis · React · Docker  
> **Duração estimada:** 10 semanas (5 sprints de 2 semanas)

---

## 1. Visão Geral do Projeto

O **Multi-Agent Workspace** é uma plataforma de orquestração de agentes de IA multi-LLM, projetada para equipes de desenvolvimento de software. O sistema permite que múltiplos agentes de inteligência artificial — como Claude (Anthropic) e GPT-4 (OpenAI) — trabalhem em paralelo sobre tarefas reais de desenvolvimento, coordenados por um orquestrador central que decide automaticamente qual agente é mais adequado para cada trabalho.

O diferencial do produto em relação ao que existe no mercado (ex: OpenAI Assistants, Vertex AI Agents) é ser **vendor-neutral**, ou seja, não depende de um único provedor de LLM, e estar integrado ao **fluxo de trabalho já existente das equipes** via Jira e GitHub — não exigindo que os usuários mudem suas ferramentas.

### Problema que resolve

Equipes de produto e desenvolvimento enfrentam gargalos recorrentes: triagem de issues, análise de PRs, geração de documentação e revisão de código consomem tempo valioso de desenvolvedores. Ferramentas de IA existentes são isoladas — cada uma faz uma coisa, em um lugar diferente, sem integração com o contexto real do projeto.

### Solução

Um workspace unificado onde o usuário define uma tarefa (ex: "analise todos os PRs abertos e priorize os que bloqueiam o deploy") e o orquestrador distribui automaticamente subtarefas entre agentes especializados, executando em paralelo, com estado compartilhado e auditoria completa de cada decisão.

---

## 2. Arquitetura do Sistema

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (React)                      │
│         Dashboard · Grafo de execução · Audit log           │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP / WebSocket
┌──────────────────────────▼──────────────────────────────────┐
│                    API Gateway (Express)                      │
│              Auth · Rate limiting · Logging                  │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                  Orquestrador (LangGraph)                    │
│                                                             │
│   ┌─────────────┐    ┌─────────────┐    ┌───────────────┐  │
│   │  Roteador   │───▶│  Agente A   │    │   Agente B    │  │
│   │  de Tasks   │    │  (Claude)   │    │   (GPT-4)     │  │
│   └─────────────┘    └──────┬──────┘    └──────┬────────┘  │
│                             │                   │            │
│   ┌─────────────────────────▼───────────────────▼────────┐  │
│   │              Memória Compartilhada (Redis)            │  │
│   └──────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────▼──────┐  ┌────────▼───────┐  ┌──────▼────────┐
│  PostgreSQL  │  │   Jira API     │  │  GitHub API   │
│  (Audit log) │  │  (Issues/Tasks)│  │  (PRs/Code)   │
└──────────────┘  └────────────────┘  └───────────────┘
```

### Componentes principais

| Componente | Tecnologia | Responsabilidade |
|---|---|---|
| Frontend | React + TypeScript + Tailwind | Dashboard, visualização do grafo, audit log |
| API Gateway | Express + TypeScript | Entrada de requisições, auth, rate limiting |
| Orquestrador | LangGraph (Node.js) | Grafo de estados, roteamento, coordenação |
| Roteador de Agentes | Lógica customizada | Scoring de qual LLM usar por task |
| Memória Compartilhada | Redis | Estado entre agentes, cache de contexto |
| Banco de Dados | PostgreSQL | Persistência, audit log, multi-tenant |
| Fila de Tarefas | BullMQ + Redis | Tasks assíncronas, retry, dead letter queue |
| Conectores | MCP (Jira, GitHub) | Comunicação com ferramentas externas |

---

## 3. Conceitos Fundamentais

### 3.1 Orquestrador

O **orquestrador** é o cérebro do sistema. Implementado com **LangGraph**, ele define um grafo de estados que representa o ciclo de vida de uma tarefa:

```
RECEBIDA → ANALISADA → ROTEADA → EM_EXECUÇÃO → REVISÃO → CONCLUÍDA
                                      ↕
                                  FALHOU → RETRY
```

O orquestrador é responsável por:
- Receber uma tarefa de entrada (ex: vinda do Jira)
- Decompor em subtarefas quando necessário
- Decidir qual agente executa qual subtarefa
- Consolidar os resultados
- Atualizar o estado no Jira/GitHub
- Registrar tudo no audit log

### 3.2 Roteador de Agentes

O **roteador** decide qual LLM executa cada subtarefa com base em um sistema de scoring que considera:

- **Tipo de tarefa:** análise de código, geração de texto, revisão, sumarização
- **Custo estimado:** tokens esperados × preço por token de cada modelo
- **Latência tolerada:** tasks urgentes preferem modelos mais rápidos
- **Disponibilidade:** fallback automático se um LLM estiver fora ou com rate limit
- **Especialidade:** modelos podem ter perfis configurados (ex: Claude = revisão crítica, GPT-4 = geração de código)

### 3.3 Memória Compartilhada

Todos os agentes acessam um **contexto compartilhado** armazenado no Redis. Esse contexto contém:

- O objetivo geral da tarefa
- O histórico de ações já executadas
- Os artefatos produzidos (código gerado, textos, análises)
- Locks para evitar que dois agentes modifiquem o mesmo recurso simultaneamente

**Controle de concorrência:** antes de qualquer escrita no contexto, o agente adquire um lock com TTL. Se o lock não for liberado em tempo, o orquestrador assume falha e faz retry.

### 3.4 Audit Log

Toda decisão do sistema é registrada no PostgreSQL com:
- Timestamp
- Qual agente executou
- Qual LLM foi usado e por quê (output do roteador)
- Input recebido e output produzido
- Duração e custo estimado (tokens)
- Status (sucesso, falha, retry)

Esse log é a base para o painel de auditoria no frontend e é um diferencial competitivo importante para clientes enterprise.

### 3.5 Multi-Tenant

O sistema suporta múltiplas organizações (empresas) desde a fundação. Cada organização tem:
- Workspace isolado (dados segregados por `org_id` em todas as tabelas)
- Configurações próprias (quais LLMs usar, chaves de API, limites de uso)
- Conectores configurados individualmente (Jira de empresa A ≠ Jira de empresa B)

---

## 4. Integrações Externas

### 4.1 Jira

Protocolo: **MCP (Model Context Protocol)** via `https://mcp.atlassian.com/v1/mcp`

Operações suportadas:
- Listar issues de um projeto com filtros (status, assignee, sprint)
- Ler detalhes de uma issue (descrição, comentários, histórico)
- Atualizar status de uma issue
- Adicionar comentários (o agente reporta o que fez)
- Criar sub-tasks automaticamente

**Fluxo típico:**
1. Usuário aponta o workspace para um projeto Jira
2. Orquestrador faz polling periódico ou recebe webhook de nova issue
3. Agente analisa a issue e executa a ação configurada
4. Agente comenta na issue com o resultado e atualiza o status

### 4.2 GitHub

Protocolo: **API REST + Webhooks**

Operações suportadas:
- Listar PRs abertos com seus diffs
- Ler conteúdo de arquivos de um repositório
- Fazer comentários em PRs (line comments e review comments)
- Criar issues a partir de análises dos agentes
- Receber webhooks de eventos (PR aberto, push, etc.)

### 4.3 Adaptador de LLMs

Cada LLM é encapsulado em um **Adapter** com interface comum:

```typescript
interface LLMAdapter {
  id: string;
  name: string;
  call(prompt: string, context: AgentContext): Promise<LLMResponse>;
  estimateCost(tokens: number): number;
  isAvailable(): Promise<boolean>;
}
```

Adapters implementados no MVP:
- `ClaudeAdapter` → Anthropic API (`claude-sonnet-4-20250514`)
- `GPT4Adapter` → OpenAI API (`gpt-4o`)

---

## 5. Modelo de Dados

### Tabelas principais (PostgreSQL)

```sql
-- Organizações (multi-tenant)
organizations (id, name, plan, created_at)

-- Workspaces por organização
workspaces (id, org_id, name, config_json, created_at)

-- Tarefas recebidas pelo orquestrador
tasks (
  id, workspace_id, source,        -- 'jira' | 'github' | 'manual'
  source_id,                        -- ID da issue/PR na origem
  title, description,
  status,                           -- 'received' | 'running' | 'done' | 'failed'
  created_at, updated_at
)

-- Subtarefas dentro de uma task
subtasks (
  id, task_id, assigned_agent,      -- 'claude' | 'gpt4'
  assigned_reason,                   -- JSON com scoring do roteador
  input_prompt, output_text,
  status, tokens_used, cost_usd,
  started_at, finished_at
)

-- Audit log imutável
audit_log (
  id, task_id, subtask_id,
  event_type, payload_json,
  created_at
)

-- Conectores por workspace
connectors (
  id, workspace_id, type,           -- 'jira' | 'github'
  config_encrypted,                  -- credenciais criptografadas
  created_at
)
```

---

## 6. Fluxo de uma Tarefa (End-to-End)

```
1. ENTRADA
   └─ Issue criada no Jira / PR aberto no GitHub / Input manual no dashboard

2. RECEPÇÃO
   └─ Conector captura o evento (webhook ou polling)
   └─ API Gateway valida e encaminha ao Orquestrador

3. ANÁLISE
   └─ Orquestrador lê o contexto completo (issue, histórico, código relacionado)
   └─ Decompõe em subtarefas se necessário

4. ROTEAMENTO
   └─ Roteador calcula score para cada LLM disponível
   └─ Atribui subtarefas aos agentes

5. EXECUÇÃO PARALELA
   └─ Agente A (Claude) executa subtarefa 1
   └─ Agente B (GPT-4) executa subtarefa 2
   └─ Ambos escrevem no contexto compartilhado (Redis) com lock

6. CONSOLIDAÇÃO
   └─ Orquestrador aguarda todas as subtarefas
   └─ Consolida os resultados em uma resposta final

7. SAÍDA
   └─ Atualiza a issue no Jira (status + comentário com resultado)
   └─ Faz comentário no PR no GitHub (se aplicável)
   └─ Registra tudo no audit log

8. NOTIFICAÇÃO
   └─ Frontend recebe atualização via WebSocket
   └─ Usuário vê o resultado no dashboard em tempo real
```

---

## 7. Regras de Negócio Críticas

- **Nenhum agente pode modificar diretamente uma issue/PR sem passar pelo orquestrador.** Toda saída é intermediada.
- **O audit log é imutável.** Nenhuma operação de UPDATE ou DELETE é permitida na tabela `audit_log`.
- **Custo máximo por tarefa:** cada workspace pode configurar um limite de custo em USD por tarefa. O orquestrador aborta e notifica se o limite for atingido.
- **Timeout de subtarefa:** subtarefas têm timeout de 60s por padrão (configurável). Se estourar, o orquestrador marca como falha e faz retry com outro agente.
- **Isolamento de contexto:** o contexto Redis de um workspace nunca vaza para outro. Chaves sempre prefixadas com `ws:{workspace_id}:`.
- **Sem dados sensíveis em prompts:** credenciais, tokens e dados PII nunca devem ser incluídos nos prompts enviados aos LLMs. A camada de adaptação é responsável por essa sanitização.

---

## 8. Estrutura de Pastas do Projeto

```
multi-agent-workspace/
├── apps/
│   ├── api/                    # Express API Gateway
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   ├── middleware/
│   │   │   └── index.ts
│   │   └── package.json
│   └── web/                    # React Frontend
│       ├── src/
│       │   ├── pages/
│       │   ├── components/
│       │   └── main.tsx
│       └── package.json
├── packages/
│   ├── orchestrator/           # LangGraph + lógica de orquestração
│   │   ├── src/
│   │   │   ├── graph/          # Definição do grafo de estados
│   │   │   ├── agents/         # Adapters de LLM
│   │   │   ├── router/         # Roteador de agentes
│   │   │   └── memory/         # Gerenciamento de contexto Redis
│   │   └── package.json
│   ├── connectors/             # Jira, GitHub, futuras integrações
│   │   ├── src/
│   │   │   ├── jira/
│   │   │   └── github/
│   │   └── package.json
│   └── shared/                 # Types, utils, constantes compartilhadas
│       ├── src/
│       │   ├── types/
│       │   └── utils/
│       └── package.json
├── infra/
│   ├── docker-compose.yml
│   ├── docker-compose.prod.yml
│   └── migrations/             # SQL migrations do PostgreSQL
├── docs/
│   ├── README.md               # Este arquivo
│   ├── sprint-1.md
│   ├── sprint-2.md
│   ├── sprint-3.md
│   ├── sprint-4.md
│   └── sprint-5.md
└── package.json                # Monorepo root (npm workspaces)
```

---

## 9. Variáveis de Ambiente

```env
# LLMs
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# Banco de dados
DATABASE_URL=postgresql://user:pass@localhost:5432/multiagent

# Redis
REDIS_URL=redis://localhost:6379

# Auth
JWT_SECRET=
JWT_EXPIRES_IN=7d

# Jira (por workspace — armazenado no banco, não aqui)
# GitHub (por workspace — armazenado no banco, não aqui)

# App
PORT=3000
NODE_ENV=development
LOG_LEVEL=info

# Limites
DEFAULT_TASK_TIMEOUT_MS=60000
DEFAULT_MAX_COST_PER_TASK_USD=0.50
```

---

## 10. Decisões Técnicas e Justificativas

| Decisão | Alternativa considerada | Justificativa |
|---|---|---|
| LangGraph para orquestração | CrewAI, AutoGen | LangGraph é mais baixo nível e controlável; melhor para produção |
| Monorepo com npm workspaces | Repositórios separados | Compartilhamento de types e utils sem publicar pacotes |
| Redis para memória compartilhada | Banco de dados | Velocidade e suporte nativo a locks e TTL |
| BullMQ para filas | SQS, RabbitMQ | Simples de operar em VPS pequeno, baseado em Redis já usado |
| MCP para Jira | REST direto | MCP é o padrão emergente para integração de LLMs com ferramentas |
| PostgreSQL para audit log | MongoDB | Necessidade de consultas relacionais e garantia ACID no log |

---

## 11. Referências e Documentação

- [LangGraph Docs](https://langchain-ai.github.io/langgraphjs/)
- [Anthropic API Docs](https://docs.anthropic.com)
- [OpenAI API Docs](https://platform.openai.com/docs)
- [BullMQ Docs](https://docs.bullmq.io)
- [Atlassian MCP](https://mcp.atlassian.com)
- [GitHub REST API](https://docs.github.com/en/rest)

---

*Documentação gerada para uso como contexto de agentes de IA. Atualizar sempre que decisões arquiteturais forem alteradas.*
