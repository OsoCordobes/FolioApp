/** Account closure requests require a reviewed retention and delivery decision.
 * This compatibility endpoint is read-only even if the old feature flag is set.
 * It is intentionally absent from the deployment cron configuration. */
import { NextResponse, type NextRequest } from "next/server";
import { verifyBearer } from "@/lib/security/verify-bearer";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;
const headers = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  if (!verifyBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers });
  }
  try {
    const service = createSupabaseServiceClient();
    const { count, error } = await service.from("profile")
      .select("id", { count: "exact", head: true })
      .not("deletion_requested_at", "is", null);
    if (error || !Number.isSafeInteger(count) || count === null || count < 0) {
      return NextResponse.json({ error: "No se pudo consultar las solicitudes de baja." }, { status: 500, headers });
    }
    return NextResponse.json({
      ok: true,
      mode: "review-only",
      status: "manual_review_required",
      automatic_purge: false,
      pending_count: count,
      note: "Las solicitudes se conservan para revisión humana y entrega autorizada. El vencimiento de un plazo no elimina ni pseudonimiza datos.",
    }, { headers });
  } catch {
    return NextResponse.json({ error: "No se pudo consultar las solicitudes de baja." }, { status: 500, headers });
  }
}
