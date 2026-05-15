# Conductor — Orquestrador de Agentes

> Plataforma que coordena múltiplos agentes de IA (Claude, GPT-4) em paralelo sobre tarefas reais de desenvolvimento, com roteamento inteligente, retry automático e auditoria completa de cada decisão.

![Node.js](https://img.shields.io/badge/Node.js-≥20-339933?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)
![LangGraph](https://img.shields.io/badge/LangGraph-0.2-1C3C3C?logo=langchain&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![License](https://img.shields.io/badge/Licença-MIT-green)

---

## 🎯 Sobre o projeto

Equipes de desenvolvimento perdem horas por semana em tarefas repetitivas — triagem de issues, revisão de PRs, geração de documentação, análise de código. Ferramentas de IA existentes resolvem pedaços isolados desse problema, mas nenhuma coordena múltiplos modelos de forma integrada ao fluxo de trabalho real da equipe.

O Conductor é um orquestrador que recebe uma tarefa (vinda do Jira, GitHub ou input manual), decompõe em subtarefas, decide qual LLM é mais adequado para cada uma via scoring, executa em paralelo com estado compartilhado, e consolida o resultado — tudo com retry automático, controle de custo e audit log imutável.

O sistema é vendor-neutral: não depende de um único provedor de LLM. O roteador decide em runtime entre Claude e GPT-4 com base em tipo de tarefa, custo estimado e latência tolerada. Adicionar um novo modelo é implementar um adapter — o grafo não muda.

---

## 🏗️ Arquitetura e decisões técnicas

O motor de orquestração é um grafo de estados implementado com LangGraph. Cada nó tem responsabilidade única, e as transições são explícitas — o que torna debug e auditoria triviais.

```mermaid
flowchart TD
    START([POST /tasks]) --> receive[receive<br/>Valida payload, cria task]
    receive --> analyze[analyze<br/>Classifica tipo, decompõe em subtasks]
    analyze -->|ok| route[route<br/>Scoring de agentes, atribui subtasks]
    analyze -->|erro| failed[failed<br/>Decide retry ou abort]
    route --> execute[execute<br/>Dispara subtasks em paralelo]
    execute -->|ok| consolidate[consolidate<br/>Mescla outputs em resposta final]
    execute -->|erro| failed
    consolidate --> output[output<br/>Persiste resultado, notifica]
    output --> END([done])
    failed -->|retry| route
    failed -->|abort| END2([failed])
```

### Decisões técnicas com trade-offs

> **Decisão:** LangGraph (TypeScript) como framework de orquestração
> **Alternativas consideradas:** CrewAI, AutoGen
> **Por quê:** Único dos três com SDK first-class em TypeScript. Grafo de estados explícito permite debug determinístico e auditoria por nó — requisito central do produto. CrewAI esconde transições atrás de abstrações de "papéis"; AutoGen depende de conversas auto-organizadas, incompatível com auditoria.
> **Trade-off aceito:** Mais boilerplate por nó e documentação TS menos madura que a versão Python.

> **Decisão:** Monorepo com npm workspaces
> **Alternativas consideradas:** Polyrepo, Turborepo, Nx
> **Por quê:** Compartilhamento de tipos entre API, orchestrator e frontend sem publicar pacotes. Um `npm install` resolve tudo. Turborepo/Nx adicionam complexidade desnecessária para o tamanho atual do projeto.
> **Trade-off aceito:** Ordem de build entre packages exige disciplina manual (shared → connectors → orchestrator → api → web).

> **Decisão:** Redis para memória compartilhada entre agentes
> **Alternativas consideradas:** Estado in-memory, SQLite
> **Por quê:** Locks distribuídos com TTL nativo, suporte a múltiplas instâncias da API, e chaves prefixadas por workspace garantem isolamento multi-tenant. Permite escalar horizontalmente sem refatorar.
> **Trade-off aceito:** Dependência extra de infraestrutura para desenvolvimento local (resolvida com Docker Compose).

---

## 🛠️ Stack

| Camada | Tecnologia | Por que escolhi |
|--------|-----------|-----------------|
| Orquestração | LangGraph ^0.2.20 | Grafo de estados explícito com checkpointing nativo |
| API | Express 4.21 + Zod | Leve, maduro, validação type-safe na borda |
| Frontend | React 18 + Vite 5 + Tailwind | DX rápida, bundle otimizado, utility-first CSS |
| Banco de dados | PostgreSQL 16 | Auditoria imutável, multi-tenancy, JSONB para metadados |
| Cache / Locks | Redis 7 (ioredis) | Memória compartilhada entre agentes, locks distribuídos |
| Linguagem | TypeScript 5.6 | Tipos end-to-end do shared até o frontend |
| Infra local | Docker Compose | Um comando sobe Postgres + Redis + API + Web |
| Logging | Pino | JSON estruturado, baixa latência, correlação por taskId |
| Validação | Zod | Schema-first com inferência de tipos |

---

## 📁 Estrutura de pastas

```
conductor/
├── apps/
│   ├── api/                  # Express API — ponto de entrada HTTP
│   └── web/                  # React SPA — dashboard (scaffold)
├── packages/
│   ├── orchestrator/         # LangGraph — motor de orquestração
│   │   └── src/graph/        # Nós, arestas condicionais, tipos do grafo
│   ├── connectors/           # Adaptadores Jira (MCP) e GitHub (REST)
│   └── shared/               # Tipos e utilitários compartilhados
├── infra/
│   └── docker-compose.yml    # Postgres, Redis, API, Web
├── docs/
│   └── architecture-decision.md  # ADR do grafo de estados
├── .env.example              # Template de variáveis de ambiente
├── package.json              # Monorepo root (npm workspaces)
└── tsconfig.base.json        # Config TypeScript compartilhada
```

---

## 🚀 Como rodar localmente

### Pré-requisitos

- Docker 24+ e Docker Compose
- Node.js >= 20
- npm >= 10

### Passos

1. Clone o repositório:

```bash
git clone https://github.com/GabrielCNovaesDev/Conductor---Orquestrador-de-Agentes.git
cd Conductor---Orquestrador-de-Agentes
```

2. Copie o arquivo de variáveis de ambiente:

```bash
cp .env.example .env
```

3. (Opcional) Adicione suas chaves de API no `.env`. Na Sprint 1 o sistema roda com mocks — as chaves só são necessárias a partir da Sprint 2:

```bash
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

4. Suba o ambiente completo (Postgres, Redis, API, Web):

```bash
npm run dev
```

5. Verifique que a API está rodando:

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

6. Envie uma tarefa de teste:

```bash
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Analisar PR #42",
    "description": "Revisar mudanças de segurança no módulo de auth",
    "source": "manual"
  }'
# {"taskId":"uuid-gerado","status":"received"}
```

A API retorna `202 Accepted` e executa o grafo de orquestração em background.

---

## 🔐 Variáveis de ambiente

| Variável | Descrição | Padrão | Obrigatória |
|----------|-----------|--------|-------------|
| `ANTHROPIC_API_KEY` | Chave da API Anthropic (Claude) | — | Sim (Sprint 2+) |
| `OPENAI_API_KEY` | Chave da API OpenAI (GPT-4) | — | Sim (Sprint 2+) |
| `DATABASE_URL` | Connection string PostgreSQL | `postgresql://multiagent:multiagent@postgres:5432/multiagent` | Não (Docker provê) |
| `REDIS_URL` | URL de conexão Redis | `redis://redis:6379` | Não (Docker provê) |
| `JWT_SECRET` | Segredo para assinatura de tokens JWT | `dev-secret` | Sim (produção) |
| `JWT_EXPIRES_IN` | Tempo de expiração do JWT | `7d` | Não |
| `PORT` | Porta da API | `3000` | Não |
| `NODE_ENV` | Ambiente de execução | `development` | Não |
| `LOG_LEVEL` | Nível de log do Pino | `info` | Não |
| `VITE_API_URL` | URL da API para o frontend | `http://localhost:3000` | Não |
| `DEFAULT_TASK_TIMEOUT_MS` | Timeout máximo por tarefa (ms) | `60000` | Não |
| `DEFAULT_MAX_COST_PER_TASK_USD` | Limite de custo por tarefa em USD | `0.50` | Não |

---

## 📡 Endpoints principais

| Método | Rota | Descrição | Response |
|--------|------|-----------|----------|
| GET | `/health` | Health check da API | `200 {"status":"ok"}` |
| POST | `/tasks` | Cria e executa uma tarefa no grafo de orquestração | `202 {"taskId":"...","status":"received"}` |

### POST /tasks — payload

```json
{
  "title": "string (obrigatório)",
  "description": "string (obrigatório)",
  "source": "manual | jira | github",
  "sourceId": "string (opcional — ID externo da issue/PR)",
  "workspaceId": "string (opcional — default: 'default-workspace')",
  "orgId": "string (opcional — default: 'default-org')"
}
```

Validação feita com Zod na borda da API. Payloads inválidos retornam `400` com detalhes dos erros por campo.

---

## 🧪 Testes

O projeto utiliza verificação de tipos e linting como primeira linha de defesa:

```bash
npm run typecheck   # Verificação de tipos em todos os packages
npm run lint        # ESLint em todos os packages
```

**Estratégia planejada (Sprint 2+):**

- Unitários: Vitest para lógica dos nós do grafo e roteador
- Integração: Supertest para endpoints da API com banco real
- E2E: Fluxo completo de tarefa (POST → grafo → resultado)

---

## 🗺️ Roadmap

- [x] **Sprint 1** — Fundação: monorepo, grafo de estados com mocks, API base, Docker Compose
- [ ] **Sprint 2** — Integração LLMs: adapters Claude/GPT-4, roteamento com scoring real
- [ ] **Sprint 3** — Conectores externos: Jira via MCP, GitHub via REST + Webhooks
- [ ] **Sprint 4** — Frontend: dashboard React, visualização do grafo em tempo real, WebSocket
- [ ] **Sprint 5** — Estabilização: testes E2E, CI/CD, deploy em cloud, demo funcional

---

## 📚 Aprendizados

- Aprendi que LangGraph força pensar em cada transição como uma aresta explícita — isso gera mais boilerplate que CrewAI, mas em troca o debug e a auditoria ficam triviais. Cada bug é rastreável até um nó específico.
- Monorepo com npm workspaces simplifica o compartilhamento de tipos entre packages, mas a ordem de build (shared → connectors → orchestrator → api) exige disciplina. Um tipo alterado no shared quebra silenciosamente se o build não rodar na sequência certa.
- Projetar multi-tenancy desde o dia zero (prefixar chaves Redis com `ws:{workspaceId}`) parece over-engineering no início, mas evita uma refatoração dolorosa quando o segundo workspace aparece.
- O padrão Adapter para LLMs se pagou antes mesmo de integrar o segundo modelo — ao desenhar a interface `NodeFn`, percebi que o grafo não precisa saber qual LLM está por trás. A abstração nasceu da necessidade, não de antecipação.
- Usar Zod na borda da API e confiar nos tipos internos eliminou uma classe inteira de bugs: o grafo nunca recebe dados malformados. Validação na entrada, confiança no interior.

---

## 📄 Licença

Distribuído sob a licença MIT. Veja [`LICENSE`](LICENSE) para mais informações.

---

## 👤 Autor

**Gabriel Novaes**

- GitHub: [@GabrielCNovaesDev](https://github.com/GabrielCNovaesDev)
- LinkedIn: [Gabriel Novaes](https://www.linkedin.com/in/gabrielhcnovaes/)
