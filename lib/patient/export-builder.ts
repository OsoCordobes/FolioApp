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
 * La entrega clínica mediada por el profesional incluye las sesiones originales,
 * notas y enmiendas. El portal mantiene su alcance de entrega hasta completar
 * la verificación de identidad/representación y la revisión clínica correspondiente.
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
import { readCompleteCollection } from "@/lib/db/complete-collection";
import { buildClinicalExport, type ClinicalExport } from "./clinical-export";
import { clinicalManifest, CLINICAL_EXPORT_FORMAT_VERSION } from "./export-manifest";

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
  format_version?: typeof CLINICAL_EXPORT_FORMAT_VERSION;
  manifest?: ReturnType<typeof clinicalManifest>;
  historia_clinica?: ClinicalExport;
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
  /** Set only at the existing authorized professional-mediated endpoint. */
  clinicalHistory?: "professional-reviewed";
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
 * Toda PII/PHI se descifra SERVER-SIDE. El contenido clínico ilegible aborta
 * la entrega clínica. Los turnos/consentimientos/intake se leen scopeados por
 * (org, paciente_id) — anti-IDOR.
 */
export async function buildPatientExport(
  input: BuildPatientExportInput,
): Promise<Result<PatientExport>> {
  const { supabase, organizationId, pacienteId } = input;
  const lecturaIniciada = new Date().toISOString();

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

  // NOTA [audit-fixes · ALTO-3]: este es un documento con VALOR LEGAL (Ley 25.326
  // art. 14). Un fallo de DB en cualquiera de las secciones NO puede degradar a
  // "vacío" y presentarse como completo — sería entregar un export incompleto
  // como si fuera el paquete total del titular. Por eso cada query chequea `error`
  // y aborta con err(): mejor un fallo explícito que un documento legal mudo.

  // 2. Turnos del paciente (scopeados por org + paciente_id). Sin PHI: sólo
  //    fecha, duración, estado, modalidad — metadata de la atención.
  const { data: turnosRaw, error: turnosErr } = await readCompleteCollection<PatientExportTurno>((from, to) => supabase
    .from("turno").select("id, inicio, duracion_min, estado, modalidad", { count: "exact" })
    .eq("organization_id", organizationId).eq("paciente_id", pacienteId)
    .order("inicio", { ascending: false }).order("id", { ascending: false }).range(from, to));
  if (turnosErr) {
    const mapped = mapSupabaseError(turnosErr);
    return err(mapped.code, mapped.message, turnosErr.message);
  }

  // 3. Consentimientos firmados (scopeados por org + paciente_id). El archivo de
  //    firma NO se incluye (es un binario en Storage); sí su metadata legal.
  const { data: consentimientosRaw, error: consentErr } = await readCompleteCollection<{ id: string } & Record<string, unknown>>((from, to) => supabase
    .from("consentimiento")
    .select("id, tipo, firmado_en, revocado_en, plantilla:plantilla_consentimiento(titulo, version)", { count: "exact" })
    .eq("organization_id", organizationId).eq("paciente_id", pacienteId)
    .order("firmado_en", { ascending: false }).order("id", { ascending: false }).range(from, to));
  if (consentErr) {
    const mapped = mapSupabaseError(consentErr);
    return err(mapped.code, mapped.message, consentErr.message);
  }

  // 4. Metadata de intake avanzado (qué especialidades tienen ficha cargada — NO
  //    el contenido cifrado). Scope por org + paciente_id.
  const { data: intakeRaw, error: intakeErr } = await readCompleteCollection<{ id: string; especialidad: string }>((from, to) => supabase
    .from("paciente_intake_avanzado").select("id, especialidad", { count: "exact" })
    .eq("organization_id", organizationId).eq("paciente_id", pacienteId)
    .order("id", { ascending: true }).range(from, to));
  if (intakeErr) {
    const mapped = mapSupabaseError(intakeErr);
    return err(mapped.code, mapped.message, intakeErr.message);
  }

  // 5. Conteo exacto de sesiones; la entrega clínica carga luego sus originales.
  const { count: sesionesCount, error: sesionesErr } = await supabase
    .from("sesion")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("paciente_id", pacienteId);
  if (sesionesErr || sesionesCount === null) {
    if (!sesionesErr) return err("db_error", "No se pudo verificar la cantidad de sesiones.");
    const mapped = mapSupabaseError(sesionesErr);
    return err(mapped.code, mapped.message, sesionesErr.message);
  }

  let historiaClinica: ClinicalExport | undefined;
  if (input.clinicalHistory === "professional-reviewed") {
    const clinical = await buildClinicalExport(supabase, organizationId, pacienteId);
    if (!clinical.ok) return clinical;
    historiaClinica = clinical.data;
  }

  let unreadablePatientField = false;
  const decodePatient = (value: string | Buffer | null, context: string) => {
    const plain = tryDecrypt(value, context);
    if (value != null && plain === null) unreadablePatientField = true;
    return plain;
  };

  const identidad: PatientExportIdentidad = {
    nombre: decodePatient(p.nombre_cifrado, "patient-export.nombre"),
    apellido: decodePatient(p.apellido_cifrado, "patient-export.apellido"),
    tipo_doc: p.tipo_doc ?? null,
    numero_doc: decodePatient(p.numero_doc_cifrado, "patient-export.numero_doc"),
    email: decodePatient(p.email_cifrado, "patient-export.email"),
    telefono: decodePatient(p.telefono_cifrado, "patient-export.telefono"),
    fecha_nacimiento: p.fecha_nacimiento,
    sexo_biologico: p.sexo_biologico,
    genero_autopercibido: p.genero_autopercibido,
    domicilio_calle: decodePatient(p.domicilio_calle_cifrado, "patient-export.domicilio_calle"),
    domicilio_numero: decodePatient(p.domicilio_numero_cifrado, "patient-export.domicilio_numero"),
    domicilio_ciudad: p.domicilio_ciudad,
    domicilio_provincia: p.domicilio_provincia,
    domicilio_cp: p.domicilio_cp,
  };

  const turnos: PatientExportTurno[] = (turnosRaw ?? []).map(
    (t) => ({
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
    motivo_consulta: decodePatient(p.motivo_consulta_cifrado, "patient-export.motivo_consulta"),
    especialidades_con_intake: especialidadesConIntake,
    sesiones_registradas: historiaClinica?.sesiones.length ?? sesionesCount ?? 0,
  };

  if (historiaClinica && unreadablePatientField) {
    return err("db_error", "No se pudo descifrar parte de la ficha. No se generó un archivo incompleto.");
  }

  if (historiaClinica) {
    const finalScope = await supabase.from("paciente_completo").select("id, organization_id")
      .eq("id", pacienteId).eq("organization_id", organizationId).maybeSingle();
    if (finalScope.error || finalScope.data?.id !== pacienteId || finalScope.data?.organization_id !== organizationId) {
      return err("forbidden", "No se pudo confirmar el acceso al paciente al finalizar la entrega.");
    }
  }

  return ok({
    ok: true,
    ...(historiaClinica ? { historia_clinica: historiaClinica, format_version: CLINICAL_EXPORT_FORMAT_VERSION,
      manifest: clinicalManifest(historiaClinica, lecturaIniciada, new Date().toISOString()) } : {}),
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
      historiaClinica
        ? "Incluye sesiones originales, enmiendas, notas, intake, respuestas y resultados originales de instrumentos e inventario autorizado de documentos y evidencia de consentimientos. Consultá el manifiesto de alcance; no es un archivo completo restaurable."
        : "Esta entrega del portal contiene datos personales y un resumen. La copia clínica con evolución y enmiendas se solicita al profesional mediante el circuito de entrega autorizado.",
      "Los bytes de documentos y firmas no están incluidos. Los enlaces disponibles requieren sesión y permisos vigentes; la descarga y verificación de esos archivos quedan pendientes.",
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
