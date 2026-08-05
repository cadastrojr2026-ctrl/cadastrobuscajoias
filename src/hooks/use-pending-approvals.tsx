import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { countPendingApprovals } from "@/lib/approvals.functions";

/** Contagem de pedidos de acesso pendentes (somente admin). */
export function usePendingApprovals(enabled: boolean) {
  const countFn = useServerFn(countPendingApprovals);
  return useQuery({
    queryKey: ["approvals", "pending-count"],
    queryFn: () => countFn(),
    enabled,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}

/** Mostra um aviso quando chegam novos pedidos de acesso. */
export function usePendingApprovalsNotifier(enabled: boolean) {
  const query = usePendingApprovals(enabled);
  const router = useRouter();
  const previous = useRef<number | null>(null);

  const count = query.data?.count ?? 0;
  const latestEmail = query.data?.latestEmail ?? null;

  useEffect(() => {
    if (!enabled || query.data === undefined) return;
    const prev = previous.current;
    previous.current = count;
    if (prev === null || count <= prev) return;
    toast.info(
      latestEmail
        ? `Novo pedido de acesso: ${latestEmail}`
        : "Novo pedido de acesso aguardando aprovação",
      {
        duration: 10000,
        action: {
          label: "Ver",
          onClick: () => router.navigate({ to: "/admin" }),
        },
      },
    );
  }, [count, latestEmail, enabled, query.data, router]);

  return query;
}
