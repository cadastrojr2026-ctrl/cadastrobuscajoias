// Server-only helpers to notify the admin about new access requests.
// WhatsApp delivery via Twilio (connector gateway).

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";

// Admin WhatsApp number that receives the notifications.
const ADMIN_WHATSAPP_TO = "+5588988577286";

// Twilio WhatsApp sender. Defaults to Twilio's sandbox sender.
function getFromNumber() {
  return process.env["TWILIO_WHATSAPP_FROM"] ?? "+14155238886";
}

export type NotifyResult = { sent: boolean; reason?: string };

export async function sendWhatsAppAccessRequest(email: string): Promise<NotifyResult> {
  const lovableApiKey = process.env["LOVABLE_API_KEY"];
  const twilioKey = process.env["TWILIO_API_KEY"];

  if (!lovableApiKey || !twilioKey) {
    const reason = "Twilio nao conectado (TWILIO_API_KEY/LOVABLE_API_KEY ausente)";
    console.error(`[notify] ${reason}`);
    return { sent: false, reason };
  }

  const when = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const body = [
    "JR Joias - Novo pedido de acesso",
    `E-mail: ${email || "(sem e-mail)"}`,
    `Data: ${when}`,
    "Aprovar no painel Admin do app.",
  ].join("\n");

  try {
    const response = await fetch(`${GATEWAY_URL}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "X-Connection-Api-Key": twilioKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: `whatsapp:${ADMIN_WHATSAPP_TO}`,
        From: `whatsapp:${getFromNumber()}`,
        Body: body,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      const reason = `Twilio respondeu ${response.status}: ${errorBody}`;
      console.error(`[notify] ${reason}`);
      return { sent: false, reason };
    }

    return { sent: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[notify] falha ao enviar WhatsApp: ${reason}`);
    return { sent: false, reason };
  }
}
