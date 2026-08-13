# Plano técnico de correção — busca visual

## 1. CAUSA RAIZ

Duas causas independentes, ambas confirmadas na base real:

**A) O índice vetorial nunca devolve mais de 40 linhas e colapsa com filtro de categoria.**
`hnsw.ef_search` está no padrão **40**. Teste na base: pedindo `limit 80` sem filtro veio **40 linhas**; com `where category = ...` veio **0 linhas**. O índice explora ~40 vizinhos globais e o filtro é aplicado depois, sobre esses 40 — se nenhum for da categoria, o resultado é vazio. Isso explica 48/60 nunca completarem e a busca por categoria falhar.

**B) A precisão caiu porque o pipeline perdeu duas etapas que existiam antes:** a normalização de formato da foto e a busca com dois vetores + fusão ponderada de rankings. Hoje a consulta envia **um vetor da foto crua**.

O que **não** é causa: o modelo DINOv2, a renomeação `dino.client.ts → dino-engine.ts` (só mudou o nome do arquivo, mesmo modelo/dimensões/normalização), a reindexação (21.376/21.376 completos), a métrica (cosseno, correta) e thresholds (não existe nenhum threshold de similaridade no código).

## 2. CORREÇÃO DO HNSW

- **Onde:** dentro da função de busca do banco (`match_pieces_v2`), com `SET LOCAL`. **Não** global.
- **Por que por consulta e não global:** global penalizaria toda e qualquer consulta e não se adapta ao número pedido (36 vs 60) nem à presença de filtro. Por consulta, o custo acompanha a necessidade. Também não requer alterar configuração do servidor.
- **Valor recomendado:** `ef_search = max(candidate_count, 100)`, com teto de 1000 (limite do pgvector). Para 60 resultados, `candidate_count` ~300 → `ef_search = 300`. Regra: `ef_search` **nunca menor que o número de linhas pedidas ao índice** — essa é a razão técnica do bug atual, não é "aumentar por segurança".
- **Ativar varredura iterativa:** pgvector aqui é **0.8.2**, que suporta `hnsw.iterative_scan`. Usar `relaxed_order` + `hnsw.max_scan_tuples` limitado. Isso faz o índice **continuar buscando** quando o filtro descarta candidatos, em vez de devolver menos linhas.
- **Performance:** `ef_search` 40 → 300 aumenta o trabalho por consulta de forma sublinear (HNSW cresce ~log). Em 21.376 vetores de 384 dims a busca continua em poucas dezenas de milissegundos; é uma tabela pequena para pgvector.
- **Custo:** não aumenta custo de créditos de IA (zero chamadas pagas). Só CPU do banco, dentro do plano atual.
- **36/48/60:** passa a funcionar, porque o índice devolve candidatos suficientes para sobreviver a filtro + deduplicação.
- **Candidatos antes do ranking:** ver seção 6.

## 3. CORREÇÃO DO FILTRO DE CATEGORIA

Avaliação das quatro opções:

| Estratégia | Veredito |
|---|---|
| Filtrar antes da busca vetorial (subconjunto) | Inviável: forçaria varredura sequencial da categoria, sem índice, e categorias grandes (3.000+ peças) ficariam lentas |
| Filtrar durante a busca (dentro do SQL, como hoje) | **Correto — desde que com iterative scan**; sem ele é exatamente o bug atual |
| Filtrar depois de recuperar candidatos (no servidor Node) | Desperdiça banda e nunca garante a cota; pior |
| Oversampling + re-ranking | **Complementar**, necessário para deduplicação, não substitui o filtro no SQL |

**Solução escolhida:** filtro **dentro da consulta SQL** (como já é), agora com `hnsw.iterative_scan = relaxed_order` e `ef_search` dimensionado. O índice passa a iterar até juntar `match_count` linhas *da categoria*. Sobre isso, oversampling no servidor para absorver a deduplicação por produto.

Fluxo: imagem → vetor → busca vetorial **com filtro no índice** (iterativa) → candidatos → fusão/ranking → dedup → corte.

## 4. NOVO PIPELINE DE BUSCA

A arquitetura que você descreveu é adequada e é a que existia antes. Confirmação do que o código antigo fazia (lido em `src/lib/pieces.functions.ts`, ainda presente na busca legada, e `src/lib/image-prep.ts`):

- **Normalização (`normalizeForShapeSearch`)**, em canvas, no navegador: (1) redução para lado máximo 768; (2) luminância (escala de cinza, remove cor do banho/pedra); (3) correção de iluminação por divisão pelo fundo suavizado (box blur, raio 12% do lado) — mata sombra e brilho especular; (4) gradiente + bounding box para recortar a peça (margem 6%); (5) equalização por percentis 2%–98%; (6) saída 640×640, fundo neutro `#808080`, peça centralizada ocupando 92%.
- **Dois vetores**: um da foto original e um da foto normalizada.
- **Pesos reais no código**: original = **1**, normalizada = **1,35** (`pieces.functions.ts:64-68`). Não inventados.
- **Fusão**: RRF ponderada — `score += peso / (12 + posição)` (`pieces.functions.ts:92`). A geometria era priorizada exatamente por esse peso maior da versão normalizada.
- **Threshold**: **não existia nenhum**. **Reranking extra**: nenhum além da RRF + deduplicação por `product_code`.
- A infraestrutura de múltiplos vetores **já existe** em `searchByVectorV2` (aceita até 3 vetores com peso e já faz a RRF) — está apenas subutilizada, recebendo um único vetor.

Pipeline proposto:

```text
Foto do usuário
 ├─ original ─────────────► DINOv2 ─► vetor A (peso 1,00)
 └─ normalizeForShapeSearch ─► DINOv2 ─► vetor B (peso 1,35)
        ↓
  match_pieces_v2 (por vetor): cosseno + filtro de categoria no índice,
  ef_search dimensionado, iterative_scan relaxed_order, match_count = candidate_count
        ↓
  fusão RRF ponderada  →  deduplicação/diversidade por product_code
        ↓
  corte em 36 / 48 / 60  →  tela
```

**Ponto crítico de compatibilidade:** o vetor B (normalizado, cinza, recortado) só faz sentido comparado contra um índice **também normalizado**. Comparar B contra o índice atual (fotos coloridas cruas) mede a coisa errada. Por isso a fase 2 (seção 8) cria uma segunda coluna de vetores normalizados do catálogo. Antes disso, ativar o vetor B contra o índice atual pode até **piorar** — vou medir, não supor.

## 5. ESTRATÉGIA DE RANKING

- Manter **cosseno** como métrica (correta para vetores L2-normalizados; já é o que o índice usa).
- Manter **RRF ponderada** (`peso / (k + posição)`), que é robusta quando os dois vetores têm escalas de similaridade diferentes — melhor que somar similaridades cruas.
- Avaliar `k` (hoje 12) junto com a medição: `k` baixo concentra o peso no topo, `k` alto suaviza.
- **Sem threshold de similaridade.** Ordenar por relevância e cortar por quantidade, nunca por corte de nota — é o que garante o requisito da seção 6.
- `sortMode = "recent"` continua reordenando apenas o conjunto já selecionado por relevância.

## 6. ESTRATÉGIA 36/48/60

Separação explícita:

- `result_count` = o que o usuário pediu (36/48/60).
- `candidate_count` = `min(1000, max(result_count * 5, 200))` por vetor → 36→200, 48→240, 60→300.
- `ef_search` = `max(candidate_count, 100)`.
- **Cota garantida:** se após fusão + dedup sobrar menos que `result_count`, uma segunda passada amplia `candidate_count` (ex.: ×2, teto 1000) e completa. Só devolve menos que o pedido quando a categoria/catálogo realmente não tem mais produtos distintos — e nesse caso a tela informa.
- Os resultados extras (37º ao 60º) vêm **na ordem de relevância**, nunca por relaxamento de critério.

## 7. ESTRATÉGIA DE DIVERSIDADE POR PRODUTO

Situação real medida: apenas **73 grupos** de `product_code` com mais de uma foto (~74 linhas em 21.376). Ou seja, a duplicação hoje é pequena — ela **não** é a causa do 48/60 falhar, mas o mecanismo precisa ser correto para o futuro.

Proposta: substituir o corte atual ("1 por produto, descarta o resto") por **penalização progressiva**: a 1ª foto de um produto entra com score integral; a 2ª entra com score ×0,35; a 3ª em diante fica fora, a menos que a cota não feche. Efeito: produtos distintos dominam o topo, mas uma segunda foto genuinamente parecida ainda pode aparecer mais abaixo, em vez de ser sumariamente eliminada.

## 8. IMPACTO NA REINDEXAÇÃO

- **O índice atual (`embedding_v2`, 21.376/21.376) permanece intacto.** Nada é apagado ou sobrescrito.
- A fase 1 (HNSW + categoria + cotas + diversidade) **não exige reindexação nenhuma**.
- A fase 2 (precisão geométrica) exige uma **nova coluna** `embedding_v2_shape vector(384)` + índice HNSW próprio, preenchida passando cada foto do catálogo pela **mesma** `normalizeForShapeSearch` antes do DINOv2. São, portanto, **dois embeddings por peça**: cru e normalizado.
- Compatibilidade: durante o preenchimento, a busca continua usando `embedding_v2`; o vetor normalizado só entra na fusão quando a cobertura estiver completa. Rollback = parar de usar a coluna nova.
- Custo: **zero créditos** (modelo local). Executo a reindexação no meu ambiente, sem depender da sua aba aberta.
- Isso só será feito **se** a medição da seção 11 mostrar ganho real.

## 9. IMPACTO DE PERFORMANCE

- Banco: `ef_search` maior + iterative scan → mais CPU por consulta, crescimento ~logarítmico; catálogo de 21 mil vetores de 384 dims é pequeno. Esperado permanecer em dezenas de milissegundos.
- Navegador: com o vetor B, são **duas** inferências DINOv2 por busca (~2× o tempo atual de embedding) mais o canvas de normalização (poucos ms). Modelo já em cache; as duas inferências rodam em paralelo quando o dispositivo permite.
- Rede: dois vetores de 384 números em vez de um — irrelevante.
- Armazenamento: +~30 MB de vetores + índice para a coluna nova.
- Custo financeiro de IA: **zero** nas duas fases.

## 10. PLANO DE IMPLEMENTAÇÃO

**Fase 0 — medição do estado atual (sem mudar nada)**
Script de avaliação no meu ambiente com amostra de peças reais, registrando acerto na 1ª posição, top-5, top-36 e nº de resultados devolvidos em cada combinação (sem/com categoria × 36/48/60). Vira a linha de base.

**Fase 1 — quantidade e categoria (efeito imediato, risco baixo)**
1. Migração: `match_pieces_v2` com `SET LOCAL hnsw.ef_search`, `hnsw.iterative_scan = relaxed_order`, `hnsw.max_scan_tuples` e parâmetro `ef` opcional.
2. `src/lib/vector.functions.ts`: `candidate_count` derivado do `result_count`, segunda passada para fechar cota, diversidade com penalização em vez de corte.
3. `consulta.tsx`: informar quando o catálogo não tem resultados suficientes.
4. Reexecutar a medição e comparar com a Fase 0.

**Fase 2 — precisão geométrica (só se a medição justificar)**
5. Migração: coluna `embedding_v2_shape` + índice HNSW.
6. Reindexação normalizada das 21.376 peças no meu ambiente.
7. `consulta.tsx`: gerar vetor A (original) e vetor B (normalizado via `image-prep.ts`) e enviar os dois com pesos 1,00 / 1,35.
8. `match_pieces_v2` aceitando qual coluna consultar; RRF combina as duas buscas.
9. Cadastro no Admin passa a gravar os dois vetores.
10. Medição final e ajuste dos pesos com base nos números.

## 11. TESTES DE VALIDAÇÃO

Harness no sandbox, reutilizando fotos reais do catálogo e simulando "peça bruta" (dessaturação, mudança de iluminação, fundo trocado) na imagem de consulta — a mesma metodologia dos testes que compararam CLIP e DINOv2.

Métricas por cenário:
- **Recall@1** (acerto na 1ª posição)
- **Recall@5** e **Recall@36**
- **MRR** (posição média da peça correta)
- **Linhas devolvidas** vs. pedidas — deve ser exatamente 36/48/60
- **Latência** (banco e navegador)

Matriz: {atual, proposto Fase 1, proposto Fase 2} × {sem categoria, com categoria} × {36, 48, 60}.

Critério de aceite: 100% de entrega da quantidade pedida em todas as células, e Recall@1/@5 do cenário proposto **≥** o atual. Se a Fase 2 não melhorar, ela não é aplicada.

## 12. RISCOS E POSSÍVEIS PROBLEMAS

- **Vetor normalizado contra índice cru mede a coisa errada** → risco real de piorar; mitigado só ativando o vetor B após a coluna normalizada existir, e sempre com medição.
- **`iterative_scan` com filtro muito restritivo** pode ficar lento em categorias pequenas → limitar com `max_scan_tuples`.
- **Duas inferências no celular** aumentam o tempo de busca em aparelhos fracos → medir; se necessário, calcular só o vetor B (normalizado) em dispositivos lentos.
- **A normalização pode recortar errado** em foto com fundo bagunçado (o código já cai para a imagem inteira quando não acha contorno) → a fusão com o vetor A protege esse caso.
- **DINOv2-small (384 dims) pode ter teto de precisão** abaixo do modelo antigo de 3072 dims. Se, depois das Fases 1 e 2, o número ainda não satisfizer, o próximo passo é testar DINOv2 `base` (768 dims) — mais preciso, download maior no celular. Também sem créditos.
- **Build/import no servidor:** `dino-engine.ts` e `image-prep.ts` continuam sendo importados **só dinamicamente, dentro de código de navegador** (`await import(...)` em handlers de evento), nunca em loader, server function ou `.server.ts`. `image-prep.ts` depende de `document`/canvas, então segue a mesma regra. Nenhum arquivo novo entra no grafo do servidor — a correção anterior é preservada.
