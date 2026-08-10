# Eliminar dependência de créditos da IA Gateway

## Contexto

O app consome créditos do Lovable em duas frentes:
- **AI Gateway**: geração de embeddings para busca por imagem e cadastro de peças
- **Cloud (Supabase)**: banco de dados, armazenamento de imagens, autenticação

A importação em massa de ~10.000 peças (já concluída) consumiu muitos créditos de IA.
Para o uso diário, a franquia gratuita mensal do Cloud (40 créditos/mês) é suficiente.
O gargalo restante é a busca por imagem, que depende da AI Gateway para gerar embeddings.

## Solução

Trocar a chamada de embeddings da Lovable AI Gateway por uma chamada direta à
**API gratuita do Google AI Studio** (mesmo modelo `gemini-embedding-2`).

### O que muda

1. **Você (uma única vez)**: obter uma chave de API gratuita em https://aistudio.google.com
   - Criar uma conta Google (se não tiver)
   - Gerar uma API key (gratuita)
   - Me enviar a chave (ou adicioná-la via Settings > Secrets)

2. **Código — adaptar a função `embedImage`** em 2 arquivos:
   - `src/lib/pieces.functions.ts` (busca por imagem + cadastro de peças)
   - `src/lib/embed.server.ts` (sincronização do índice)

   A mudança troca:
   - **Endpoint**: de `ai.gateway.lovable.dev/v1/embeddings` para
     `generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent`
   - **Autenticação**: de `LOVABLE_API_KEY` (Bearer) para `GOOGLE_AI_API_KEY` (query param)
   - **Formato do request**: de OpenAI-compatible para o formato nativo do Google
     (content.parts com text + inlineData)
   - **Formato do response**: de `data[0].embedding` para `embedding.values`

3. **Nenhum impacto no banco de dados**: os embeddings existentes continuam válidos
   (mesmo modelo, mesma dimensão 3072). Nenhuma reindexação é necessária.

### O que NÃO muda

- A interface do app (nenhuma alteração visual)
- O banco de dados e as peças já cadastradas
- A busca por texto (não usa embeddings)
- O login e autenticação
- Os favoritos
- A lógica de fusão de rankings (RRF)

### Resultado

| Recurso | Antes | Depois |
|---------|-------|--------|
| Busca por imagem | Consome créditos IA | Grátis (Google free tier) |
| Cadastrar peça | Consome créditos IA | Grátis (Google free tier) |
| Sincronizar índice | Consome créditos IA | Grátis (Google free tier) |
| Busca por texto | Cloud (franquia gratuita) | Igual |
| Login / Auth | Cloud (franquia gratuita) | Igual |
| Banco de dados | Cloud (franquia gratuita) | Igual |

Após a mudança, o app dependerá apenas da franquia gratuita mensal do Cloud
(40 créditos/mês no plano Free/Pro), que cobre o uso diário normal.

### Limites do Google free tier

- ~1.500 requisições por minuto (RPM)
- ~1.500 requisições por dia (RPD) para alguns modelos
- Suficiente para uso normal do app (buscas e cadastros ocasionais)

### Passos de implementação

1. Você gera a chave em aistudio.google.com e me envia
2. Eu adiciono a chave como secret (`GOOGLE_AI_API_KEY`) no projeto
3. Eu modifico a função `embedImage` nos 2 arquivos para usar a API do Google
4. Eu testo uma busca por imagem para confirmar que funciona
5. Publicamos

### Nota sobre Cloud

Se mesmo a franquia gratuita do Cloud não for suficiente no futuro, a única
alternativa seria migrar o banco para uma instância Supabase externa (fora do
Lovable Cloud). Isso é possível mas envolve migração de dados, configuração de
RLS, storage e auth — uma mudança muito maior. Para o uso atual, a franquia
gratuita deve ser suficiente.
