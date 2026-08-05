import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type ApprovalStatus = "pending" | "approved" | "rejected";

// Ensure an approval row exists for the current user (safety net in case
// the auth trigger did not fire). New users get 'pending'.
export const ensureMyApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: existing } = await context.supabase
      .from("user_approvals")
      .select("status")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (existing) return { status: existing.status as ApprovalStatus };

    const email = (context.claims.email as string | undefined) ?? "";
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("user_approvals").insert({
      user_id: context.userId,
      email,
      status: "pending",
    });
    return { status: "pending" as ApprovalStatus };
  });

export const countPendingApprovals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: role } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!role) return { count: 0, latestEmail: null as string | null, latestAt: null as string | null };
    const { data, error, count } = await context.supabase
      .from("user_approvals")
      .select("email, created_at", { count: "exact" })
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const latest = data?.[0] ?? null;
    return {
      count: count ?? 0,
      latestEmail: (latest?.email ?? null) as string | null,
      latestAt: (latest?.created_at ?? null) as string | null,
    };
  });


export const getMyApprovalStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("user_approvals")
      .select("status")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { status: (data?.status ?? "pending") as ApprovalStatus };
  });

export const listApprovals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ status: z.enum(["pending", "approved", "rejected"]).optional() }).optional().parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: role } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!role) throw new Error("Apenas administradores.");
    let q = context.supabase
      .from("user_approvals")
      .select("user_id, email, status, created_at, approved_at")
      .order("created_at", { ascending: false });
    if (data?.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const setApprovalStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        status: z.enum(["pending", "approved", "rejected"]),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: role } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!role) throw new Error("Apenas administradores.");
    const { error } = await context.supabase
      .from("user_approvals")
      .update({
        status: data.status,
        approved_at: data.status === "approved" ? new Date().toISOString() : null,
        approved_by: data.status === "approved" ? context.userId : null,
      })
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
