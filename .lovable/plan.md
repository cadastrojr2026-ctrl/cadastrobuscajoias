# Análise técnica — busca visual (semijoias)

## DIAGNÓSTICO

Há **dois problemas distintos**, e nenhum deles é "o DINO estar errado":

**1. O índice vetorial está limitando os resultados a 40 e quebrando quando há filtro de categoria (causa principal do 36/48/60 não funcionar).**
O índice HNSW do banco está com o parâmetro de exploração no padrão (`hnsw.ef_search = 40`). Medi na base real: pedindo 80 peças mais parecidas, o banco devolveu **apenas 40 linhas**. E quando a busca tem filtro de categoria, o mesmo pedido devolveu **0 linhas** — o índice explora só 40 vizinhos globais e, se nenhum deles for da categoria escolhida, sobra nada. Por isso 48 e 60 nunca chegam completos e a busca dentro de uma categoria parece "não achar".

**2. A precisão caiu porque o pipeline de comparação ficou mais simples do que era antes** — não porque o modelo local seja ruim.
No sistema antigo, a foto enviada passava por normalização de formato (cinza, correção de iluminação, recorte da peça, fundo neutro) e a busca combinava **dois vetores** (foto original + foto normalizada) com fusão de rankings ponderada, priorizando geometria. Hoje a foto do usuário vai **crua**, com um único vetor. O arquivo de normalização (`src/lib/image-prep.ts`) continua no projeto, mas **não é mais chamado por ninguém**. Como o catálogo é peça folheada em fundo claro e a sua foto é peça bruta com sombra/mesa, essa diferença de iluminação e fundo entra no vetor e empurra a peça correta para baixo.

A reindexação **está correta e completa**: 21.376 de 21.376 peças com vetor novo (`embedding_v2`), nenhuma faltando, nenhuma inválida. O índice antigo de 3072 dimensões segue intacto como backup.

## EVIDÊNCIAS

- Estado real do índice (consulta no banco): `total = 21376`, `embedding_v2 = 21376`, `embedding (antigo) = 21376`, peças sem vetor novo = 0.
- `select current_setting('hnsw.ef_search')` → **40**. Índice: `pieces_embedding_v2_idx ... USING hnsw (embedding_v2 vector_cosine_ops)`.
- Teste de recuperação na base real, pedindo `limit 80`: retornou **40 linhas** (similaridade de 1,000 até 0,717). Com filtro de categoria: **0 linhas**.
- `src/routes/_authenticated/consulta.tsx` (`doImageSearch`): envia `vectors: [{ vector, weight: 1 }]` — **um único vetor**, sem chamar `normalizeForShapeSearch`.
- `rg` por `normalizeForShapeSearch` → só a própria definição em `src/lib/image-prep.ts`; **nenhum consumidor**.
- `src/lib/vector.functions.ts` (`searchByVectorV2`): `pool = min(80, ...)` — teto de 80 candidatos; depois deduplica por `product_code`. Grupos com mais de uma foto do mesmo produto: **73** (impacto pequeno, ~74 linhas no catálogo inteiro).
- `src/lib/dino-engine.ts`: modelo `onnx-community/dinov2-with-registers-small`, token CLS, 384 dims, vetor **normalizado** (L2) — o mesmo código é usado no cadastro (`admin.tsx`), na reindexação (`reindex-panel.tsx`) e na consulta. Catálogo e consulta usam **exatamente o mesmo modelo e pré-processamento** hoje.
- Similaridade: **cosseno** (`<=>` com `vector_cosine_ops` em `match_pieces_v2`, retornando `1 - distância`). Não há threshold mínimo de similaridade em nenhum ponto.
- `dino.client.ts` → `dino-engine.ts`: renomeação de arquivo apenas. O conteúdo, o modelo, as dimensões e a normalização são os mesmos; a mudança foi para o build parar de bloquear o import no servidor. **Não afeta o reconhecimento.**

## FLUXO ATUAL

```text
Foto do usuário
  → lida como data URL (SEM normalização de formato — etapa perdida)
  → DINOv2-small no navegador (WebGPU/WASM), token CLS, 384 dims, L2-normalizado
  → searchByVectorV2 (servidor) com 1 vetor, peso 1
  → RPC match_pieces_v2: HNSW cosseno, limit = pool (até 80)
     ↳ AQUI o banco devolve no máximo 40 (ef_search=40); com categoria, ~0
  → similaridade = 1 - distância de cosseno (sem threshold)
  → ranking: fusão RRF (irrelevante com 1 vetor) → ordena por score
  → filtro: 1 resultado por product_code
  → corta em 36/48/60 → tela (nunca chega a 48/60)
```

Indexação do catálogo: `nextReindexBatch` pega peças com `embedding_v2` nulo → gera link temporário da foto → navegador baixa e calcula o vetor com o mesmo motor → `saveVectorsV2` grava em lote via RPC. Fotos novas cadastradas no Admin já entram com o vetor calculado no navegador.

## PLANO DE CORREÇÃO (não implementado)

**A. Resultados 36/48/60 (corrige o efeito mais visível)**
1. Definir `hnsw.ef_search` por consulta dentro de `match_pieces_v2` (ex.: `ef_search` ≈ 4x o número pedido, com piso de 200) e habilitar varredura iterativa do índice, para o filtro de categoria não zerar o resultado.
2. Aumentar o `pool` em `searchByVectorV2` de 80 para ~4x o limite pedido, para sobrar margem depois da deduplicação por produto.
3. Preencher a cota: se após a deduplicação sobrarem menos linhas que o pedido, buscar mais candidatos até completar 36/48/60.

**B. Precisão (recupera o que o pipeline antigo tinha)**
4. Voltar a usar `normalizeForShapeSearch` na foto do usuário e enviar **dois vetores** (original peso 1,0 + normalizado peso ~1,35), como no sistema antigo, com fusão de rankings.
5. Gerar também um vetor normalizado do catálogo (segunda coluna `embedding_v2_shape`) e comparar normalizado↔normalizado — é o que realmente elimina fundo, sombra e brilho da comparação peça bruta × peça folheada. Reindexação adicional roda aqui no meu ambiente, sem custo e sem sua aba aberta.
6. Medir antes/depois com um teste objetivo (amostra de peças reais, taxa de acerto na 1ª posição e no top-5) para confirmar o ganho em vez de supor.

**C. Opcional, se B não bastar**
7. Testar o DINOv2 `base` (768 dims) no lugar do `small` e comparar precisão × tempo de download no celular.

Ordem sugerida: A (rápido, resolve quantidade e busca por categoria) → B4 → medição → B5 → C se necessário.
