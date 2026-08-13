# Fase 0 + Fase 1 — recuperação, quantidade e categoria

Escopo: apenas medição (Fase 0) e correção do mecanismo de recuperação (Fase 1).
Fase 2 (embedding_v2_shape, normalização de formato, segunda reindexação) fica fora.

## Fase 0 — linha de base (sem mudar produção)

Script de avaliação fora do app (`tmp-eval-search.mjs`, executado no sandbox), que não altera
nenhum comportamento da busca atual:

1. Amostra representativa: ~120 peças reais sorteadas do catálogo, proporcionalmente por
   categoria, todas com `embedding_v2` preenchido. A amostra é salva em arquivo para que
   ANTES e DEPOIS usem exatamente as mesmas peças.
2. Consulta = o próprio vetor da peça no banco (auto-consulta). Acerto = a peça (ou outra
   foto do mesmo `product_code`) aparecer no resultado.
3. Cada peça é consultada em 6 combinações: sem categoria e com a categoria correta, para
   36, 48 e 60 resultados.
4. Métricas registradas por combinação: Recall@1, Recall@5, Recall@36, MRR, quantidade
   efetivamente retornada (média e mínimo) e latência (média e p95).
5. O script reproduz exatamente o pipeline atual (RPC `match_pieces_v2` + fusão + 1 por
   `product_code`), sem tocar em `src/lib/vector.functions.ts`.
6. Resultado salvo em `/mnt/documents/baseline-fase0.json` + tabela no relatório.

## Fase 1 — correções

### Banco (migração)

Nova versão de `match_pieces_v2` com:

- `SET LOCAL hnsw.ef_search` recebido por parâmetro (`ef_search`), com teto de segurança;
- `SET LOCAL hnsw.iterative_scan = 'relaxed_order'`;
- `SET LOCAL hnsw.max_scan_tuples` com limite seguro (ordem de 20.000–50.000, ajustado pelo
  teste de latência);
- filtro de categoria mantido **dentro** da consulta vetorial (nada de filtrar no Node);
- retorno de `candidate_count` linhas (não do `result_count` final).

A função continua `SECURITY INVOKER`, `STABLE`, `search_path` fixo e sem EXECUTE para
`PUBLIC` (mantém o estado de segurança atual). Índice HNSW existente não é recriado.

### Escolha do ef_search

Teste comparativo com 100, 200, 300 e 500 sobre a mesma amostra, medindo recall,
quantidade retornada e latência. Escolho o menor valor que já entrega recuperação completa
(preenche 60 quando há produtos suficientes, inclusive com categoria) sem elevar latência
sem necessidade. O valor final vira constante no servidor, documentado no relatório.

### Servidor (`src/lib/vector.functions.ts`)

- Separar `result_count` (36/48/60 pedido pelo usuário) de `candidate_count`
  (dimensionado a partir do pedido, com folga para filtro/dedup — validado nos testes);
- passar `ef_search` e `candidate_count` para a RPC;
- segunda passada mais profunda apenas se, após dedup, faltarem resultados **e** existirem
  mais candidatos a explorar — sem repetir nem forçar itens irrelevantes;
- dedup permanece 1 por `product_code` (sem penalização 0,35);
- retornar, junto dos resultados, a informação de que o catálogo/categoria não tem produtos
  suficientes, para a interface poder avisar.

### Interface

Alteração mínima em `src/routes/_authenticated/consulta.tsx`: aviso discreto quando a
quantidade retornada for menor que a solicitada ("apenas N produtos disponíveis nesta
categoria"). Nada de mudança no layout, ranking ou pré-processamento.

### Não muda nesta fase

`normalizeForShapeSearch`, `embedding_v2_shape`, reindexação, modelo DINO, pesos e `k` da
RRF, pré-processamento e ranking visual permanecem como estão.

## Validação

Rodar o mesmo script da Fase 0 depois da mudança e apresentar a tabela ANTES x DEPOIS
(Recall@1, Recall@5, Recall@36, MRR, retornados, latência) para sem categoria e com
categoria, em 36/48/60. Aprovação exige preenchimento correto das cotas, categoria nunca
zerada por vizinhos globais, sem duplicação e sem degradação relevante de Recall@1/@5.

## Entrega

Relatório final com os 16 itens solicitados, e então parada — Fase 2 só com autorização.
