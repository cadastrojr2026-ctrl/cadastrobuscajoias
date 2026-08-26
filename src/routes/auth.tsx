import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { ensureMyApproval, getMyApprovalStatus } from "@/lib/approvals.functions";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const ensureFn = useServerFn(ensureMyApproval);
  const statusFn = useServerFn(getMyApprovalStatus);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      // Check approval before redirecting
      try {
        const s = await statusFn();
        if (s.status === "approved") {
          navigate({ to: "/consulta", replace: true });
        } else {
          await supabase.auth.signOut();
          toast.error(
            s.status === "pending"
              ? "Seu cadastro está aguardando aprovação do administrador."
              : "Seu acesso foi negado.",
            { duration: 6000 },
          );
        }
      } catch {
        // ignore
      }
    });
  }, [navigate, statusFn]);

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        // Make sure an approval row exists (in case the auth trigger did not run)
        try {
          await ensureFn();
        } catch {
          // ignore — the admin will still be able to see the user
        }
        // Se o projeto exige confirmação de e-mail, o Supabase não retorna
        // sessão nenhuma aqui (data.session é null) — nesse caso não há
        // nada pra deslogar, e o aviso precisa deixar claro o passo extra.
        if (data.session) {
          await supabase.auth.signOut();
          toast.success(
            "Cadastro enviado! Aguarde a aprovação do administrador para acessar.",
            { duration: 8000 },
          );
        } else {
          toast.success(
            "Cadastro enviado! Confirme seu e-mail (verifique a caixa de entrada e o spam) e, depois, aguarde a aprovação do administrador.",
            { duration: 10000 },
          );
        }
        setMode("signin");
        setPassword("");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          const code = (error as { code?: string }).code;
          if (code === "email_not_confirmed" || /email not confirmed/i.test(error.message)) {
            toast.error(
              "Confirme seu e-mail antes de entrar — verifique sua caixa de entrada (e o spam).",
              { duration: 8000 },
            );
            return;
          }
          throw error;
        }
        // Gate on approval
        const s = await statusFn();
        if (s.status !== "approved") {
          await supabase.auth.signOut();
          toast.error(
            s.status === "pending"
              ? "Seu cadastro ainda está aguardando aprovação do administrador."
              : "Seu acesso foi negado. Fale com o administrador.",
            { duration: 8000 },
          );
          return;
        }
        navigate({ to: "/consulta", replace: true });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao autenticar.";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      // Mensagem neutra de propósito: não revela se o e-mail existe ou não na base.
      toast.success(
        "Se esse e-mail estiver cadastrado, enviamos um link para redefinir a senha.",
        { duration: 8000 },
      );
      setMode("signin");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar o link de redefinição.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) throw result.error;
      if (result.redirected) return;
      // Ensure approval row (Google first-time sign-in) then gate
      try {
        await ensureFn();
      } catch {
        // ignore
      }
      const s = await statusFn();
      if (s.status !== "approved") {
        await supabase.auth.signOut();
        toast.error(
          s.status === "pending"
            ? "Seu cadastro está aguardando aprovação do administrador."
            : "Seu acesso foi negado.",
          { duration: 8000 },
        );
        return;
      }
      navigate({ to: "/consulta", replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro no Google.";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="serif text-4xl gold-text">JR Joias Folheadas</h1>
          <p className="text-sm text-muted-foreground mt-2">
            {mode === "signin" ? "Acesse sua conta" : mode === "signup" ? "Crie sua conta" : "Redefinir senha"}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card/60 backdrop-blur p-6 space-y-4">
          {mode !== "forgot" && (
            <>
              <button
                onClick={handleGoogle}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 rounded-md border border-border bg-background/40 py-2.5 text-sm hover:bg-background/70 transition disabled:opacity-50"
              >
                <svg width="16" height="16" viewBox="0 0 24 24">
                  <path fill="#EA4335" d="M12 5c1.6 0 3.1.6 4.2 1.6l3.1-3.1C17.3 1.5 14.8.5 12 .5 7.3.5 3.2 3.2 1.2 7.2l3.6 2.8C5.8 7 8.6 5 12 5z" />
                  <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.7-2.4 3.6l3.6 2.8c2.1-2 3.8-4.9 3.8-8.6z" />
                  <path fill="#FBBC05" d="M4.8 14.3c-.3-.8-.4-1.6-.4-2.3 0-.8.1-1.5.4-2.3L1.2 7C.4 8.5 0 10.2 0 12s.4 3.5 1.2 5l3.6-2.7z" />
                  <path fill="#34A853" d="M12 23.5c3.2 0 5.9-1.1 7.9-2.9l-3.6-2.8c-1 .7-2.3 1.1-4.3 1.1-3.4 0-6.2-2-7.3-4.8L1.2 17c2 4 6.1 6.5 10.8 6.5z" />
                </svg>
                {mode === "signup" ? "Cadastrar com Google" : "Entrar com Google"}
              </button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-card px-2 text-muted-foreground">ou</span>
                </div>
              </div>
            </>
          )}

          {mode === "forgot" ? (
            <form onSubmit={handleForgotPassword} className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Digite seu e-mail — se ele estiver cadastrado, enviaremos um link para você
                criar uma nova senha.
              </p>
              <div>
                <label className="text-xs text-muted-foreground">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-md bg-input border border-border px-3 py-2 text-sm focus:outline-none focus:border-[color:var(--gold)]"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-md gold-gradient py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {loading ? "Aguarde..." : "Enviar link de redefinição"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleEmail} className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-md bg-input border border-border px-3 py-2 text-sm focus:outline-none focus:border-[color:var(--gold)]"
                />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground">Senha</label>
                  {mode === "signin" && (
                    <button
                      type="button"
                      onClick={() => setMode("forgot")}
                      className="text-xs text-[color:var(--gold)] hover:underline"
                    >
                      Esqueceu a senha?
                    </button>
                  )}
                </div>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 w-full rounded-md bg-input border border-border px-3 py-2 text-sm focus:outline-none focus:border-[color:var(--gold)]"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-md gold-gradient py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {loading ? "Aguarde..." : mode === "signin" ? "Entrar" : "Criar conta"}
              </button>
            </form>
          )}

          <div className="text-center text-xs text-muted-foreground">
            {mode === "signin" && (
              <>
                Ainda não tem conta?{" "}
                <button onClick={() => setMode("signup")} className="text-[color:var(--gold)] hover:underline">
                  Criar conta
                </button>
              </>
            )}
            {mode === "signup" && (
              <>
                Já tem conta?{" "}
                <button onClick={() => setMode("signin")} className="text-[color:var(--gold)] hover:underline">
                  Entrar
                </button>
              </>
            )}
            {mode === "forgot" && (
              <button onClick={() => setMode("signin")} className="text-[color:var(--gold)] hover:underline">
                Voltar para o login
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Novos cadastros precisam ser aprovados pelo administrador antes de acessar.
        </p>
      </div>
    </div>
  );
}
