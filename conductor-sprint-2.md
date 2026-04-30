# Sprint 2 — Integração dos LLMs

> **Duração:** Semanas 3–4  
> **Objetivo:** Substituir os mocks do orquestrador por chamadas reais ao Claude e ao GPT-4, com um roteador funcional que decide qual modelo usar com base em scoring.  
> **Entregável ao final:** Uma tarefa de texto (ex: "resuma este texto") enviada via `POST /tasks` é executada de verdade por um dos LLMs, com o resultado retornando no audit log e no Redis.

---

## Contexto para a IA

Esta sprint transforma o esqueleto da Sprint 1 em um sistema que realmente chama LLMs. O foco está em dois problemas: (1) abstrair as diferenças entre APIs de diferentes provedores, e (2) criar uma lógica inteligente de roteamento que escolha o modelo certo para cada tarefa.

Importante: nesta sprint os conectores externos (Jira, GitHub) ainda não estão presentes. Todas as tarefas entram via `POST /tasks` manualmente. A integração com fontes externas acontece na Sprint 3.

---

## Tarefas

---

### TASK-2.1 — Camada de abstração para múltiplas APIs
**Responsável:** Codex  
**Tipo:** Implementação complexa

#### O que fazer

Criar `packages/orchestrator/src/agents/` com o padrão Adapter para cada LLM.

**Interface base (definida na Sprint 1, implementar aqui):**
```typescript
// packages/orchestrator/src/agents/types.ts
export interface LLMAdapter {
  readonly id: string;                         // 'claude' | 'gpt4'
  readonly name: string;                       // nome legível
  readonly capabilities: AgentCapability[];    // o que este agente faz bem
  
  call(input: LLMCallInput): Promise<LLMResponse>;
  estimateCost(inputTokens: number, outputTokens: number): number;
  isAvailable(): Promise<boolean>;
  getMetrics(): AdapterMetrics;                // latência média, taxa de erro
}

export interface LLMCallInput {
  systemPrompt: string;
  userMessage: string;
  context: SharedMemory;     // contexto completo da tarefa
  maxTokens?: number;        // padrão: 2048
  temperature?: number;      // padrão: 0.3
}

export interface LLMResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  model: string;             // modelo exato usado (ex: 'claude-sonnet-4-20250514')
}

export type AgentCapability = 
  | 'code-generation'
  | 'code-review'
  | 'text-generation'
  | 'summarization'
  | 'analysis'
  | 'refactoring';

export interface AdapterMetrics {
  avgLatencyMs: number;
  errorRate: number;          // 0.0 a 1.0
  callsLast1h: number;
}
```

**Implementar `ClaudeAdapter`:**
```typescript
// packages/orchestrator/src/agents/claude.adapter.ts
import Anthropic from '@anthropic-ai/sdk';

export class ClaudeAdapter implements LLMAdapter {
  readonly id = 'claude';
  readonly name = 'Claude (Anthropic)';
  readonly capabilities: AgentCapability[] = [
    'code-review', 'analysis', 'summarization', 'text-generation'
  ];
  
  private client: Anthropic;
  private metrics: AdapterMetrics = { avgLatencyMs: 0, errorRate: 0, callsLast1h: 0 };
  
  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  
  async call(input: LLMCallInput): Promise<LLMResponse> {
    const start = Date.now();
    try {
      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: input.maxTokens ?? 2048,
        system: input.systemPrompt,
        messages: [{ role: 'user', content: input.userMessage }]
      });
      // atualizar métricas de sucesso
      return { /* mapear response */ };
    } catch (err) {
      // atualizar métricas de erro
      throw new LLMCallError('claude', err);
    }
  }
  
  estimateCost(inputTokens: number, outputTokens: number): number {
    // claude-sonnet-4: $3/MTok input, $15/MTok output
    return (inputTokens * 3 + outputTokens * 15) / 1_000_000;
  }
  
  async isAvailable(): Promise<boolean> {
    // tentativa de chamada mínima ou verificação de health
    return this.metrics.errorRate < 0.5;
  }
}
```

**Implementar `GPT4Adapter`:**
```typescript
// packages/orchestrator/src/agents/gpt4.adapter.ts
import OpenAI from 'openai';

export class GPT4Adapter implements LLMAdapter {
  readonly id = 'gpt4';
  readonly name = 'GPT-4o (OpenAI)';
  readonly capabilities: AgentCapability[] = [
    'code-generation', 'refactoring', 'text-generation', 'analysis'
  ];
  // ... implementação similar
}
```

**Registry de adapters:**
```typescript
// packages/orchestrator/src/agents/registry.ts
export class AgentRegistry {
  private adapters: Map<string, LLMAdapter> = new Map();
  
  register(adapter: LLMAdapter): void
  getById(id: string): LLMAdapter | undefined
  getAvailable(): Promise<LLMAdapter[]>
  getAll(): LLMAdapter[]
}
```

#### Definição de pronto
- Chamada real ao Claude retorna resposta e popula `LLMResponse` corretamente
- Chamada real ao GPT-4 retorna resposta e popula `LLMResponse` corretamente
- Métricas são atualizadas após cada chamada (latência e taxa de erro)
- Erros de API (rate limit, timeout, auth) são capturados e relançados como `LLMCallError` tipado
- Testes unitários com mocks das APIs (não chama API real nos testes)

---

### TASK-2.2 — Implementar roteador de agentes
**Responsável:** Codex  
**Tipo:** Implementação complexa

#### O que fazer

Criar `packages/orchestrator/src/router/` com a lógica de scoring para decidir qual LLM executa cada subtarefa.

**Algoritmo de scoring:**

Para cada LLM disponível, calcular um score (0–100) com base em:

| Critério | Peso | Cálculo |
|---|---|---|
| Compatibilidade de capability | 40 | Se o LLM tem a capability necessária: 40pts; parcial: 20pts; nenhuma: 0pts |
| Custo estimado | 30 | LLM mais barato para o token count estimado recebe 30pts; proporcional |
| Latência média | 20 | LLM com menor latência média recebe 20pts; proporcional |
| Taxa de disponibilidade | 10 | 10pts × (1 - errorRate) |

O LLM com maior score é selecionado. Em caso de empate, preferir o de menor custo.

**Interface do roteador:**
```typescript
// packages/orchestrator/src/router/types.ts
export interface RoutingDecision {
  selectedAgentId: string;
  score: number;
  breakdown: {
    agentId: string;
    score: number;
    capabilityScore: number;
    costScore: number;
    latencyScore: number;
    availabilityScore: number;
    estimatedCostUsd: number;
  }[];
  reasoning: string;    // texto explicando a decisão — vai para o audit log
}

export interface RoutingInput {
  requiredCapability: AgentCapability;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  urgency: 'low' | 'normal' | 'high';    // high = prioriza latência
  budgetLimitUsd?: number;                // se definido, exclui LLMs acima do limite
}
```

**Implementação:**
```typescript
// packages/orchestrator/src/router/router.ts
export class AgentRouter {
  constructor(private registry: AgentRegistry) {}
  
  async route(input: RoutingInput): Promise<RoutingDecision>
  
  private scoreAgent(
    adapter: LLMAdapter, 
    input: RoutingInput,
    available: LLMAdapter[]
  ): ScoreBreakdown
}
```

**Integração com o grafo:** o nó `route` da Sprint 1 (que era mock) deve ser atualizado para chamar o `AgentRouter` e salvar a `RoutingDecision` no `AgentContext`.

#### Definição de pronto
- Para uma task de `code-review`, o Claude é selecionado sobre o GPT-4
- Para uma task de `code-generation`, o GPT-4 é selecionado sobre o Claude
- Se um LLM tem `errorRate > 0.5`, ele não é selecionado
- Se o único LLM disponível está acima do `budgetLimitUsd`, a tarefa falha com erro descritivo
- A `RoutingDecision` é salva no `AgentContext` e aparece nos logs
- Testes unitários para cada critério de scoring individualmente

---

### TASK-2.3 — Revisar lógica de roteamento e cobrir edge cases
**Responsável:** Claude  
**Tipo:** Revisão de código

#### O que fazer

Com o roteador implementado, revisar criticamente a lógica buscando:

**1. Cenários de fallback:**
- O que acontece se TODOS os LLMs estão indisponíveis? A tarefa deve falhar com `AllAgentsUnavailableError`
- O que acontece se um LLM estava disponível no momento do roteamento mas fica indisponível durante a execução? O grafo deve capturar o erro, atualizar as métricas do adapter e tentar rerotear para outro LLM

**2. Problemas de fairness:**
- Se o Claude tem latência históricamente menor apenas por ter sido chamado menos vezes, o scoring está tendencioso? Considerar normalização por número de chamadas
- O score de `capability` é binário (tem ou não tem) — isso é justo? Considerar um score gradual baseado em quantas das capabilities necessárias o modelo possui

**3. Gaming do sistema:**
- Um agente com todas as chamadas falhando tem `errorRate = 1.0` e score 0 de availability. Mas e se ele se recuperar? As métricas têm janela deslizante ou são cumulativas? Recomendar janela de 1 hora

**4. Revisar o campo `reasoning`:**
- O texto gerado é suficientemente descritivo para um desenvolvedor entender a decisão sem olhar o código?
- Exemplo de bom reasoning: `"GPT-4o selecionado (score 78/100): melhor compatibilidade com code-generation (40pts), custo similar ao Claude (28pts vs 30pts). Claude excluído por latência média 40% maior nesta janela."`

#### Output esperado
- Arquivo `docs/router-review.md` com findings e recomendações
- Issues/PRs criados para os problemas encontrados, ordenados por prioridade
- Implementação das correções críticas (severidade alta) direto nesta sprint

---

### TASK-2.4 — Testes de integração: agentes em paralelo
**Responsável:** Ambos  
**Tipo:** Testes

#### Contexto

Esta é a primeira vez que dois agentes vão executar em paralelo com contexto compartilhado. O objetivo é validar que eles não interferem um no outro.

#### O que fazer

**Codex — implementar os testes:**

Criar `packages/orchestrator/tests/integration/parallel-execution.test.ts`.

Cenários obrigatórios:

```typescript
// Cenário 1: dois agentes em paralelo, sem conflito
test('dois agentes executam subtarefas independentes sem interferência', async () => {
  // Criar uma task com duas subtarefas sem sobreposição de resources
  // Verificar que ambas são concluídas e os artefatos estão corretos
  // Verificar que o histórico no Redis mostra as duas execuções
});

// Cenário 2: dois agentes tentam escrever no mesmo artefato
test('lock previne escrita simultânea no mesmo artefato', async () => {
  // Simular dois agentes tentando chamar appendArtifact com o mesmo ID
  // Verificar que apenas um consegue e o outro aguarda ou falha com LockAcquisitionError
});

// Cenário 3: um agente falha, o outro continua
test('falha de um agente não afeta execução do outro', async () => {
  // Mockar ClaudeAdapter para lançar LLMCallError
  // Verificar que GPT-4 completa sua subtarefa
  // Verificar que o nó consolidate recebe resultado parcial e trata adequadamente
});

// Cenário 4: timeout de subtarefa
test('subtarefa que excede timeout é marcada como failed', async () => {
  // Mockar um adapter para demorar mais que o timeout configurado
  // Verificar que o grafo transita para failed corretamente
});
```

**Claude — revisar os cenários:**
- Os 4 cenários cobrem os casos mais críticos de produção?
- Existe algum race condition óbvio não coberto?
- Os assertions são suficientemente específicos (não apenas "não lançou exceção")?

#### Definição de pronto
- Todos os 4 cenários passam consistentemente (rodar 3 vezes seguidas sem flakiness)
- Tempo de execução dos testes < 10 segundos (usar mocks de Redis em memória)
- Coverage do módulo `memory/` > 80%

---

### TASK-2.5 — Documentar a API interna (OpenAPI)
**Responsável:** Claude  
**Tipo:** Documentação

#### O que fazer

Criar `apps/api/openapi.yaml` com a especificação OpenAPI 3.1 de todos os endpoints implementados até agora.

**Endpoints a documentar:**

```yaml
paths:
  /health:
    get: ...  # health check

  /tasks:
    post:
      summary: Criar e executar uma nova tarefa
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [title, description, source]
              properties:
                title:
                  type: string
                  example: "Revisar PR #42"
                description:
                  type: string
                  example: "Analise o código e aponte problemas de segurança"
                source:
                  type: string
                  enum: [manual, jira, github]
                workspaceId:
                  type: string
                  description: "Obrigatório para source != manual em produção"
      responses:
        '202':
          description: Tarefa aceita e em processamento
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/TaskCreatedResponse'
        '400':
          $ref: '#/components/responses/ValidationError'

  /tasks/{taskId}:
    get:
      summary: Consultar status e resultado de uma tarefa
      ...

  /tasks/{taskId}/audit:
    get:
      summary: Retorna o audit log completo de uma tarefa
      ...
```

**Schemas a definir:**
- `Task` — entidade completa
- `Subtask` — subtarefa com resultado
- `AuditEntry` — entrada do log
- `RoutingDecision` — decisão do roteador
- `ValidationError` — erro de validação padronizado

#### Definição de pronto
- YAML válido (verificar com `swagger-cli validate`)
- Todos os campos têm `description` e `example`
- Erros HTTP documentados: 400, 401, 404, 429, 500
- Spec pode ser aberta no Swagger UI sem warnings

---

## Checklist de Conclusão da Sprint

- [ ] Chamada real ao Claude funciona via `ClaudeAdapter`
- [ ] Chamada real ao GPT-4 funciona via `GPT4Adapter`
- [ ] Roteador seleciona Claude para `code-review` e GPT-4 para `code-generation`
- [ ] `RoutingDecision` aparece no audit log com `reasoning` descritivo
- [ ] Parallelismo testado e sem race conditions conhecidos
- [ ] `POST /tasks` com uma task de summarization retorna resultado real de um LLM
- [ ] OpenAPI spec gerada e válida
- [ ] Métricas de adapter (latência, error rate) sendo acumuladas corretamente
- [ ] Sem chamadas à API real nos testes (todos mockados)

---

## Dependências e Bloqueios

- Todas as tasks desta sprint dependem da Sprint 1 estar **100% concluída**
- **TASK-2.1 deve estar concluída antes de TASK-2.2** — o roteador precisa do `AgentRegistry`
- **TASK-2.2 deve estar concluída antes de TASK-2.3** — revisão precisa de código funcional
- **TASK-2.4 pode começar em paralelo com TASK-2.3** — os testes podem ser escritos enquanto a revisão acontece

---

## Notas Técnicas

- Instalar `@anthropic-ai/sdk` e `openai` nos packages corretos
- **Nunca logar o conteúdo dos prompts em produção** — apenas metadados (tokens, duração, modelo). Prompts podem conter dados sensíveis do cliente
- Usar variáveis de ambiente diferentes para testes (`TEST_ANTHROPIC_API_KEY`) — ou melhor, sempre mockar nos testes
- O `estimateCost` é uma estimativa pré-execução. O custo real vem do `LLMResponse` após a chamada. Salvar ambos no `subtask` record
- Preços de referência (verificar atualização antes de implementar): Claude Sonnet 4: $3/MTok in, $15/MTok out · GPT-4o: $2.50/MTok in, $10/MTok out
