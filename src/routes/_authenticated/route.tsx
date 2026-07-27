import { createFileRoute, Outlet, redirect, Link, useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyRole } from "@/lib/pieces.functions";
import { getMyApprovalStatus } from "@/lib/approvals.functions";
import { LogOut, Search, ShieldCheck, ArrowUp, Sun, Moon } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { useTheme } from "@/hooks/use-theme";


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
      <header className="border-b border-border/60 backdrop-blur bg-background/70 sticky top-0 z-30">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between gap-4">
          <Link to="/consulta" className="serif text-lg gold-text tracking-wide">
            JR Joias Folheadas
          </Link>
          <nav className="flex items-center gap-1">
            <Link
              to="/consulta"
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-card transition data-[status=active]:bg-card data-[status=active]:text-[color:var(--gold)]"
              activeProps={{ "data-status": "active" }}
            >
              <Search className="h-4 w-4" /> Consulta
            </Link>
            {roleInfo?.isAdmin && (
              <Link
                to="/admin"
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-card transition"
                activeProps={{ "data-status": "active" }}
              >
                <ShieldCheck className="h-4 w-4" /> Admin
              </Link>
            )}
            <button
              onClick={signOut}
              className="ml-2 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-destructive transition"
            >
              <LogOut className="h-4 w-4" /> Sair
            </button>
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <ScrollToTop />
    </div>
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
