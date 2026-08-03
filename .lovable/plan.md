## O que eu encontrei

Reverter o código **não resolveria** o problema: as 696 peças novas estão no banco e no armazenamento, e o revert só volta o código (o sistema de sincronização também sairia, sem apagar nada do banco).

A causa real está nos embeddings. Verifiquei no banco:

- Lote novo de pingentes (03/08): 696 peças, todas com embedding de 3072 dimensões e imagem presente no armazenamento.
- Ao buscar os vizinhos mais próximos de um pingente **novo**, aparecem **só peças do lote novo** (similaridade 0,96–0,97 entre elas).
- Ao buscar os vizinhos de um pingente **antigo**, aparecem **só peças do lote antigo**.

Ou seja: cada lote de importação usou um texto de instrução diferente ao gerar o embedding, e esse texto passou a dominar o vetor. O resultado é que cada lote forma um "grupo isolado". A busca do app usa o texto oficial (foco em geometria), então o lote novo cai numa região distante e praticamente nunca aparece nos resultados.

## Plano (conforme sua escolha: remover o lote novo)

1. Apagar do armazenamento os arquivos das 696 peças de pingente criadas em 03/08/2026.
2. Apagar essas 696 linhas da tabela de peças (inclui embeddings e qualquer favorito ligado a elas).
3. Rodar a verificação de integridade do índice e confirmar que o restante do catálogo continua 100% indexado.
4. Relatório final: quantidade removida, embeddings removidos, erros e status.

Nada é alterado na interface nem na estrutura do banco.

## Importante para a próxima importação

Se você reenviar esses pingentes, eu importo usando **exatamente o mesmo texto de instrução da busca do app** (`SHAPE_HINT`), para que os vetores fiquem comparáveis com o resto do catálogo. Sem isso, o mesmo problema volta a acontecer.

Observação adicional: os nomes dos arquivos vinham com preço/peso (ex. `PGD00013_-_(6,78)`), o que virou código da peça. Na reimportação eu limpo isso e uso só o código (`PGD00013`).

## Fica para depois (se você quiser)

Os lotes antigos também foram importados com textos ligeiramente diferentes entre si, o que reduz a precisão geral entre categorias. A correção definitiva é reindexar o catálogo com um único texto padrão — isso consome créditos de IA por imagem, então só faço se você pedir.
