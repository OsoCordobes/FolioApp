import "server-only";

import { verifyMfaSession } from "@/lib/auth/mfa-access";
import { readCompleteCollection } from "@/lib/db/complete-collection";
import { err, ok, type Result } from "@/lib/db/errors";
import type { PacienteSession } from "@/lib/db/paciente-session";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;
interface LinkRow {
  id: string;
  organization_id: string;
  identidad_id: string | null;
  cuenta_id: string | null;
  pseudonimizado_en: string | null;
}
export interface PortalExportAuthority {
  readonly userId: string;
  readonly cuentaId: string;
  readonly links: readonly Readonly<{ pacienteId: string; organizationId: string; identityId: string }>[];
}

const changed = () => err("conflict", "El acceso a tus fichas cambió durante la descarga. Intentá nuevamente desde el portal.");
const unavailable = () => err("network", "No se pudo verificar el acceso a tus fichas. Intentá nuevamente.");
const nonempty = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** User client only. Counted pagination prevents the session's unpaginated fan-out
 * from certifying a partial download. Only existing account-linked rows qualify. */
export async function capturePortalExportAuthority(client: Client, session: Pick<PacienteSession, "userId" | "cuentaId">): Promise<Result<PortalExportAuthority>> {
  if (!nonempty(session.userId) || !nonempty(session.cuentaId)) return changed();
  const result = await readCompleteCollection<LinkRow>((from, to) => client.from("paciente")
    .select("id, organization_id, identidad_id, cuenta_id, pseudonimizado_en", { count: "exact" })
    .eq("cuenta_id", session.cuentaId).is("pseudonimizado_en", null)
    .order("id", { ascending: true }).range(from, to));
  if (result.error) return unavailable();
  if (!result.data.length) return err("not_found", "Todavía no hay fichas vinculadas disponibles para descargar.");
  if (result.data.some(row => !nonempty(row.id) || !nonempty(row.organization_id) || !nonempty(row.identidad_id) ||
      row.cuenta_id !== session.cuentaId || row.pseudonimizado_en !== null)) return changed();
  const links = result.data.map(row => Object.freeze({ pacienteId: row.id, organizationId: row.organization_id, identityId: row.identidad_id! }))
    .sort((a, b) => a.pacienteId.localeCompare(b.pacienteId));
  return ok(Object.freeze({ userId: session.userId, cuentaId: session.cuentaId, links: Object.freeze(links) }));
}

/** Call after serialization and audit; return prepared bytes without further I/O.
 * Reuses the current portal/dual-account MFA policy, never staff clinical rights.
 * Success detects observed drift, not an atomic snapshot or revocation of bytes
 * already delivered. Identifiers stay server-side in request memory. */
export async function revalidatePortalExportAuthority(client: Client, expected: PortalExportAuthority): Promise<Result<void>> {
  try {
    const verified = await verifyMfaSession(client);
    if (!verified.ok) {
      if (verified.error.code === "auth_required") return err("auth_required", "Volvé a iniciar sesión para descargar tus datos.");
      if (verified.error.code === "mfa_required") return err("mfa_required", "Completá la verificación en dos pasos para continuar.");
      return unavailable();
    }
    if (verified.data.user.id !== expected.userId) return changed();
    const account = await client.rpc("paciente_cuenta_actual");
    if (account.error) return unavailable();
    if (!nonempty(account.data)) return err("forbidden", "Tu cuenta ya no tiene acceso al portal.");
    if (account.data !== expected.cuentaId) return changed();
    const current = await capturePortalExportAuthority(client, expected);
    if (!current.ok) return current.error.code === "not_found" ? changed() : current;
    if (current.data.links.length !== expected.links.length || current.data.links.some((link, i) =>
      link.pacienteId !== expected.links[i].pacienteId || link.organizationId !== expected.links[i].organizationId ||
      link.identityId !== expected.links[i].identityId)) return changed();
    return ok(undefined);
  } catch {
    return unavailable();
  }
}
