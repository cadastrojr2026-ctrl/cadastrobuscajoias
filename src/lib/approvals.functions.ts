import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type ApprovalStatus = "pending" | "approved" | "rejected";

// Ensure an approval row exists for the current user (safety net in case
// the auth trigger did not fire). New users get 'pending'.
// Also notifies the admin on WhatsApp once per pending request.
export const ensureMyApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims.email as string | undefined) ?? "";
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing } = await context.supabase
      .from("user_approvals")
      .select("status")
      .eq("user_id", context.userId)
      .maybeSingle();

    if (!existing) {
      await supabaseAdmin.from("user_approvals").insert({
        user_id: context.userId,
        email,
        status: "pending",
      });
    }

    const status = (existing?.status ?? "pending") as ApprovalStatus;

    // Notify the admin only once, and only while the request is pending.
    if (status === "pending") {
      const { data: row } = await supabaseAdmin
        .from("user_approvals")
        .select("notified_at, email")
        .eq("user_id", context.userId)
        .maybeSingle();

      if (row && !row.notified_at) {
        const { sendWhatsAppAccessRequest } = await import("@/lib/notify.server");
        const result = await sendWhatsAppAccessRequest(row.email || email);
        if (result.sent) {
          await supabaseAdmin
            .from("user_approvals")
            .update({ notified_at: new Date().toISOString() })
            .eq("user_id", context.userId);
        }
      }
    }

    return { status };
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
