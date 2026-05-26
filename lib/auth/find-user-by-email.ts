/**
 * Folio · findUserByEmail — direct-SQL lookup with admin hydration.
 *
 * Pre-M38 this helper paginated `admin.listUsers` in pages of 1000, up to
 * 50 pages. With ~200ms per admin call, an existing-email signup attempt
 * could spend 10+ seconds in this function alone. The Sprint 0 fix
 * (extracted from inline code) preserved the behavior; M38 finally
 * replaces the underlying mechanism with a SECURITY DEFINER RPC that does
 * a single indexed query against `auth.users`.
 *
 * Flow now:
 *   1. RPC `find_user_id_by_email` → uuid (one round-trip).
 *   2. If found, `admin.getUserById` → full user object (one round-trip).
 *      We still need this because callers read fields like
 *      `email_confirmed_at` and `identities` (see actions.ts:163).
 *
 * Total: at most 2 round-trips instead of up to 50.
 *
 * The exported signature is unchanged so callers in
 * `app/(public)/onboarding/actions.ts` and
 * `app/api/admin/confirm-user/route.ts` keep working without edits.
 */

import { captureException } from "@sentry/nextjs";

import type { createSupabaseServiceClient } from "@/lib/supabase/server";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

type AdminGetUserResult = Awaited<
  ReturnType<ServiceClient["auth"]["admin"]["getUserById"]>
>;

type AdminUser = AdminGetUserResult extends { data: { user: infer U } | null }
  ? NonNullable<U>
  : never;

export async function findUserByEmail(
  service: ServiceClient,
  email: string,
): Promise<AdminUser | null> {
  const normalized = email.trim();
  if (!normalized) return null;

  // 1. SQL lookup via the M38 SECURITY DEFINER RPC.
  const { data: userId, error: rpcErr } = await service.rpc(
    "find_user_id_by_email",
    { p_email: normalized },
  );

  if (rpcErr) {
    captureException(rpcErr, {
      tags: { helper: "findUserByEmail", step: "rpc" },
      extra: { email: normalized },
    });
    return null;
  }
  if (!userId) return null;

  // 2. Hydrate the full user object via admin SDK (callers read
  //    `email_confirmed_at`, `identities`, etc).
  const { data, error: adminErr } = await service.auth.admin.getUserById(
    userId as string,
  );
  if (adminErr) {
    captureException(adminErr, {
      tags: { helper: "findUserByEmail", step: "hydrate" },
      extra: { userId },
    });
    return null;
  }
  return (data?.user ?? null) as AdminUser | null;
}
