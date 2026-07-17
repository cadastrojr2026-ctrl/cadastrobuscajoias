import { createFileRoute, Outlet, redirect, Link, useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyRole } from "@/lib/pieces.functions";
import { LogOut, Search, ShieldCheck } from "lucide-react";

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
  const { data: roleInfo } = useQuery({
    queryKey: ["my-role", user.id],
    queryFn: () => roleFn(),
    staleTime: 60_000,
  });

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
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
    </div>
  );
}
