# Reindexação mais rápida

Sim: a consulta por imagem volta ao normal para cada peça já reindexada. Hoje estão **560 de 21.376** peças com o novo vetor — por isso a busca parece fraca/lenta ainda.

O motivo da lentidão é como o processo está montado hoje: lotes pequenos (20), uma foto por vez, gravação peça por peça no banco e tudo dependendo da sua aba aberta.

## O que vou fazer

1. **Reindexar o catálogo inteiro daqui do meu ambiente** (não gasta créditos, não precisa da sua aba aberta). Rodo em vários processos paralelos e concluo as 20.816 peças restantes em background.
2. **Deixar o painel do Admin muito mais rápido** para o uso futuro (fotos novas):
   - lotes de 50 em vez de 20;
   - já baixar/decodificar o próximo lote enquanto o atual é processado (pipeline, sem tempo morto);
   - gravar o lote inteiro numa única chamada ao banco em vez de uma por peça;
   - permitir rodar em mais de uma aba/computador ao mesmo tempo sem processar a mesma peça duas vezes.
3. **Fotos novas já entram indexadas** no cadastro, sem precisar de reindexação depois.

## Detalhes técnicos

- Script de reindexação em Node no sandbox usando `@huggingface/transformers` com o mesmo modelo (`dinov2-with-registers-small`, token CLS, 384 dims normalizado) — vetores idênticos aos gerados no navegador.
- Escrita em massa via nova função RPC `save_vectors_v2(jsonb)` (um único `update ... from jsonb_to_recordset`), substituindo o loop de `update` em `saveVectorsV2`.
- `nextReindexBatch`: adicionar `order by created_at` + `offset` aleatório/por worker e reserva simples para evitar colisão entre abas.
- `src/components/reindex-panel.tsx`: pipeline com prefetch do próximo lote e concorrência controlada no decode das imagens.
- Progresso continua vindo de `index_v2_stats`, então a barra do Admin mostra o avanço do meu processamento em tempo real.

Nada muda no visual do app, no índice antigo (mantido como backup), em favoritos, login ou admin.
