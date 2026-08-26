import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
});

/**
 * Página de destino do link "Esqueceu a senha?" enviado por e-mail
 * (ver handleForgotPassword em src/routes/auth.tsx).
 *
 * O supabase-js detecta o token de recuperação na própria URL e já
 * estabelece uma sessão temporária automaticamente — não é preciso ler
 * nada do hash manualmente aqui. Só liberamos o formulário depois de
 * confirmar essa sessão (evento PASSWORD_RECOVERY ou sessão já presente).
 */
function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("As senhas não coincidem.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      await supabase.auth.signOut();
      toast.success("Senha redefinida! Entre novamente com a nova senha.", { duration: 6000 });
      navigate({ to: "/auth", replace: true });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao redefinir a senha.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="serif text-4xl gold-text">JR Joias Folheadas</h1>
          <p className="text-sm text-muted-foreground mt-2">Defina sua nova senha</p>
        </div>

        <div className="rounded-xl border border-border bg-card/60 backdrop-blur p-6 space-y-4">
          {!ready ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Verificando o link de redefinição...
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Nova senha</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 w-full rounded-md bg-input border border-border px-3 py-2 text-sm focus:outline-none focus:border-[color:var(--gold)]"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Confirmar nova senha</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="mt-1 w-full rounded-md bg-input border border-border px-3 py-2 text-sm focus:outline-none focus:border-[color:var(--gold)]"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-md gold-gradient py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {loading ? "Aguarde..." : "Redefinir senha"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
