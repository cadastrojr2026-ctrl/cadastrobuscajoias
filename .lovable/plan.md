# Aviso no WhatsApp quando alguém pedir acesso

Objetivo: sempre que um novo usuário se cadastrar e ficar com status "Pendente", enviar automaticamente uma mensagem de WhatsApp para **+55 88 98857-7286** com o e-mail de quem pediu acesso e um link para o painel de aprovações.

## O que muda

1. Quando o cadastro cria a linha de aprovação pendente (fluxo já existente em `ensureMyApproval`), o app dispara a notificação.
2. A notificação é enviada uma única vez por usuário (marcador de "já notificado"), para não repetir a cada login.
3. Se o envio falhar, o cadastro continua funcionando normalmente e o erro fica registrado nos logs — o acesso nunca fica travado por causa da notificação.
4. Nada muda na interface, na busca ou no catálogo.

Mensagem enviada:

```text
JR Joias - Novo pedido de acesso
E-mail: usuario@exemplo.com
Data: 04/08/2026 15:40
Aprovar em: /admin
```

## O que você precisa fornecer

O WhatsApp não permite envio automático sem uma conta de provedor aprovada. O caminho mais direto é o **Twilio** (conector já disponível no Lovable):

- Criar/usar uma conta Twilio e ativar o WhatsApp Sender (o sandbox do Twilio já funciona para testes; para uso definitivo é preciso um número aprovado pelo WhatsApp).
- Conectar o Twilio pelo próprio chat (eu abro o cartão de conexão) e informar o número remetente do WhatsApp.

Sem essa conexão, a alternativa é voltar ao aviso por e-mail (que exige domínio de envio configurado).

## Detalhes técnicos

- Nova função em `src/lib/notify.functions.ts` (ou helper server-only) que chama a API do Twilio via connector gateway (`POST /Messages.json`, `From: whatsapp:<remetente>`, `To: whatsapp:+5588988577286`, corpo `x-www-form-urlencoded`).
- `ensureMyApproval` em `src/lib/approvals.functions.ts` passa a chamar a notificação apenas quando insere uma nova linha pendente.
- Coluna nova `notified_at` (timestamptz) em `user_approvals` via migração, usada como controle de idempotência.
- Erros do provedor são logados com status + corpo da resposta, sem interromper o fluxo de cadastro.
