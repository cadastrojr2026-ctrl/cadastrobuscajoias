import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles, Search, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        window.location.replace("/consulta");
      } else {
        setChecking(false);
      }
    });
  }, []);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="serif text-2xl gold-text">JR Joias Folheadas</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 py-5 flex items-center justify-between">
        <div className="serif text-xl gold-text tracking-wide">JR Joias Folheadas</div>
        <Link
          to="/auth"
          className="rounded-md border border-[color:var(--gold)]/40 px-4 py-2 text-sm text-[color:var(--gold)] hover:bg-[color:var(--gold)]/10 transition"
        >
          Entrar
        </Link>
      </header>

      <main className="flex-1 flex items-center px-6">
        <div className="mx-auto max-w-3xl text-center py-16">
          <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--gold)]/30 px-4 py-1.5 text-xs text-[color:var(--gold)] mb-8">
            <Sparkles className="h-3.5 w-3.5" />
            Cadastro & Consulta de Peças
          </div>
          <h1 className="serif text-5xl md:text-7xl leading-tight">
            <span className="gold-text">JR Joias</span>
            <br />
            <span className="text-foreground">Folheadas</span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-xl mx-auto">
            Encontre qualquer peça do catálogo em segundos — envie uma foto ou digite o código.
          </p>
          <div className="mt-10 flex justify-center gap-3">
            <Link
              to="/auth"
              className="rounded-md gold-gradient px-8 py-3 text-sm font-medium text-primary-foreground shadow-lg shadow-[color:var(--gold)]/20 hover:opacity-90 transition"
            >
              Entrar no catálogo
            </Link>
          </div>

          <div className="mt-20 grid md:grid-cols-3 gap-4 text-left">
            {[
              { icon: Search, title: "Busca por código", desc: "Digite o SKU e encontre a peça exata." },
              { icon: Sparkles, title: "Busca por foto", desc: "Envie uma foto e veja peças visualmente similares." },
              { icon: ShieldCheck, title: "Área do administrador", desc: "Cadastre e gerencie peças com upload de imagens." },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-lg border border-border bg-card/40 p-5">
                <Icon className="h-5 w-5 text-[color:var(--gold)] mb-3" />
                <div className="font-medium">{title}</div>
                <div className="text-sm text-muted-foreground mt-1">{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </main>

      <footer className="px-6 py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} JR Joias Folheadas
      </footer>
    </div>
  );
}
