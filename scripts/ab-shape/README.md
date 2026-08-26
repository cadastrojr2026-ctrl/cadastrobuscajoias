# Experimento A/B — `embedding_v2` vs `embedding_v2_shape`

Preparação local do Experimento 2 (ver `.lovable/plan/plano-de-teste-a-b-precisão-visual-embedding-v2-vs-embedding-2026-08-18.md`).

**Estado atual: só código. Nada foi executado. Nenhum dado do Supabase foi lido, gravado ou
alterado por estes scripts até agora.**

**Metodologia corrigida em 2026-08-25**: a primeira versão comparava A (`embedding_v2`) contra
o catálogo inteiro via RPC `match_pieces_v2` enquanto B (`embedding_v2_shape`) só buscava
dentro da amostra de ~300 peças — comparação injusta, apontada pelo usuário e corrigida. A
versão atual compara os dois braços contra **exatamente o mesmo universo de candidatos** (a
amostra), 100% em memória, sem nenhuma RPC.

## Isolamento (garantias)

- Nenhum arquivo dentro de `src/` foi criado ou alterado. O harness (fora de `src/`) só
  importa `normalizeForShapeSearch` e `embedImageSource` de `src/lib`, sem duplicar/reescrever
  a lógica; a transformação sintética da Modalidade B (`degradeColorContrastForTest`) vive
  inteiramente em `scripts/ab-shape/harness/perturb.ts`, também fora de `src/`.
- Nenhum script aqui usa `SUPABASE_SERVICE_ROLE_KEY`. Cada script que acessa o Supabase
  recusa-se a rodar (`process.exit(1)`) se essa variável estiver definida no ambiente —
  checagem em tempo de execução, não é só uma promessa em texto.
- Nenhum script grava nada em tabelas do Supabase. Toda saída vai para arquivos locais em
  `scripts/ab-shape/data/*.local.*` — o padrão `*.local` já está no `.gitignore` da raiz do
  projeto, então esses artefatos nunca são versionados por acidente.
- A tabela `ab_shape_vectors` **não existe** — não é criada, referenciada nem necessária. Toda
  comparação roda em memória, a partir de arquivos locais.
- `03-report-ab.mjs` **não acessa o Supabase de forma alguma** (nem leitura, nem escrita) —
  usa só os arquivos locais gerados pelos passos 1, 2 e 2b.
- Nenhum destes scripts foi executado. `bun add -D playwright` (ou `npm install`) também não
  foi executado — ver seção "Instalação" abaixo.

## O que cada script faz (quando autorizado a rodar)

### `01-select-sample.mjs` — leitura, sem escrita no Supabase
Lê a tabela `pieces` **só com `SELECT`**, usando a `anon key` pública (a mesma já embutida no
bundle do app — não é um privilégio novo). A policy `"Anyone can view pieces"` (RLS,
`using (true)`) já permite essa leitura para `anon`, então nenhuma credencial administrativa é
necessária para montar a amostra.

- Filtra `embedding_v2 is not null`.
- Agrupa por `coalesce(product_code, code)` e escolhe 1 foto por produto (a de menor `code`,
  para reprodutibilidade determinística) — evita que produtos com várias fotos dominem a
  amostra.
- Sorteia ~300 produtos, proporcional à distribuição de `category` observada no próprio
  catálogo, com seed fixa (gravada no arquivo de saída).
- Grava `data/sample.local.json`: lista de `{ piece_id, code, product_code, category,
  image_path, embedding_v2 }`.

`embedding_v2` do próprio catálogo já vem nessa leitura (a policy de SELECT libera todas as
colunas, inclusive `embedding_v2`) — é o que vira `candidatesA` no relatório final.

### `harness/` — página mínima para o Playwright, fora de `src/`
- `harness/main.ts` importa `@/lib/image-prep` e `@/lib/dino-engine` **sem alterar uma linha
  desses arquivos**, e importa `./perturb` (a transformação sintética, só do experimento).
  Expõe `window.__abShape = { normalizeForShapeSearch, embedImageSource,
  degradeColorContrastForTest }`.
- `harness/perturb.ts` — transformação sintética aprovada da Modalidade B (ver detalhes no
  passo `02b` abaixo).

Servido pelo próprio `vite dev` do projeto (o alias `@` já existe via `vite-tsconfig-paths`;
nenhuma mudança em `vite.config.ts` foi necessária). Não é uma rota do app, não é linkada de
lugar nenhum.

### `02-embed-shape.mjs` — Playwright, sem escrita no Supabase (lado catálogo)
Para cada item de `data/sample.local.json`, sobre a foto **original** (não perturbada):
1. baixa a imagem do Storage (leitura, mesma policy pública `"Anyone can view piece images"`);
2. abre `harness/index.html` num Chromium headless (Playwright);
3. roda `normalizeForShapeSearch(dataUrl)` e depois `embedImageSource(...)` — os mesmos
   arquivos-fonte do app, sem cópia/reescrita;
4. acumula `{ piece_id, vector }` e grava tudo em `data/shape-vectors.local.json` no final.

É o lado "catálogo" do braço B — vira `candidatesB` no relatório. Nunca escreve em `pieces`,
nunca cria `ab_shape_vectors`, nunca chama `service_role`.

### `02b-embed-perturbed.mjs` — Playwright, sem escrita no Supabase (lado consulta, Modalidade B)
Para cada item de `data/sample.local.json`: baixa a foto original, aplica no harness a
transformação sintética aprovada (`degradeColorContrastForTest`) e gera dois vetores de
**consulta**: `queryA = embedImageSource(perturbada)` (sem shape) e
`queryB = embedImageSource(normalizeForShapeSearch(perturbada))` (com shape). Grava
`data/perturbed-vectors.local.json`. Não escreve no Supabase.

**Transformação aprovada** (só cor/brilho/contraste — sem nenhuma alteração geométrica):
1. **Dessaturação**: HSL, saturação reduzida para 15% da original.
2. **Achatamento de brilho**: percentil 85 da luminância da própria imagem (já dessaturada);
   valores acima do P85 comprimidos exatamente para o P85, por rescala uniforme do RGB
   (preserva matiz — não redesenha nada).
3. **Redução de contraste**: mistura 70% imagem + 30% cinza médio (128,128,128).

Sem ruído (passo descartado pelo usuário). Sem resize, crop, rotação ou flip — o canvas de
trabalho tem exatamente as dimensões da imagem de entrada, e as três etapas só reescrevem
valores de cor por pixel, nunca movem/cortam/redimensionam nada (detalhes e garantia de
geometria preservada em `harness/perturb.ts`, no cabeçalho e nos comentários de cada passo).

**É um teste sintético controlado, não uma simulação de foto real de peça bruta.**

### `03-report-ab.mjs` — comparação em memória, SEM Supabase (nem leitura, nem escrita)
Os dois braços comparam, 100% em memória, contra o **mesmo universo de ~300 candidatos**:

- `candidatesA` = `embedding_v2` de cada peça da amostra (`sample.local.json`).
- `candidatesB` = `embedding_v2_shape` de cada peça da amostra, calculado sobre a foto
  **original** (`shape-vectors.local.json`).

**Modalidade A — auto-consulta (diagnóstico de sanidade, NÃO decide nada):** consulta = o
próprio vetor da peça, contra candidatos que a incluem. Por identidade matemática, ela deve
ficar em 1º lugar — isso é esperado, não é um resultado a favor de A ou B. O script registra
qualquer peça em que isso falhar (sinal de bug no pipeline), mas nunca usa esse resultado para
comparar A vs B.

**Modalidade B — consulta perturbada (produz as métricas de decisão):** consulta =
`queryA`/`queryB` de `data/perturbed-vectors.local.json`, contra os candidatos **originais**
(não perturbados). Como a consulta não é idêntica a nenhum candidato, não há domínio trivial —
o candidato correto precisa vencer por semelhança real, sobrevivendo à degradação de
cor/brilho/contraste. Gera Recall@1/5/10/36, MRR, Precision@5/10, latência de ranking e
comparação pareada (melhoria/regressão/empate), gravados em `data/report.local.md` +
`data/report.local.json`, sempre com o aviso:

> "Modalidade B utiliza uma perturbação sintética de cor/brilho/contraste para testar a
> robustez da representação visual. Os resultados não substituem o teste posterior com fotos
> reais."

Se `data/perturbed-vectors.local.json` não existir, o script aborta com uma mensagem clara em
vez de fabricar números.

**Fotos reais (~40)**: nenhum arquivo de imagens ou pareamento existe neste repositório.
Quando existirem, repetem a mesma lógica da Modalidade B (foto real em vez de perturbação
sintética) contra o mesmo catálogo de referência — não foi criada agora para não sugerir uma
estrutura de dados adivinhada sem o conjunto real em mãos.

## Instalação (NÃO executada)

```bash
# escolha o gerenciador consistente com o lockfile que você for atualizar:
bun add -D playwright        # projeto usa bun.lock como lockfile mais recente
# ou, se preferir manter só o package-lock.json:
npm install --save-dev playwright

# baixa o binário do Chromium usado pelo harness (download ~300MB, não executado):
npx playwright install chromium
```

`playwright` foi adicionado em `package.json > devDependencies` nesta etapa, mas nenhum
comando de instalação acima foi rodado — `node_modules`/lockfiles não foram tocados.

## Variáveis de ambiente esperadas (quando for autorizado a executar)

| Variável | Uso | Observação |
|---|---|---|
| `SUPABASE_URL` | `01`, `02`, `02b` | já existe em `.env` |
| `SUPABASE_PUBLISHABLE_KEY` (anon) | `01`, `02`, `02b` | já existe em `.env`; é só leitura pública |
| — | `03-report-ab.mjs` | **não usa nenhuma variável do Supabase** — roda só com os arquivos locais dos passos anteriores |
| `SUPABASE_SERVICE_ROLE_KEY` | **nenhum script usa** | se estiver definida no ambiente, os scripts abortam de propósito |

## Ordem de execução prevista (nenhuma rodada ainda)

```bash
node scripts/ab-shape/01-select-sample.mjs      # gera data/sample.local.json (leitura anon)
vite dev &                                      # necessário para servir harness/index.html
node scripts/ab-shape/02-embed-shape.mjs        # gera data/shape-vectors.local.json (catálogo, Playwright + leitura anon)
node scripts/ab-shape/02b-embed-perturbed.mjs   # gera data/perturbed-vectors.local.json (consulta perturbada, Playwright + leitura anon)
node scripts/ab-shape/03-report-ab.mjs          # gera data/report.local.md (em memória, sem Supabase)
```

Nenhum desses comandos foi executado nesta etapa — ver o pedido de autorização na conversa.
