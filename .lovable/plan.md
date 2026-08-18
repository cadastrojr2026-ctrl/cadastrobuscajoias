# Teste A/B (embedding_v2_shape) — PAUSADO

Status: **PAUSADO** (18/08/2026), a pedido do usuário.

## Motivo da pausa

O usuário optou por fazer primeiro uma validação manual da qualidade da busca visual com fotos reais (peças brutas tiradas por celular vs. peças folheadas do catálogo). Caso sejam identificados problemas relevantes de precisão, o teste A/B será retomado posteriormente.

## O que NÃO deve ser feito enquanto estiver pausado

- Não implementar a Fase 2.
- Não gerar os 300 vetores de `embedding_v2_shape`.
- Não criar a tabela temporária `ab_shape_vectors`.
- Não fazer nenhuma reindexação.
- Não alterar nenhum código ou banco de produção.
- Não tocar em `embedding_v2`, índice HNSW, DINO, configuração de recuperação, tabela `pieces` ou produção.

## Estado preservado

- Fase 1 (correção de quantidade e recuperação): **ativa e validada**.
- `embedding_v2` + índice HNSW + DINO: **inalterados**.
- Pipeline de busca atual (`match_pieces_v2` + fusão RRF + dedup por `product_code`): **inalterado**.

## Plano aprovado (referência)

O plano técnico completo do teste A/B foi aprovado e está arquivado em:
`.lovable/plan/plano-de-teste-a-b-precisão-visual-embedding-v2-vs-embedding-2026-08-18.md`

## Retomada

Retomar somente quando o usuário solicitar explicitamente, após a validação manual. Antes de retomar, confirmar novamente:
1. Disponibilidade das ~40 fotos reais de peças brutas pareadas com o `product_code` da peça folheada.
2. Autorização para criar a tabela temporária isolada `ab_shape_vectors` e gerar vetores de forma apenas para as 300 peças da amostra.
