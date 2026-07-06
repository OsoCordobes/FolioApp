/**
 * Folio · lib/patient/export-builder.ts · assembler del export ARCO del PACIENTE
 * (Ley 25.326 art. 14 — derecho de acceso; art. 16 — portabilidad implícita).
 *
 * A diferencia de /api/me/export (que exporta los datos del PROFESIONAL titular
 * del profile), este builder arma el export de UN PACIENTE: su PII descifrada
 * (identidad), sus turnos, sus consentimientos firmados y un resumen clínico
 * curado — el paquete que el paciente tiene derecho a recibir cuando lo pide.
 *
 * ── Dos capas, un assembler ───────────────────────────────────────────────────
 * X2 (esta capa): export MEDIADO por el profesional desde la ficha, gateado por
 *   rol clínico + membresía de la org que posee al paciente. El scope (org +
 *   paciente_id) SIEMPRE viene de la sesión del profesional, nunca del cliente.
 * P7 (capa portal, futura): el mismo assembler alimenta el portal del paciente,
 *   agregando todas las orgs linkeadas por `cuenta_id`. Por eso el builder recibe
 *   ya resueltos org + paciente y un client Supabase — no llama a getActiveSession
 *   por sí mismo: cada capa decide su propio scope y se lo pasa.
 *
 * ── Qué EXCLUYE (regla dura) ──────────────────────────────────────────────────
 * NUNCA incluye el SOAP crudo (sesion.tool_data_cifrado / campos S/O/A/P): la
 * historia clínica narrativa es dato del profesional-controller, no un dato
 * personal que el paciente porte 1:1. El "resumen clínico" es un WHITELIST de
 * campos no sensibles (motivo de consulta que el propio paciente declaró,
 * fechas de atención), NO un filtro sobre el SOAP. Si mañana se agrega una
 * fuente, se agrega explícitamente acá — el default es no incluir.
 *
 * ── Anti-IDOR ─────────────────────────────────────────────────────────────────
 * El riesgo de esta feature es IDOR: pedir el export de un paciente ajeno. Toda
 * query scopea por `organizationId` (de la sesión) Y `pacienteId`; además,
 * `assertPacienteScope` (pura, testeable) reafirma que la fila leída pertenece a
 * la org esperada antes de descifrar/serializar — defensa en profundidad sobre la
 * RLS de `paciente`. Sin fila (RLS ∅ / cross-tenant) → not_found, nunca se filtra
 * la existencia de un paciente de otra org.
 */

import "server-only";

import { tryDecrypt } from "@/lib/crypto";
import { err, mapSupabaseError, ok, type Result } from "@/lib/db/errors";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/lib/legal/versions";
import { SUPPORT_EMAIL } from "@/lib/support";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// El cliente Supabase del proyecto está tipado <any> (ver CLAUDE.md): derivamos
// el tipo del factory real en vez de importar @supabase/supabase-js, así el
// builder no arrastra ese any explícito ni una dependencia extra.
type Supa = Awaited<ReturnType<typeof createSupabaseServerClient>>;

// ─── Contrato de scope (pura, anti-IDOR) ─────────────────────────────────────

/**
 * Fila mínima de `paciente` necesaria para verificar el scope antes de exportar.
 * Sólo `organization_id` es load-bearing para la decisión; el resto viaja para
 * el ensamblado posterior (no se re-lee).
 */
export interface PacienteScopeRow {
  id: string;
  organization_id: string;
}

export type ScopeVerdict =
  | { ok: true }
  | { ok: false; code: "not_found" | "forbidden"; message: string };

/**
 * Decide si una fila de `paciente` (leída bajo RLS, scopeada por org+id) habilita
 * el export para el scope esperado. PURA a propósito — sin I/O — para fijar la
 * invariante anti-IDOR en un test unitario sin mockear Supabase:
 *
 *   - fila ausente (RLS ∅ / paciente de otra org / inexistente) → not_found
 *     (no se filtra la existencia cross-tenant: mismo 404 en todos los casos).
 *   - fila de OTRA org que la esperada → forbidden (defensa en profundidad: la
 *     query ya filtró por org, esto atrapa un client mal scopeado o un cambio
 *     futuro que afloje el filtro).
 *   - fila de la org esperada → ok.
 *
 * El `pacienteId` esperado se compara implícitamente: el caller SIEMPRE lee por
 * `.eq("id", pacienteId).eq("organization_id", organizationId)`, así que una fila
 * devuelta ya matchea el id; lo que reafirmamos acá es la coherencia de org.
 */
export function assertPacienteScope(
  row: PacienteScopeRow | null | undefined,
  expectedOrganizationId: string,
): ScopeVerdict {
  if (!row) {
    return { ok: false, code: "not_found", message: "Paciente no encontrado." };
  }
  if (row.organization_id !== expectedOrganizationId) {
    return {
      ok: false,
      code: "forbidden",
      message: "El paciente no pertenece a tu organización.",
    };
  }
  return { ok: true };
}

// ─── Shape del export ────────────────────────────────────────────────────────

export interface PatientExportIdentidad {
  nombre: string | null;
  apellido: string | null;
  tipo_doc: string | null;
  numero_doc: string | null;
  email: string | null;
  telefono: string | null;
  fecha_nacimiento: string | null;
  sexo_biologico: string | null;
  genero_autopercibido: string | null;
  domicilio_calle: string | null;
  domicilio_numero: string | null;
  domicilio_ciudad: string | null;
  domicilio_provincia: string | null;
  domicilio_cp: string | null;
}

export interface PatientExportTurno {
  id: string;
  inicio: string;
  duracion_min: number;
  estado: string;
  modalidad: string | null;
}

export interface PatientExportConsentimiento {
  id: string;
  tipo: string;
  firmado_en: string;
  revocado_en: string | null;
  plantilla_titulo: string | null;
  plantilla_version: string | null;
}

export interface PatientExportResumenClinico {
  /** Motivo de consulta que el propio paciente declaró (PHI declarada por él). */
  motivo_consulta: string | null;
  /** Especialidades con intake avanzado cargado (metadata, NO el contenido). */
  especialidades_con_intake: string[];
  sesiones_registradas: number;
}

export interface PatientExport {
  ok: true;
  exported_at: string;
  exported_by: "profesional";
  ley_25326_basis: string;
  privacy_policy_version: string;
  terms_version: string;
  organizacion: { id: string; nombre: string | null };
  paciente: {
    id: string;
    identidad: PatientExportIdentidad | null;
    resumen_clinico: PatientExportResumenClinico;
  };
  turnos: PatientExportTurno[];
  consentimientos: PatientExportConsentimiento[];
  notas: string[];
}

// ─── Filas crudas (lo que se lee de la DB) ───────────────────────────────────

interface PacienteCompletoRow {
  id: string;
  organization_id: string;
  motivo_consulta_cifrado: string | Buffer | null;
  nombre_cifrado: string | Buffer | null;
  apellido_cifrado: string | Buffer | null;
  numero_doc_cifrado: string | Buffer | null;
  tipo_doc: string | null;
  email_cifrado: string | Buffer | null;
  telefono_cifrado: string | Buffer | null;
  domicilio_calle_cifrado: string | Buffer | null;
  domicilio_numero_cifrado: string | Buffer | null;
  fecha_nacimiento: string | null;
  sexo_biologico: string | null;
  genero_autopercibido: string | null;
  domicilio_ciudad: string | null;
  domicilio_provincia: string | null;
  domicilio_cp: string | null;
}

// ─── Assembler ───────────────────────────────────────────────────────────────

export interface BuildPatientExportInput {
  /** Client Supabase ya autenticado (RLS del profesional). */
  supabase: Supa;
  /** Org activa de la sesión del profesional. NUNCA del input del cliente. */
  organizationId: string;
  /** Nombre de la org (para el membrete del export). Opcional. */
  organizationNombre?: string | null;
  /** Paciente objetivo. Ya validado como uuid por el caller (route). */
  pacienteId: string;
}

/**
 * Arma el export ARCO de un paciente. Devuelve `Result` (contrato lib/db):
 *   - not_found  → el paciente no existe / RLS no lo deja ver / otra org.
 *   - forbidden  → coherencia de org falló (defensa en profundidad).
 *   - db_error   → error de Postgres al leer.
 *
 * Toda PII/PHI se descifra SERVER-SIDE con tryDecrypt (un ciphertext corrupto
 * degrada ese campo a null en vez de tirar el export entero). El SOAP crudo NO
 * se toca. Los turnos/consentimientos/intake se leen SIEMPRE scopeados por
 * (org, paciente_id) — anti-IDOR.
 */
export async function buildPatientExport(
  input: BuildPatientExportInput,
): Promise<Result<PatientExport>> {
  const { supabase, organizationId, pacienteId } = input;

  // 1. Paciente (PII + PHI) vía paciente_completo (security_invoker → RLS del
  //    profesional). Scope DOBLE: por id Y por org — nunca por input del cliente.
  const { data: pacienteRaw, error: pacErr } = await supabase
    .from("paciente_completo")
    .select(
      "id, organization_id, motivo_consulta_cifrado, nombre_cifrado, apellido_cifrado, " +
        "numero_doc_cifrado, tipo_doc, email_cifrado, telefono_cifrado, " +
        "domicilio_calle_cifrado, domicilio_numero_cifrado, fecha_nacimiento, " +
        "sexo_biologico, genero_autopercibido, domicilio_ciudad, domicilio_provincia, domicilio_cp",
    )
    .eq("id", pacienteId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (pacErr) {
    const mapped = mapSupabaseError(pacErr);
    return err(mapped.code, mapped.message, pacErr.message);
  }

  // Reafirma el scope (anti-IDOR, defensa en profundidad sobre la RLS + el .eq).
  const scope = assertPacienteScope(
    pacienteRaw as PacienteScopeRow | null,
    organizationId,
  );
  if (!scope.ok) {
    return err(scope.code, scope.message);
  }
  const p = pacienteRaw as unknown as PacienteCompletoRow;

  // 2. Turnos del paciente (scopeados por org + paciente_id). Sin PHI: sólo
  //    fecha, duración, estado, modalidad — metadata de la atención.
  const { data: turnosRaw } = await supabase
    .from("turno")
    .select("id, inicio, duracion_min, estado, modalidad")
    .eq("organization_id", organizationId)
    .eq("paciente_id", pacienteId)
    .order("inicio", { ascending: false });

  // 3. Consentimientos firmados (scopeados por org + paciente_id). El archivo de
  //    firma NO se incluye (es un binario en Storage); sí su metadata legal.
  const { data: consentimientosRaw } = await supabase
    .from("consentimiento")
    .select(
      "id, tipo, firmado_en, revocado_en, plantilla:plantilla_consentimiento(titulo, version)",
    )
    .eq("organization_id", organizationId)
    .eq("paciente_id", pacienteId)
    .order("firmado_en", { ascending: false });

  // 4. Metadata de intake avanzado (qué especialidades tienen ficha cargada — NO
  //    el contenido cifrado). Scope por org + paciente_id.
  const { data: intakeRaw } = await supabase
    .from("paciente_intake_avanzado")
    .select("especialidad")
    .eq("organization_id", organizationId)
    .eq("paciente_id", pacienteId);

  // 5. Conteo de sesiones registradas (metadata; el contenido SOAP NUNCA se
  //    exporta). count exact + head → no trae filas ni PHI.
  const { count: sesionesCount } = await supabase
    .from("sesion")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("paciente_id", pacienteId);

  const identidad: PatientExportIdentidad = {
    nombre: tryDecrypt(p.nombre_cifrado, "patient-export.nombre"),
    apellido: tryDecrypt(p.apellido_cifrado, "patient-export.apellido"),
    tipo_doc: p.tipo_doc ?? null,
    numero_doc: tryDecrypt(p.numero_doc_cifrado, "patient-export.numero_doc"),
    email: tryDecrypt(p.email_cifrado, "patient-export.email"),
    telefono: tryDecrypt(p.telefono_cifrado, "patient-export.telefono"),
    fecha_nacimiento: p.fecha_nacimiento,
    sexo_biologico: p.sexo_biologico,
    genero_autopercibido: p.genero_autopercibido,
    domicilio_calle: tryDecrypt(p.domicilio_calle_cifrado, "patient-export.domicilio_calle"),
    domicilio_numero: tryDecrypt(p.domicilio_numero_cifrado, "patient-export.domicilio_numero"),
    domicilio_ciudad: p.domicilio_ciudad,
    domicilio_provincia: p.domicilio_provincia,
    domicilio_cp: p.domicilio_cp,
  };

  const turnos: PatientExportTurno[] = (turnosRaw ?? []).map(
    (t: Record<string, unknown>) => ({
      id: String(t.id),
      inicio: String(t.inicio),
      duracion_min: Number(t.duracion_min ?? 0),
      estado: String(t.estado),
      modalidad: (t.modalidad as string | null) ?? null,
    }),
  );

  const consentimientos: PatientExportConsentimiento[] = (consentimientosRaw ?? []).map(
    (c: Record<string, unknown>) => {
      // PostgREST devuelve el embed como objeto o (defensivamente) array.
      const plantilla = normalizeEmbedded(c.plantilla) as
        | { titulo?: string | null; version?: string | null }
        | null;
      return {
        id: String(c.id),
        tipo: String(c.tipo),
        firmado_en: String(c.firmado_en),
        revocado_en: (c.revocado_en as string | null) ?? null,
        plantilla_titulo: plantilla?.titulo ?? null,
        plantilla_version: plantilla?.version ?? null,
      };
    },
  );

  const especialidadesConIntake = Array.from(
    new Set(
      (intakeRaw ?? [])
        .map((r: Record<string, unknown>) => String(r.especialidad))
        .filter((s: string) => s.length > 0),
    ),
  ).sort();

  const resumenClinico: PatientExportResumenClinico = {
    // El motivo de consulta lo declaró el propio paciente en el alta → es dato
    // personal suyo, apto para el export. NO es SOAP narrativo del profesional.
    motivo_consulta: tryDecrypt(p.motivo_consulta_cifrado, "patient-export.motivo_consulta"),
    especialidades_con_intake: especialidadesConIntake,
    sesiones_registradas: sesionesCount ?? 0,
  };

  return ok({
    ok: true,
    exported_at: new Date().toISOString(),
    exported_by: "profesional",
    ley_25326_basis: "art. 14 (derecho de acceso del titular) — art. 16 (portabilidad)",
    privacy_policy_version: PRIVACY_VERSION,
    terms_version: TERMS_VERSION,
    organizacion: { id: organizationId, nombre: input.organizationNombre ?? null },
    paciente: {
      id: pacienteId,
      identidad,
      resumen_clinico: resumenClinico,
    },
    turnos,
    consentimientos,
    notas: [
      "Este export contiene los datos personales del paciente titular bajo Ley 25.326.",
      "Fue generado por el profesional tratante a pedido del paciente (derecho de acceso, art. 14).",
      "La historia clínica narrativa (evolución/SOAP) es dato del profesional en su rol de responsable del tratamiento y no se incluye en bruto; el resumen contiene sólo el motivo de consulta declarado por el paciente y metadata de la atención.",
      "Los archivos de firma de los consentimientos se conservan por el profesional (Ley 26.529, retención 10 años) y pueden solicitarse por separado.",
      `Ante dudas o para ejercer rectificación/supresión, el paciente puede contactar a su profesional tratante o, subsidiariamente, a ${SUPPORT_EMAIL}.`,
    ],
  });
}

/**
 * Normaliza un embed de PostgREST que puede venir como objeto único o como array
 * de un elemento (depende de la cardinalidad inferida). Devuelve el objeto o null.
 */
function normalizeEmbedded(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null;
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return null;
}
