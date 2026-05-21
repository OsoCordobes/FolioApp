/**
 * Folio · /api/cron/account-purge
 *
 * Daily cron (03:00 UTC). Hard-deletes profiles whose deletion_requested_at
 * is older than 30 days (Ley 25.326 art. 16 right-to-erasure after the
 * grace period).
 *
 * Authorization: Bearer CRON_SECRET (Vercel Cron).
 *
 * For each due profile:
 *   1. For every org the profile owns: pseudonymize each paciente via the
 *      existing pseudonimizar_paciente() function (M13).
 *   2. Soft-delete member rows + orgs (deleted_at = now()).
 *   3. Hard-delete the profile (and the auth.users row via service-role
 *      admin.deleteUser).
 *
 * MVP: the cron file ships ready but the actual hard-delete logic is
 * gated behind a feature flag because (a) no real users have requested
 * deletion yet, and (b) we want at least one staging trial before the
 * production cron runs. To enable: set ACCOUNT_PURGE_ENABLED=1 in
 * the production env.
 */

import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const service = createSupabaseServiceClient();
  const thresholdIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: due, error } = await service
    .from("profile")
    .select("id, email, deletion_requested_at")
    .lt("deletion_requested_at", thresholdIso)
    .not("deletion_requested_at", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const enabled = process.env.ACCOUNT_PURGE_ENABLED === "1";

  if (!enabled) {
    return NextResponse.json({
      ok: true,
      mode: "dry-run",
      due_count: (due ?? []).length,
      note: "ACCOUNT_PURGE_ENABLED is not 1 — listing only, no deletions performed. Set the env to enable hard-delete.",
    });
  }

  const results: Array<{ profile_id: string; status: "purged" | "error"; error?: string }> = [];
  for (const row of due ?? []) {
    const profileId = row.id as string;
    try {
      // 1. Find orgs this profile owns
      const { data: ownerMembers } = await service
        .from("member")
        .select("organization_id")
        .eq("profile_id", profileId)
        .eq("role", "OWNER")
        .is("deleted_at", null);
      const orgIds = (ownerMembers ?? []).map((m: { organization_id: string }) => m.organization_id);

      // 2. Pseudonymize all pacientes in each owned org
      for (const orgId of orgIds) {
        const { data: pacientes } = await service
          .from("paciente")
          .select("id")
          .eq("organization_id", orgId)
          .is("deleted_at", null);
        for (const p of pacientes ?? []) {
          await service.rpc("pseudonimizar_paciente", {
            p_paciente_id: p.id,
            p_motivo: "account_purge cron after 30-day deletion grace",
          });
        }
      }

      // 3. Soft-delete member rows
      await service
        .from("member")
        .update({ deleted_at: new Date().toISOString() })
        .eq("profile_id", profileId);

      // 4. Soft-delete owned organizations
      if (orgIds.length > 0) {
        await service
          .from("organization")
          .update({ deleted_at: new Date().toISOString() })
          .in("id", orgIds);
      }

      // 5. Delete profile row (cascade ON DELETE handles dependent FKs)
      await service.from("profile").delete().eq("id", profileId);

      // 6. Delete auth.users row
      await service.auth.admin.deleteUser(profileId);

      results.push({ profile_id: profileId, status: "purged" });
    } catch (e) {
      results.push({
        profile_id: profileId,
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
