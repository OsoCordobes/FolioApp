import { getActiveContext } from "@/lib/db/active-context";
import { isAgendaRevisionToken } from "@/lib/agenda/revision-token";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };

export async function GET() {
  try {
    const context = await getActiveContext();
    if (!context.ok) {
      const status = context.error.code === "auth_required" ? 401 : ["forbidden", "mfa_required", "no_org"].includes(context.error.code) ? 403 : 503;
      return Response.json({ error: "agenda_revision_unavailable" }, { status, headers });
    }
    // Time can expire a trial/grace period without a database mutation.
    if (!context.data.accessGate.allowed && !context.data.organization.isInternalAccount) {
      return Response.json({ error: "agenda_revision_unavailable" }, { status: 403, headers });
    }
    const session = context.data.session;
    const client = await createSupabaseServerClient();
    const result = await client.rpc("read_agenda_revision", { p_org: session.organizationId });
    if (result.error || !isAgendaRevisionToken(result.data)) {
      return Response.json({ error: "agenda_revision_unavailable" }, { status: result.error?.code === "42501" ? 403 : 503, headers });
    }
    return Response.json({ organizationId: session.organizationId, revision: result.data }, { headers });
  } catch {
    return Response.json({ error: "agenda_revision_unavailable" }, { status: 503, headers });
  }
}
