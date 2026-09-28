# Adicionar Pulseiras Grossas e Masculinas

## Objetivo
Adicionar as **250 fotos** enviadas ao catálogo na nova categoria **Pulseiras Grossas e Masculinas**, mantendo o funcionamento e o visual atuais do projeto.

## Conteúdo conferido
- `PULSEIRA_GROSSA_MASCULINA.rar`: 66 imagens
- `PULSEIRA_GROSSA_MASCULINA_-_2.rar`: 80 imagens
- `PULSEIRA_GROSSA_MASCULINA_-_3.rar`: 104 imagens
- Total: **250 imagens**
- Não há códigos repetidos entre as três pastas.

## Implementação
1. Extrair somente as imagens válidas dos três arquivos, ignorando arquivos auxiliares como `Thumbs.db`.
2. Conferir todos os códigos das fotos contra o catálogo atual antes da gravação, evitando substituir peças existentes por engano.
3. Cadastrar as imagens na nova categoria `pulseira_grossa_masculina`, com o nome visível **Pulseiras Grossas e Masculinas**.
4. Gerar automaticamente o `embedding_v2` DINOv2 de 384 dimensões para cada nova imagem, pelo fluxo local e sem consumo de créditos de IA.
5. Gravar cada imagem, seu código, categoria e vetor no fluxo existente. O índice HNSW incluirá as novas linhas automaticamente; não haverá reindexação geral.
6. Adicionar a nova categoria, em ordem alfabética, nas áreas de Consulta e Admin, usando o ícone de pulseira já existente.

## Validação
- Confirmar que 250 peças foram cadastradas, descontando somente eventuais códigos já existentes identificados na conferência completa.
- Confirmar que todas as novas peças possuem `embedding_v2`.
- Confirmar que o total do catálogo e o total da categoria estão corretos.
- Testar busca por nome/código e busca visual filtrada pela nova categoria.
- Confirmar que nenhuma peça, categoria ou vetor já existente foi alterado.

## Limites preservados
- Não implementar nem executar o teste A/B pausado.
- Não criar `embedding_v2_shape`.
- Não alterar a Fase 1, o DINO, a configuração de recuperação, o índice HNSW ou a tabela `pieces`.
- Não executar reindexação geral.
