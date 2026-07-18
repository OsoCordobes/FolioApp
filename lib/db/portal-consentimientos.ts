/**
 * Folio · consentimientos del PORTAL DEL PACIENTE (Fase 3 · P6).
 *
 * El paciente logueado (getPacienteSession → paciente_cuenta_actual() → auth.uid())
 * puede, sobre sus fichas linkeadas:
 *   · VER la lista de sus consentimientos firmados (metadata legal + estado),
 *   · abrir la imagen de SU firma vía un signed URL de 5 min (por consentimientoId,
 *     NUNCA por un path del cliente — anti-IDOR),
 *   · FIRMAR un consentimiento nuevo (canvas→PNG→Storage + fila), en
 *     lib/db/consentimientos.ts::createConsentimientoPortal.
 *
 * PRINCIPIO DE SEGURIDAD (crítico · plan Fase 3):
 *   Toda lectura scopea desde la sesión del paciente (M71: consentimiento_select_
 *   portal + "consentimientos-firmados portal read" de M85), NUNCA desde un id que
 *   mande el cliente. La lista NO expone firma_storage_path ni los campos de audit
 *   (ip / user_agent): el binario se ve por su propio path server-side (signed URL),
 *   y la ip/UA son evidencia AAIP, no dato de exhibición. El paciente NO tiene acceso
 *   a `sesion` (M71) — esto sólo toca `consentimiento`, que él ya podía leer.
 */

import { pathSinBucket, tipoConsentimientoLabel } from "@/lib/consentimientos/helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, mapSupabaseError, ok, type Result } from "./errors";
import { getPacienteSession } from "./paciente-session";

const CONSENT_BUCKET = "consentimientos-firmados";
const SIGNED_URL_TTL_SECONDS = 300; // 5 min (mismo TTL que el flujo staff)

/**
 * Un consentimiento firmado tal como lo ve el paciente en el portal. WHITELIST de
 * metadata legal (qué firmó, cuándo, si lo revocó, en qué org). SIN el path del
 * binario de la firma (se abre por consentimientoId → signed URL) ni los campos de
 * audit (ip / user_agent).
 */
export interface PortalConsentimientoItem {
  id: string;
  organizationId: string;
  organizacionNombre: string | null;
  tipo: string;
  tipoLabel: string;
  titulo: string;
  version: number | null;
  firmadoEn: string;
  revocadoEn: string | null;
  vigente: boolean;
}

interface ConsentimientoRowRaw {
  id: string;
  organization_id: string;
  tipo: string;
  firmado_en: string;
  revocado_en: string | null;
  plantilla?:
    | { titulo: string | null; version: number | null }
    | { titulo: string | null; version: number | null }[]
    | null;
}

/**
 * Anti-IDOR PURO (testeable sin DB): ¿el path de la firma apunta EXACTAMENTE a la
 * ficha (org + paciente) que la sesión autorizó? El path se arma server-side con el
 * org+paciente de la sesión; este check es el cinturón sobre un path que ya pasó el
 * regex del schema — impide que un binario subido bajo un {org}/{paciente} ajeno se
 * ate a una fila `consentimiento` de otra ficha. Comparación de prefijo exacta
 * `consentimientos-firmados/{org}/{paciente}/` (el archivo es el último segmento).
 */
export function firmaPathMatchesFicha(
  firmaStoragePath: string,
  organizationId: string,
  pacienteId: string,
): boolean {
  const expectedPrefix = `consentimientos-firmados/${organizationId}/${pacienteId}/`;
  return firmaStoragePath.startsWith(expectedPrefix);
}

/**
 * Mapea una fila cruda de `consentimiento` (leída bajo RLS) al item WHITELIST del
 * portal. PURA (sin I/O) — fija el shape servido al cliente en un unit test: nunca
 * firma_storage_path, ip ni user_agent. `nombrePorOrg` viene del fan-out de la sesión.
 */
export function mapConsentimientoPortal(
  c: ConsentimientoRowRaw,
  nombrePorOrg: Map<string, string | null>,
): PortalConsentimientoItem {
  const plantilla = Array.isArray(c.plantilla) ? c.plantilla[0] : c.plantilla;
  const orgId = String(c.organization_id);
  const tipo = String(c.tipo);
  const version = typeof plantilla?.version === "number" ? plantilla.version : null;
  return {
    id: String(c.id),
    organizationId: orgId,
    organizacionNombre: nombrePorOrg.get(orgId) ?? null,
    tipo,
    tipoLabel: tipoConsentimientoLabel(tipo),
    titulo: plantilla?.titulo ?? tipoConsentimientoLabel(tipo),
    version,
    firmadoEn: String(c.firmado_en),
    revocadoEn: (c.revocado_en as string | null) ?? null,
    vigente: c.revocado_en == null,
  };
}

/**
 * Lista los consentimientos del paciente logueado (todas sus fichas linkeadas), bajo
 * la RLS de auto-lectura (consentimiento_select_portal, M71) por el cliente ANON —
 * sólo devuelve los que cuelgan de su cuenta. WHITELIST de columnas explícito (nunca
 * firma_storage_path ni audit). Ordena por firma descendente.
 */
export async function listConsentimientosPortal(): Promise<
  Result<PortalConsentimientoItem[]>
> {
  const session = await getPacienteSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();

  // Nombre de la org por id, desde el fan-out de la sesión (P3). El paciente NO es
  // member ⇒ no puede leer `organization` (org_select_own, M02): el nombre sale de la
  // sesión, no de un embed que la RLS devolvería NULL.
  const nombrePorOrg = new Map<string, string | null>();
  for (const p of session.data.pacientes) {
    nombrePorOrg.set(p.organizationId, p.organizacionNombre);
  }

  const { data, error } = await supabase
    .from("consentimiento")
    .select(
      "id, organization_id, tipo, firmado_en, revocado_en, " +
        "plantilla:plantilla_consentimiento(titulo, version)",
    )
    .order("firmado_en", { ascending: false });

  if (error) {
    const mapped = mapSupabaseError(error);
    return err(mapped.code, "No pudimos cargar tus consentimientos.", error.message);
  }

  const items: PortalConsentimientoItem[] = (
    (data ?? []) as unknown as ConsentimientoRowRaw[]
  ).map((c) => mapConsentimientoPortal(c, nombrePorOrg));

  return ok(items);
}

/**
 * Signed URL temporal (5 min) para ver la firma de UN consentimiento propio. Recibe
 * el consentimientoId — NUNCA un storage path del cliente: el path se lee de la fila
 * (bajo consentimiento_select_portal, M71 — sólo si es suyo) y recién ahí se firma
 * (IDOR-proof por construcción). La firma del URL corre por el cliente anon bajo
 * "consentimientos-firmados portal read" (M85: paciente_owns del path).
 */
export async function getFirmaUrlPortal(
  consentimientoId: string,
): Promise<Result<{ signedUrl: string }>> {
  const session = await getPacienteSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();

  // El path, leído bajo RLS del paciente (sólo si el consentimiento es suyo). Si no
  // es suyo → 0 filas → not_found (nunca confiamos en el id a secas).
  const { data: row, error } = await supabase
    .from("consentimiento")
    .select("firma_storage_path")
    .eq("id", consentimientoId)
    .maybeSingle();

  if (error) {
    const mapped = mapSupabaseError(error);
    return err(mapped.code, "No pudimos buscar el consentimiento.", error.message);
  }
  const path = (row as { firma_storage_path: string } | null)?.firma_storage_path;
  if (!path) {
    return err("not_found", "No encontramos ese consentimiento.");
  }

  const { data: signed, error: signErr } = await supabase.storage
    .from(CONSENT_BUCKET)
    .createSignedUrl(pathSinBucket(path), SIGNED_URL_TTL_SECONDS);

  if (signErr || !signed) {
    return err("not_found", "No se pudo generar el link de la firma.", signErr?.message);
  }
  return ok({ signedUrl: signed.signedUrl });
}
