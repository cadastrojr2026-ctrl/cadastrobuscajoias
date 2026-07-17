## Problema

No celular, ao tocar em "Enviar foto para busca visual", o Android/Samsung abre direto a galeria em vez de dar a opção de câmera. Isso acontece porque o input hoje é:

```tsx
<input type="file" accept="image/*" />
```

Sem o atributo `capture`, muitos navegadores mobile (incluindo o padrão do Samsung) pulam o seletor e vão direto para "Arquivos/Galeria". Não é configuração do seu celular — é ajuste no app.

## Solução

Dar ao usuário as duas opções explícitas, em vez de um botão só:

1. **Tirar foto agora** → abre a câmera direto (`capture="environment"`)
2. **Escolher da galeria** → abre arquivos/galeria (sem `capture`)

No desktop, o botão "Tirar foto" simplesmente não aparece (detectado via `useIsMobile`), mantendo a UI limpa.

## Alterações

- `src/routes/_authenticated/consulta.tsx`:
  - Adicionar um segundo `<input type="file" accept="image/*" capture="environment" />` (câmera).
  - Trocar o botão único por dois botões lado a lado no mobile: "Tirar foto" e "Da galeria".
  - No desktop, mostrar só "Enviar foto para busca visual" como hoje.
  - Reaproveitar a função `doImageSearch` já existente — nenhuma mudança em lógica de busca, embeddings ou backend.

Nada muda no servidor, banco ou permissões.
