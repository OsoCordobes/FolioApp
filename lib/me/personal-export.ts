import { verifyMfaSession } from "@/lib/auth/mfa-access";
import { decryptColumn } from "@/lib/crypto";
import { writeAuditEntry } from "@/lib/db/audit";
import { readCompleteCollection } from "@/lib/db/complete-collection";
import { err, ok, type Result } from "@/lib/db/errors";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/lib/legal/versions";
import { sanitizeInvitationsForExport, type RawInvitationRow } from "@/lib/me/export-invitations";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

// Explicit schema projections (M02/M11/M19 and additive profile/org migrations).
// No patient tables, opaque provider metadata, OAuth tokens or certificates.
const columns = {
  profile: "id,email,nombre_cifrado,apellido_cifrado,matricula,avatar_url,two_factor_enabled,consent_pii_signed_at,consent_pii_text_version,deletion_requested_at,created_at,updated_at",
  member: "id,profile_id,organization_id,role,alcance,profesionales_gestionados,equipo_id,es_colegiado,invited_by_id,accepted_at,deleted_at,created_at",
  organization: "id,slug,nombre,tipo,rubro,ciudad,provincia,timezone,moneda,cuit,razon_social,condicion_iva,telefono_publico,direccion_completa,instagram_handle,bio,opt_out_analytics,opt_out_public_listing,listar_en_directorio,created_at,updated_at,deleted_at",
  integration: "id,organization_id,profesional_id,proveedor,expira_ts,ultimo_uso_ts,created_at",
  suscripcion: "id,organization_id,estado,monto_cents,moneda,fecha_alta,proxima_cobro,fecha_cancelacion,created_at",
  member_invitation: "id,organization_id,email,role,estado,expires_at,accepted_at,created_at,invited_by_member_id,accepted_by_profile_id",
} as const;
type Row = { id: string } & Record<string, unknown>;
type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type Table = keyof typeof columns;
// Keep each PostgREST projection literal: a union of table/column strings makes
// its type-level SELECT parser expand every unrelated combination.
function selected(client: Client, table: Table) {
  switch (table) {
    case "profile": return client.from("profile").select(columns.profile, { count: "exact" });
    case "member": return client.from("member").select(columns.member, { count: "exact" });
    case "organization": return client.from("organization").select(columns.organization, { count: "exact" });
    case "integration": return client.from("integration").select(columns.integration, { count: "exact" });
    case "suscripcion": return client.from("suscripcion").select(columns.suscripcion, { count: "exact" });
    case "member_invitation": return client.from("member_invitation").select(columns.member_invitation, { count: "exact" });
  }
}
const failure = () => err("db_error", "No se pudo preparar la descarga completa. Intentá nuevamente.");
const changed = () => err("conflict", "Tus datos o permisos cambiaron durante la descarga. Intentá nuevamente.");
const MAX_EXPORT_BYTES = 4 * 1024 * 1024;
const unique = (values: string[]) => [...new Set(values)].sort();
const chunks = (values: string[]) => Array.from({ length: Math.ceil(values.length / 200) }, (_, i) => values.slice(i * 200, i * 200 + 200));
const active = (row: Row) => row.deleted_at === null && (row.accepted_at != null || row.invited_by_id === null);
function pick(row: Row, projection: string): Row {
  return Object.fromEntries(projection.split(",").map(key => [key, row[key]])) as Row;
}
function textId(value: unknown): string {
  if (typeof value !== "string" || !value) throw Error("invalid_scope");
  return value;
}
async function collection(client: Client, table: Table, filter: { column: string; value: string | string[] }): Promise<Row[]> {
  const result = await readCompleteCollection<Row>(async (from, to) => {
    let query = selected(client, table);
    query = Array.isArray(filter.value) ? query.in(filter.column, filter.value) : query.eq(filter.column, filter.value);
    if (table === "organization") query = query.is("deleted_at", null);
    // The generic projection is narrowed by the fixed table allowlist above;
    // returned IDs and ownership are validated below, never trusted from a cast.
    const page = await query.order("id", { ascending: true }).range(from, to).returns<Row[]>();
    if (!Number.isSafeInteger(page.count) || page.count === null || page.count < 0) throw Error("count_unavailable");
    return page;
  });
  if (result.error) throw Error("read_failed");
  return result.data.map(row => { textId(row.id); return pick(row, columns[table]); });
}
async function byIds(client: Client, table: Table, column: string, ids: string[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (const part of chunks(unique(ids))) rows.push(...await collection(client, table, { column, value: part }));
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw Error("duplicate_row");
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}
async function snapshot(user: Client, service: Client, userId: string) {
  const profileResult = await service.from("profile").select(columns.profile).eq("id", userId).maybeSingle();
  if (profileResult.error || !profileResult.data || profileResult.data.id !== userId) throw Error("profile_unavailable");
  const profile = pick(profileResult.data, columns.profile);
  const members = await collection(service, "member", { column: "profile_id", value: userId });
  const ownerByMember = new Map<string, string>();
  for (const member of members) {
    if (member.profile_id !== userId) throw Error("foreign_member");
    ownerByMember.set(textId(member.id), textId(member.organization_id));
  }
  const current = members.filter(active);
  const orgIds = unique(current.map(m => textId(m.organization_id)));
  // Current organization configuration and billing additionally pass user RLS.
  // Deleted/inaccessible organizations never get a privileged fallback.
  const organizations = await byIds(user, "organization", "id", orgIds);
  for (const org of organizations) if (!orgIds.includes(org.id) || org.deleted_at !== null) throw Error("foreign_org");
  const accessible = new Set(organizations.map(org => org.id));
  const ownerOrgs = unique(current.filter(m => m.role === "OWNER" && accessible.has(textId(m.organization_id))).map(m => textId(m.organization_id)));
  const subscriptions = await byIds(user, "suscripcion", "organization_id", ownerOrgs);
  for (const row of subscriptions) if (!ownerOrgs.includes(textId(row.organization_id))) throw Error("foreign_billing");
  const memberIds = [...ownerByMember.keys()];
  const integrations = await byIds(service, "integration", "profesional_id", memberIds);
  for (const row of integrations) if (ownerByMember.get(textId(row.profesional_id)) !== row.organization_id) throw Error("foreign_integration");
  const accepted = await collection(service, "member_invitation", { column: "accepted_by_profile_id", value: userId });
  const sent = await byIds(service, "member_invitation", "invited_by_member_id", memberIds);
  const invitations = new Map<string, Row>();
  for (const row of [...accepted, ...sent]) {
    const ownSent = typeof row.invited_by_member_id === "string" && ownerByMember.get(row.invited_by_member_id) === row.organization_id;
    if (row.accepted_by_profile_id !== userId && !ownSent) throw Error("foreign_invitation");
    const previous = invitations.get(row.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row)) throw Error("changed_invitation");
    invitations.set(row.id, row);
  }
  return { profile, members, organizations, subscriptions, integrations, invitations: [...invitations.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}
function decryptRequired(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string" && !Buffer.isBuffer(value) && !(value instanceof Uint8Array)) throw Error("invalid_ciphertext");
  const plaintext = decryptColumn(value);
  if (plaintext === null) throw Error("decryption_failed");
  return plaintext;
}
export interface PersonalExport {
  filename: string;
  payload: Record<string, unknown>;
}
/** One contract for HTTP and server-action downloads. No billing gate on own data.
 * Two complete reads plus fresh Auth/MFA checks reject observed scope/data drift.
 * This is not a database-wide MVCC snapshot; a later change needs a new export.
 */
export async function exportPersonalData(): Promise<Result<PersonalExport>> {
  try {
    const userClient = await createSupabaseServerClient();
    const first = await verifyMfaSession(userClient);
    if (!first.ok) return first;
    const userId = first.data.user.id;
    const service = createSupabaseServiceClient();
    const data = await snapshot(userClient, service, userId);
    const profile = {
      ...pick(data.profile, "id,email,matricula,avatar_url,two_factor_enabled,consent_pii_signed_at,consent_pii_text_version,deletion_requested_at,created_at,updated_at"),
      nombre: decryptRequired(data.profile.nombre_cifrado), apellido: decryptRequired(data.profile.apellido_cifrado),
    };
    const revalidated = await verifyMfaSession(userClient);
    if (!revalidated.ok) return revalidated;
    if (revalidated.data.user.id !== userId) return changed();
    const latest = await snapshot(userClient, service, userId);
    if (JSON.stringify(data) !== JSON.stringify(latest)) return changed();
    const orgs = new Map(data.organizations.map(org => [org.id, pick(org, columns.organization.replace(",deleted_at", ""))]));
    const memberships = data.members.map(m => pick(m, columns.member.replace(",profile_id", "").replace(",invited_by_id", "")));
    const exportedAt = new Date().toISOString();
    const output = { filename: `folio-export-${userId}-${exportedAt.slice(0, 10)}.json`, payload: {
      ok: true, format_version: 2, exported_at: exportedAt, user_id: userId,
      ley_25326_basis: "art. 14 (derecho de acceso)", privacy_policy_version: PRIVACY_VERSION, terms_version: TERMS_VERSION,
      profile, memberships,
      members: memberships.map((m, index) => ({ ...m, organization: active(data.members[index]) ? orgs.get(textId(m.organization_id)) ?? null : null })),
      integraciones: data.integrations.map(row => pick(row, columns.integration.replace(",profesional_id", ""))),
      suscripciones: data.subscriptions,
      invitaciones: sanitizeInvitationsForExport(data.invitations as unknown as RawInvitationRow[], userId, data.members.map(m => m.id)),
      categories: ["profile", "memberships", "current_accessible_organization_settings", "own_integration_metadata", "current_owner_subscriptions", "own_sent_or_accepted_invitations"],
      excluded_categories: ["patient_clinical_data", "oauth_tokens_and_secrets", "certificates", "other_professionals_integrations", "revoked_organization_settings", "other_personal_records_not_listed_in_categories"],
      warnings: data.members.some(m => !active(m) || !orgs.has(textId(m.organization_id))) ? ["La configuración actual de organizaciones sin acceso vigente no está incluida; se conserva tu historial de membresías."] : [],
      notas: ["La descarga contiene las categorías indicadas de datos propios; no constituye una entrega de historias clínicas.",
        "La facturación se incluye sólo donde sos OWNER vigente. Las integraciones incluyen metadatos propios, sin tokens ni secretos.",
        "La solicitud de baja requiere revisión humana de conservación y entrega autorizada; no implica borrado automático.",
        "Las lecturas se verifican al finalizar; no representan una instantánea transaccional de toda la base de datos."],
    } };
    // Measure the actual pretty-printed JSON used by both download wrappers.
    if (Buffer.byteLength(JSON.stringify(output.payload, null, 2), "utf8") > MAX_EXPORT_BYTES) {
      return err("validation", "La descarga supera 4 MB. Contactá a soporte para coordinar una entrega completa.");
    }
    const auditMember = data.members.find(m => active(m) && orgs.has(textId(m.organization_id)));
    if (auditMember) {
      const audit = await writeAuditEntry({ organizationId: textId(auditMember.organization_id), actorId: userId,
        actorRole: textId(auditMember.role), action: "profile.export", resourceType: "profile", resourceId: userId,
        payload: { format_version: 2, categories: 6 } });
      if (!audit.ok) return failure();
    }
    const final = await verifyMfaSession(userClient);
    if (!final.ok) return final;
    if (final.data.user.id !== userId) return changed();
    // Audit and Auth are asynchronous: neither proves that OWNER authority or
    // membership survived. Re-read the exact scope after those waits, with no
    // further asynchronous work between its comparison and delivery.
    const finalOrgs = await byIds(userClient, "organization", "id", data.organizations.map(org => org.id));
    const finalMembers = await collection(service, "member", { column: "profile_id", value: userId });
    if (JSON.stringify(finalMembers) !== JSON.stringify(data.members)) return changed();
    if (JSON.stringify(finalOrgs) !== JSON.stringify(data.organizations)) return changed();
    return ok(output);
  } catch {
    return failure();
  }
}

