/**
 * Middleware que estende requireSupabaseAuth com a checagem real de
 * aprovação (user_approvals.status = 'approved') no SERVIDOR.
 *
 * Por que este arquivo existe: requireSupabaseAuth (auth-middleware.ts,
 * autogerado — não editamos esse arquivo diretamente) garante só que existe
 * uma sessão Supabase válida. A aprovação de usuários (pending/approved/
 * rejected) sempre foi checada só no React (src/routes/auth.tsx e
 * src/routes/_authenticated/route.tsx) — um usuário `pending` recém-cadastrado
 * já recebe um token válido e, antes deste middleware, conseguia chamar
 * qualquer Server Function que só exigisse requireSupabaseAuth, pulando a
 * tela de "aguardando aprovação".
 *
 * Use requireApprovedUser no lugar de requireSupabaseAuth em toda Server
 * Function que deve ficar bloqueada para quem não está aprovado — ou seja,
 * em todas, EXCETO ensureMyApproval e getMyApprovalStatus (que precisam
 * continuar acessíveis antes da aprovação, é assim que o app descobre e
 * comunica o status "pending" para a pessoa).
 */
import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "./auth-middleware";

export const requireApprovedUser = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ context, next }) => {
    const { data, error } = await context.supabase
      .from("user_approvals")
      .select("status")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data?.status !== "approved") {
      throw new Error("Unauthorized: conta ainda não aprovada.");
    }
    return next();
  });
