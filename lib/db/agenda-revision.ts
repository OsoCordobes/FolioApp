import "server-only";
import { isAgendaRevisionToken } from "@/lib/agenda/revision-token";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActiveSession } from "./session";

/** Read once, after session verification and before any agenda snapshot query.
 * The caller passes its trusted server session, never a browser organization.
 * A missing marker is deliberately not a successful acknowledgement.
 */
export async function readAgendaRevision(session: ActiveSession): Promise<string | null> {
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("read_agenda_revision", { p_org: session.organizationId });
    return !error && isAgendaRevisionToken(data) ? data : null;
  } catch {
    // No SDK content, SQL or potentially identifying context reaches the UI.
    return null;
  }
}
