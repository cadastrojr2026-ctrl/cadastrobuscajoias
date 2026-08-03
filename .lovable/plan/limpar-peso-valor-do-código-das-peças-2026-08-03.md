# Limpar peso/valor do código das peças

Muitos códigos vieram do nome do arquivo com o peso no final (a parte circulada em vermelho), por exemplo `PGD00622_-_(4,85)`. Vou remover essa parte e deixar só o código do produto (`PGD00622`).

## O que será removido

Somente o trecho de peso/valor numérico junto com o separador `-`/`_`:

```text
PGD00622_-_(4,85)          ->  PGD00622
GAD00339-23,55             ->  GAD00339
PGD01073_-_7,95            ->  PGD01073
PGD00434_-_(VP1558)_-_(3,50) -> PGD00434_-_(VP1558)
```

## O que NÃO será mexido

Sufixos que têm significado ficam como estão:

- `_(2)`, `_(1)` — segunda/terceira foto do mesmo produto
- `_(6MM)`, `_(11MM)` — variação de tamanho
- `_(ADEMAR)`, `_(PEQUENA)`, `_(PGD00094)` — referências internas

## Números levantados

- Peças com peso no código: **1.065**
- Casos em que o código limpo já existe em outra peça: **83**
- Nenhum código ficaria vazio após a limpeza

Para os 83 casos de conflito, a peça renomeada recebe um sufixo de foto (`_(2)`, `_(3)`, ...) e passa a apontar para o mesmo produto da peça original, para a busca continuar mostrando apenas uma ocorrência por produto.

## Como será feito

1. Uma rotina administrativa (server function) faz a limpeza em lote:
   - calcula o código novo de cada peça afetada;
   - renomeia o arquivo da imagem no armazenamento para o novo código;
   - atualiza `code` e `product_code` na tabela `pieces`;
   - o embedding é preservado — a busca por imagem não é afetada.
2. Erros individuais são registrados e não interrompem o restante do lote.
3. No painel Admin, um bloco "Limpar peso do código" com dois botões:
   - **Pré-visualizar**: lista quantas peças serão alteradas e amostra de antes/depois;
   - **Aplicar**: executa em blocos, com barra de progresso e relatório final (renomeadas, conflitos resolvidos, erros).

## Detalhes técnicos

- Nova função em `src/lib/pieces.functions.ts` (ou `src/lib/index-sync.functions.ts`): `previewCodeCleanup` e `applyCodeCleanup({ limit })`, ambas com `requireSupabaseAuth` + verificação de `has_role(admin)`.
- Regex aplicada no servidor: remove `[ _]*-[ _]*\(?\d+([.,]\d+)?\)?` e limpa separadores nas pontas.
- Reaproveita a lógica de mover arquivo do `renamePiece` (storage `move` + update).
- Processamento em blocos (ex.: 200 por chamada) para não estourar tempo de execução.
