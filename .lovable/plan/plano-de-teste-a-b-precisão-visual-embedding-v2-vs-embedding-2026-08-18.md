# Plano de Teste A/B — precisão visual (embedding_v2 vs embedding_v2 + shape)

Objetivo: medir, sem tocar em produção, se um segundo vetor de forma
(`embedding_v2_shape`) melhora o reconhecimento antes de reindexar 21.376 peças.
Nada de código de produção, índice, DINO ou Fase 1 é alterado. Nenhuma
reindexação global.

## Regra de isolamento

Todo o teste roda em um script fora do app (executado no sandbox), usando:

- coluna temporária isolada `embedding_v2_shape_ab` numa **tabela de teste**
  (`ab_shape_vectors`: `piece_id`, `vector`), preenchida apenas para as peças da
  amostra — a tabela `pieces` e `embedding_v2` não são tocados;
- a mesma RPC atual (`match_pieces_v2`) para o braço A e para a metade "v2" do
  braço B, com os mesmos parâmetros de Fase 1 (`ef_search = 100`, iterative
  scan, candidate_count = 5x);
- para a metade "shape" do braço B, busca sobre a amostra em memória (cosseno),
  porque só a amostra tem vetor de forma. Isso torna o braço B otimista apenas
  no lado shape; por isso o critério de aprovação exige margem mínima (abaixo).

## 1. Conjunto de imagens de teste

- 300 peças sorteadas do catálogo, proporcionalmente por categoria, todas com
  `embedding_v2` preenchido; a amostra é salva em arquivo e reutilizada nos dois
  braços (mesmas peças, mesma ordem).
- 2 tipos de consulta por peça:
  - **auto-consulta** (foto do catálogo) — mede retrieval puro;
  - **consulta "bruta" simulada**: mesma foto passada por
    `normalizeForShapeSearch` + perda de brilho/contraste do banho. Não é dado
    artificial novo, é a mesma imagem sob transformação declarada, e a mesma
    transformação é usada nos dois braços.
- Complemento manual: 40 fotos reais de peça bruta tiradas pelo usuário
  (celular), pareadas com o código da peça folheada. Esse subconjunto é o mais
  próximo do uso real e é reportado separadamente.

## 2. Ground truth

Acerto = o resultado pertence ao mesmo `product_code` da peça consultada
(qualquer foto do mesmo produto conta). Nas fotos reais, o `product_code` é
informado pelo usuário no arquivo de pares. O gabarito é congelado antes de
rodar qualquer braço.

## 3. Comparação A x B com as mesmas consultas

Para cada consulta: gera-se **uma única vez** o vetor v2 e uma única vez o vetor
shape, guardados em cache no arquivo da amostra. A = ranking com v2 apenas.
B = fusão RRF (mesmo k=12 da produção) de v2 + shape, pesos 1,0 / 1,35 —
os pesos ficam fixos e declarados, sem ajuste posterior para favorecer B.

## 4. Recall@1 / @5 / @36

Para cada consulta, posição do primeiro acerto no ranking final (após dedup por
`product_code`). Recall@k = fração de consultas com acerto até a posição k.
Medido para limite 36, 48 e 60, com e sem filtro de categoria correta.

## 5. MRR

Média de 1/posição do primeiro acerto; 0 quando não há acerto na lista
retornada. Mesma lista usada nos recalls.

## 6. Latência

Cronometrado por consulta em três partes: geração do(s) vetor(es), consulta ao
banco, fusão/dedup. Reporta média, p50, p95 e o custo extra absoluto de B
(ms/consulta). Cada braço roda 3 repetições, descartando a primeira (warm-up).

## 7. Qualidade dos primeiros resultados

- Precision@5 e Precision@10 por `product_code`;
- taxa de "top-1 correto" e taxa de "top-1 grosseiramente errado"
  (categoria diferente da peça consultada);
- contact sheet lado a lado dos 10 primeiros resultados de A e de B para 30
  consultas sorteadas, para inspeção visual do usuário.

## 8. Evitar contaminação

- mesmo `result_count` e mesmo `candidate_count` nos dois braços;
- mesmo filtro de categoria (rodadas separadas: sem categoria e com a correta);
- mesma regra de dedup (1 por `product_code`) aplicada depois da fusão nos dois;
- sem paginação: sempre a primeira página;
- a peça consultada não é removida do índice em nenhum braço;
- consultas cujo `product_code` não exista na amostra são excluídas dos dois
  braços igualmente.

## 9. Igualdade de consulta

Uma lista ordenada de consultas com IDs fixos; cada braço percorre a mesma
lista, na mesma ordem, com o mesmo pré-processamento e o mesmo vetor v2 em
cache. Seeds de sorteio fixas e registradas no relatório.

## 10. Apresentação

Tabela única por combinação (36/48/60 × com/sem categoria), colunas:
A, B, delta absoluto e delta relativo para Recall@1, @5, @36, MRR,
Precision@5, retornados médios, latência média e p95. Uma tabela extra só para
as 40 fotos reais. Resultado bruto salvo em `/mnt/documents/ab-shape.json`.

## 11. Volume necessário

300 peças × 2 tipos de consulta = 600 pares por combinação. Com Recall@1 na
faixa de 95–99%, isso dá intervalo de confiança de ±1,5–2 pontos, suficiente
para detectar diferença de 3 pontos ou mais. As 40 fotos reais são poucas para
significância, então servem como sinal qualitativo, não como critério isolado.
Comparação por McNemar nos pares (mesma consulta, acerto/erro em A e B).

## 12. Critério objetivo de aprovação de B

B é aprovado se, no conjunto simulado e sem prejuízo nas fotos reais:

- Recall@1 sobe ≥ 2 pontos percentuais com p < 0,05 (McNemar), **ou**
  Recall@1 empata e Recall@5 sobe ≥ 3 pontos;
- MRR não cai;
- nenhuma combinação (36/48/60, com/sem categoria) piora Recall@1 em mais de
  1 ponto;
- latência p95 total ≤ 2× a de A e ≤ 2.500 ms por consulta no celular.

## Recomendação por cenário

- **Cenário 1 — B claramente melhor:** aprovar Fase 2, com reindexação
  incremental do `embedding_v2_shape` em lotes (sem substituir `embedding_v2`),
  ativando a fusão só depois de 100% indexado, atrás de um interruptor.
- **Cenário 2 — B praticamente igual:** não reindexar. O ganho não paga o
  esforço nem o risco; investigar antes o pré-processamento da foto bruta e a
  qualidade da captura (guia de enquadramento/fundo na câmera).
- **Cenário 3 — B pior:** descartar `embedding_v2_shape` como está e manter a
  Fase 1. Reavaliar apenas com outra normalização, testada no mesmo protocolo.
- **Cenário 4 — mais preciso, mas lento:** aplicar shape apenas como
  **re-ranking** dos 60–100 primeiros candidatos de A (não como busca própria),
  medindo de novo latência; se ainda pesar no celular, manter Fase 1.

Ao fim do teste: relatório com as tabelas, o contact sheet e a recomendação —
sem alterar produção até sua aprovação.
