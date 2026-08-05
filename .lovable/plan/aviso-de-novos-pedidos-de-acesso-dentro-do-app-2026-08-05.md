# Aviso de novos pedidos de acesso dentro do app

Sim, dá para fazer sem nenhum serviço externo: o aviso aparece dentro do próprio app, para quem é administrador.

## O que você vai ver

1. **Selo no menu "Admin"** (topo do site): sempre que houver cadastros aguardando aprovação, aparece uma bolinha dourada com o número de pendentes, em qualquer página.
2. **Aviso na tela**: quando chegar um pedido novo enquanto você está usando o app, aparece uma notificação no canto ("Novo pedido de acesso: email@exemplo.com") com um atalho para abrir as aprovações.
3. **Atualização automática**: a contagem é verificada a cada 60 segundos e ao voltar para a aba, sem precisar recarregar a página.
4. No painel Admin, o bloco "Aprovações de acesso" continua igual, já mostrando a lista e os botões Aprovar/Rejeitar.

Nada disso muda a busca, o catálogo ou o layout geral — só acrescenta o selo e o aviso.

## Observação

O aviso só aparece enquanto você estiver com o app aberto e logado como administrador. Se quiser receber quando estiver fora do app (WhatsApp/e-mail), isso exigiria o serviço externo que decidimos não usar.

## Detalhes técnicos

- Nova função `countPendingApprovals` em `src/lib/approvals.functions.ts` (protegida, verifica `has_role` admin) retornando quantidade e o e-mail/data do pedido mais recente.
- Novo hook `src/hooks/use-pending-approvals.tsx`: `useQuery` com `refetchInterval: 60_000` e `refetchOnWindowFocus`, habilitado apenas quando `isAdmin`.
- `src/routes/_authenticated/route.tsx`: selo com a contagem ao lado do link "Admin" (desktop e menu mobile) e `toast` (sonner) quando a contagem aumenta em relação ao valor anterior, com ação "Ver" navegando para `/admin`.
- `src/routes/_authenticated/admin.tsx`: reaproveita o mesmo hook para o contador de pendentes já existente, evitando busca duplicada.
- Sem migração de banco e sem novas dependências.
