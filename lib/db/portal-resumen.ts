/**
 * Folio · resumen clínico CURADO del PORTAL DEL PACIENTE (Fase 3 · P5).
 *
 * El paciente logueado (getPacienteSession → paciente_cuenta_actual() → auth.uid())
 * ve un RESUMEN de su atención: sus turnos PASADOS (cuándo / con qué modalidad /
 * estado) y sus CONSENTIMIENTOS firmados (metadata legal). Nada más.
 *
 * PRINCIPIO DE SEGURIDAD (crítico · plan Fase 3 · decisión bloqueada #3):
 *   El "resumen clínico" es un WHITELIST explícito de lo que el paciente PUEDE ver,
 *   NUNCA un filtro sobre el SOAP. El paciente NO tiene grant a `sesion`
 *   (`sesion_enmienda`, `tool_data`, notas, flags de riesgo): M71 deliberadamente NO
 *   agrega ninguna policy aditiva sobre esas tablas, así que la sobre-exposición es
 *   IMPOSIBLE POR CONSTRUCCIÓN — este módulo ni siquiera consulta `sesion`. Sólo lee
 *   de tablas que M71 abre al paciente (turno, consentimiento) y selecciona un
 *   subconjunto de columnas operativas/legales, jamás las de audit ni las de firma.
 *
 * Columnas EXCLUIDAS a propósito (aunque la RLS de M71 las devolvería):
 *   · consentimiento.firma_storage_path — apunta al binario de la firma en Storage
 *     (se ve/descarga por su propio path en P6, no acá).
 *   · consentimiento.ip / user_agent    — audit AAIP, no es dato de exhibición.
 *   · turno.*                           — sólo inicio/duración/estado/modalidad; nada
 *     de precio, notas internas, ni referencia a sesión.
 *
 * PRINCIPIO ANTI-IDOR: TODA query scopea desde la sesión del paciente
 * (cuenta_id = auth.uid() vía las policies M71), NUNCA desde un id que mande el
 * cliente. No recibe ni acepta pacienteId/turnoId por argumento.
 */

import { tipoConsentimientoLabel } from "@/lib/consentimientos/helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, mapSupabaseError, ok, type Result } from "./errors";
import { getPacienteSession } from "./paciente-session";

// ═══════════════════════════════════════════════════════════════════════════════
// Whitelist de shape (anti-sobre-exposición · testeable sin DB)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Un turno PASADO tal como lo ve el paciente en el resumen. WHITELIST explícito:
 * sólo campos operativos (cuándo, cuánto duró, con qué modalidad, en qué estado
 * terminó). NUNCA SOAP, tool_data, notas ni flags de riesgo — esos viven en
 * `sesion`, a la que el paciente no tiene acceso (M71).
 */
export interface PortalTurnoPasadoView {
  id: string;
  organizationId: string;
  organizacionNombre: string | null;
  inicio: string;
  duracionMin: number;
  estado: string;
  modalidad: string;
}

/**
 * Un consentimiento firmado tal como lo ve el paciente en el resumen. WHITELIST de
 * metadata LEGAL (qué firmó, cuándo, si lo revocó). SIN el path del binario de la
 * firma (Storage) ni los campos de audit (ip/user_agent).
 */
export interface PortalConsentimientoView {
  id: string;
  organizationId: string;
  organizacionNombre: string | null;
  tipo: string;
  tipoLabel: string;
  firmadoEn: string;
  revocadoEn: string | null;
  plantillaTitulo: string | null;
  plantillaVersion: number | null;
}

/** El resumen clínico curado completo servido al portal. */
export interface PortalResumenView {
  turnosPasados: PortalTurnoPasadoView[];
  consentimientos: PortalConsentimientoView[];
}

/**
 * Claves PROHIBIDAS en cualquier objeto servido al portal: son las que sólo existen
 * en el SOAP / tool_data / campos de riesgo de `sesion`, más los campos de firma y
 * audit del consentimiento que el resumen NO expone. Si alguna aparece en la salida,
 * el whitelist se rompió. La lista es la línea de defensa del test unitario
 * (`resumenTieneClaveProhibida`) — no una whitelist de columnas SQL (eso lo fija el
 * `.select(...)`), sino un backstop puro sobre el shape final.
 *
 * En minúsculas: la comparación es case-insensitive contra las claves del objeto.
 */
export const CLAVES_PROHIBIDAS_RESUMEN: readonly string[] = [
  // SOAP crudo (sesion)
  "soap",
  "subjetivo",
  "objetivo",
  "evaluacion",
  "plan",
  "s",
  "o",
  "a",
  "p",
  // tool_data / instrumentos / notas clínicas
  "tool_data",
  "tooldata",
  "tool_data_cifrado",
  "notas",
  "notas_importantes",
  "nota",
  "diagnostico",
  "evolucion",
  "sesion",
  "sesion_id",
  "instrumento",
  "instrumento_respuesta",
  "respuestas",
  "score",
  "banda",
  // flags de riesgo
  "riesgo",
  "riesgo_suicida",
  "flag_riesgo",
  "alerta",
  "cssrs",
  "c_ssrs",
  // firma / audit del consentimiento (no se exhiben en el resumen)
  "firma_storage_path",
  "firma",
  "ip",
  "user_agent",
  "useragent",
];

/**
 * Escanea recursivamente un valor y devuelve la primera CLAVE PROHIBIDA que
 * encuentre en cualquier objeto anidado (comparación case-insensitive sobre el
 * nombre de la clave), o `null` si el shape está limpio. PURA a propósito — sin I/O
 * — para fijar la invariante "cero claves SOAP/riesgo" en un test unitario sin
 * mockear Supabase. Backstop del whitelist: si un `.select(...)` filtrara de más o
 * un embed trajera columnas inesperadas, esto lo delata en la salida final.
 *
 * Recorre objetos y arrays; ignora primitivos. No sigue referencias circulares
 * (los DTO del resumen son árboles planos de datos), pero acota la profundidad por
 * las dudas.
 */
export function resumenTieneClaveProhibida(
  value: unknown,
  prohibidas: readonly string[] = CLAVES_PROHIBIDAS_RESUMEN,
  _depth = 0,
): string | null {
  if (_depth > 20) return null;
  if (value === null || typeof value !== "object") return null;

  const setProhibidas = new Set(prohibidas.map((k) => k.toLowerCase()));

  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = resumenTieneClaveProhibida(item, prohibidas, _depth + 1);
      if (hit) return hit;
    }
    return null;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (setProhibidas.has(key.toLowerCase())) return key;
    const hit = resumenTieneClaveProhibida(child, prohibidas, _depth + 1);
    if (hit) return hit;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Lectura del resumen (RLS-enforced · whitelist de columnas)
// ═══════════════════════════════════════════════════════════════════════════════

/** Estados de turno que representan una atención YA OCURRIDA (para "turnos
 * pasados"). No filtramos sólo por fecha: un turno cerrado/atendido es historial
 * aunque su timestamp esté raro; y un AGENDADO/CONFIRMADO futuro no es historial. */
const ESTADOS_TURNO_PASADO: readonly string[] = [
  "CERRADO",
  "ATENDIENDO",
  "EN_SALA",
  "NO_ASISTIO",
];

/** Estados vivos (turno todavía por venir): se excluyen del resumen histórico. */
const ESTADOS_TURNO_VIVO: readonly string[] = ["AGENDADO", "CONFIRMADO"];

/**
 * Arma el resumen clínico curado del paciente logueado: sus turnos pasados y sus
 * consentimientos firmados, leídos bajo la RLS de auto-lectura (M71) por el cliente
 * ANON — sólo devuelve lo que cuelga de su cuenta. WHITELIST de columnas explícito
 * en cada `.select(...)`; jamás toca `sesion`.
 *
 * Un turno se considera "pasado" si su estado ∈ {CERRADO, ATENDIENDO, EN_SALA,
 * NO_ASISTIO} (atención ocurrida) O si ya pasó su horario y NO está vivo
 * (AGENDADO/CONFIRMADO futuro se excluye; un CANCELADO/REAGENDADO tampoco es
 * "atención pasada" salvo que ya haya sucedido su horario — no lo mostramos como
 * historial de atención). Se resuelve app-side sobre las filas que la RLS devolvió.
 */
export async function getResumenPortal(): Promise<Result<PortalResumenView>> {
  const session = await getPacienteSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();

  // Nombre de la org por id, desde el fan-out de la sesión (P3). El paciente NO es
  // member ⇒ no puede leer `organization` (org_select_own, M02): el nombre sale de
  // la sesión, no de un embed que la RLS devolvería NULL.
  const nombrePorOrg = new Map<string, string | null>();
  for (const p of session.data.pacientes) {
    nombrePorOrg.set(p.organizationId, p.organizacionNombre);
  }

  // ── Turnos (whitelist operativo · NUNCA sesión) ──────────────────────────────
  // Sólo columnas operativas. Nada de precio, notas ni referencia a `sesion`. La
  // policy turno_select_portal (M71) ya restringe a los turnos de la cuenta.
  const { data: turnosRaw, error: turnosErr } = await supabase
    .from("turno")
    .select("id, organization_id, inicio, duracion_min, estado, modalidad")
    .order("inicio", { ascending: false });

  if (turnosErr) {
    const mapped = mapSupabaseError(turnosErr);
    return err(mapped.code, "No se pudo cargar tu resumen.", turnosErr.message);
  }

  const now = Date.now();
  const turnosPasados: PortalTurnoPasadoView[] = ((turnosRaw ?? []) as Array<Record<string, unknown>>)
    .filter((r) => esTurnoPasado(String(r.estado), String(r.inicio), now))
    .map((r): PortalTurnoPasadoView => {
      const orgId = String(r.organization_id);
      return {
        id: String(r.id),
        organizationId: orgId,
        organizacionNombre: nombrePorOrg.get(orgId) ?? null,
        inicio: String(r.inicio),
        duracionMin: Number(r.duracion_min ?? 0),
        estado: String(r.estado),
        modalidad: (r.modalidad as string | null) ?? "presencial",
      };
    });

  // ── Consentimientos (whitelist de metadata legal · SIN firma/audit) ──────────
  // NO seleccionamos firma_storage_path, ip ni user_agent. El embed a la plantilla
  // trae sólo titulo/version (público del contrato firmado). La policy
  // consentimiento_select_portal (M71) restringe a los del paciente.
  const { data: consRaw, error: consErr } = await supabase
    .from("consentimiento")
    .select(
      "id, organization_id, tipo, firmado_en, revocado_en, " +
        "plantilla:plantilla_consentimiento(titulo, version)",
    )
    .order("firmado_en", { ascending: false });

  if (consErr) {
    const mapped = mapSupabaseError(consErr);
    return err(mapped.code, "No se pudo cargar tu resumen.", consErr.message);
  }

  const consentimientos: PortalConsentimientoView[] = ((consRaw ?? []) as unknown as Array<Record<string, unknown>>).map(
    (c): PortalConsentimientoView => {
      const plantilla = normalizeEmbedded(c.plantilla) as
        | { titulo?: string | null; version?: number | null }
        | null;
      const orgId = String(c.organization_id);
      const tipo = String(c.tipo);
      return {
        id: String(c.id),
        organizationId: orgId,
        organizacionNombre: nombrePorOrg.get(orgId) ?? null,
        tipo,
        tipoLabel: tipoConsentimientoLabel(tipo),
        firmadoEn: String(c.firmado_en),
        revocadoEn: (c.revocado_en as string | null) ?? null,
        plantillaTitulo: plantilla?.titulo ?? null,
        plantillaVersion:
          typeof plantilla?.version === "number" ? plantilla.version : null,
      };
    },
  );

  return ok({ turnosPasados, consentimientos });
}

/**
 * ¿Este turno es "historia de atención" (pasado) a los ojos del resumen? PURA
 * (testeable sin DB):
 *   - estado ∈ {CERRADO, ATENDIENDO, EN_SALA, NO_ASISTIO} → sí (atención ocurrida).
 *   - estado vivo (AGENDADO/CONFIRMADO): sólo si su horario YA pasó (turno perdido
 *     sin cerrar formalmente); si es futuro → no (es un próximo turno, no historial).
 *   - CANCELADO / REAGENDADO / otros: no es atención ocurrida → no se muestra como
 *     historial clínico.
 */
export function esTurnoPasado(estado: string, inicioIso: string, nowMs: number): boolean {
  if (ESTADOS_TURNO_PASADO.includes(estado)) return true;
  if (ESTADOS_TURNO_VIVO.includes(estado)) {
    const t = Date.parse(inicioIso);
    return Number.isFinite(t) && t < nowMs;
  }
  return false;
}

/**
 * Normaliza un embed de PostgREST que puede venir como objeto único o como array de
 * un elemento (según la cardinalidad inferida). Devuelve el objeto o null.
 */
function normalizeEmbedded(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null;
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return null;
}
