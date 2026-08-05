import { createFileRoute, Outlet, redirect, Link, useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyRole } from "@/lib/pieces.functions";
import { getMyApprovalStatus } from "@/lib/approvals.functions";
import { LogOut, Search, ShieldCheck, ArrowUp, Sun, Moon, Menu, X } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { useTheme } from "@/hooks/use-theme";
import { usePendingApprovalsNotifier } from "@/hooks/use-pending-approvals";
import logoJr from "@/assets/marca-jr-joias.png";




export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const { user } = Route.useRouteContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const roleFn = useServerFn(getMyRole);
  const statusFn = useServerFn(getMyApprovalStatus);

  const { data: approval, isLoading: approvalLoading } = useQuery({
    queryKey: ["my-approval", user.id],
    queryFn: () => statusFn(),
    staleTime: 30_000,
  });

  const { data: roleInfo } = useQuery({
    queryKey: ["my-role", user.id],
    queryFn: () => roleFn(),
    staleTime: 60_000,
    enabled: approval?.status === "approved",
  });

  // Block non-approved users: sign out and send back to /auth
  useEffect(() => {
    if (!approval) return;
    if (approval.status === "approved") return;
    (async () => {
      await queryClient.cancelQueries();
      queryClient.clear();
      await supabase.auth.signOut();
      const msg =
        approval.status === "pending"
          ? "Seu cadastro está aguardando aprovação do administrador."
          : "Seu acesso foi negado. Entre em contato com o administrador.";
      toast.error(msg, { duration: 6000 });
      router.navigate({ to: "/auth", replace: true });
    })();
  }, [approval, queryClient, router]);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  }

  if (approvalLoading || !approval || approval.status !== "approved") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-sm text-muted-foreground">Verificando acesso...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader isAdmin={!!roleInfo?.isAdmin} onSignOut={signOut} />
      <main className="flex-1">
        <Outlet />
      </main>
      <ScrollToTop />
    </div>
  );
}

function SiteHeader({ isAdmin, onSignOut }: { isAdmin: boolean; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const { data: pending } = usePendingApprovalsNotifier(isAdmin);
  const pendingCount = pending?.count ?? 0;

  const navLinkClass =
    "text-[13px] uppercase tracking-[0.14em] text-white/85 hover:text-[#d8b25f] transition-colors data-[status=active]:text-[#d8b25f]";


  return (
    <header className="sticky top-0 z-30">
      {/* Barra de contato */}
      <div className="hidden md:block bg-[#f1eeec]">
        <div className="mx-auto max-w-6xl px-6 py-2 text-center md:text-left">
          <span className="text-[12px] font-medium tracking-wide text-[#2b2b2b]">
            sac@jrjoiasfolheadas.com.br | (88) 4141-0019
          </span>
        </div>
      </div>

      {/* Barra principal preta */}
      <div className="bg-black">
        <div className="mx-auto max-w-6xl px-4 md:px-6">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-2.5 md:flex md:justify-between md:py-3">
            <Link to="/consulta" className="flex min-w-0 items-center" aria-label="JR Joias Folheadas">
              <img
                src={logoJr}
                alt="JR Joias Folheadas"
                className="h-11 w-auto shrink-0 md:h-14"
              />
            </Link>

            {/* Navegação desktop */}
            <nav className="hidden md:flex items-center gap-5">
              <Link to="/consulta" className={navLinkClass} activeProps={{ "data-status": "active" }}>
                Consulta
              </Link>
              {isAdmin && (
                <>
                  <span className="h-1 w-1 rounded-full bg-[#d8b25f]/70" aria-hidden />
                  <Link to="/admin" className={navLinkClass} activeProps={{ "data-status": "active" }}>
                    Admin
                  </Link>
                </>
              )}
            </nav>

            <div className="hidden md:flex items-center gap-3">
              <ThemeToggle />
              <button
                onClick={onSignOut}
                className="rounded-full border border-[#d8b25f] px-6 py-2.5 text-[12px] font-medium uppercase tracking-[0.14em] text-[#d8b25f] transition hover:bg-[#d8b25f] hover:text-black"
              >
                Sair
              </button>
            </div>

            {/* Hambúrguer mobile */}
            <button
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? "Fechar menu" : "Abrir menu"}
              aria-expanded={open}
              className="md:hidden shrink-0 rounded-md p-2 text-[#d8b25f] transition hover:bg-white/5"
            >
              {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>

        {open && (
          <nav className="md:hidden border-t border-[#d8b25f]/25 bg-black px-4 pb-4 pt-2">
            <Link
              to="/consulta"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 py-3 text-[13px] uppercase tracking-[0.14em] text-white/85 data-[status=active]:text-[#d8b25f]"
              activeProps={{ "data-status": "active" }}
            >
              <Search className="h-4 w-4" /> Consulta
            </Link>
            {isAdmin && (
              <Link
                to="/admin"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 border-t border-white/10 py-3 text-[13px] uppercase tracking-[0.14em] text-white/85 data-[status=active]:text-[#d8b25f]"
                activeProps={{ "data-status": "active" }}
              >
                <ShieldCheck className="h-4 w-4" /> Admin
              </Link>
            )}
            <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-3">
              <ThemeToggle />
              <button
                onClick={() => {
                  setOpen(false);
                  onSignOut();
                }}
                className="flex items-center gap-2 rounded-full border border-[#d8b25f] px-5 py-2.5 text-[12px] font-medium uppercase tracking-[0.14em] text-[#d8b25f]"
              >
                <LogOut className="h-4 w-4" /> Sair
              </button>
            </div>
          </nav>
        )}
      </div>
    </header>
  );
}


function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 200);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Voltar ao topo"
      className="fixed bottom-6 right-6 z-40 rounded-full gold-gradient p-3 shadow-lg shadow-black/30 text-primary-foreground hover:scale-105 transition"
    >
      <ArrowUp className="h-5 w-5" />
    </button>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      onClick={toggle}
      aria-label={isDark ? "Ativar tema claro" : "Ativar tema escuro"}
      title={isDark ? "Tema claro" : "Tema escuro"}
      className="flex items-center justify-center rounded-full p-2 text-white/80 transition hover:bg-white/10 hover:text-[#d8b25f]"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

