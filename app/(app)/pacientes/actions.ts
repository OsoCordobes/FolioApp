"use server";

/**
 * Folio · /pacientes · Server Actions.
 *
 * Wrapper de `createPaciente` (lib/db/pacientes.ts) con revalidación de la
 * ruta /pacientes después del insert. Permite crear pacientes standalone
 * desde el directorio (sin un turno asociado), complementando el flow
 * walk-in en /hoy y la confirmación de pedidos en /calendario.
 *
 * También persiste el borrador clínico del tab Plan de la ficha
 * (`saveSesionFichaAction`): slot de especialidad + SOAP → upsertSesion
 * (writer único de sesion.tool_id / tool_data_cifrado, M50).
 */

import { listRepresentaciones } from "@/lib/db/representaciones";
import { uploadReviewedConsent } from "@/lib/consentimientos/signature-upload";
import { capabilitiesFor } from "@/lib/auth/capabilities";
import { CLINICAL_BUCKET, CLINICAL_UPLOAD_MAX_BYTES, inspectClinicalFile } from "@/lib/storage/clinical-files";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  elegirPlantillasVigentes,
  mapConsentimientoRow,
  type ConsentimientoListItem,
  type PlantillaConsentimientoRow,
  type PlantillaVigente,
  type TutorOption,
} from "@/lib/consentimientos/helpers";
import { getActiveContext } from "@/lib/db/active-context";
import { getFichaTimeline } from "@/lib/db/ficha-timeline";
import type { EventoTimeline } from "@/lib/ficha/timeline-core";
import { addNotaClinica } from "@/lib/db/notas-clinicas";
import { updatePacienteContacto, type UpdatePacienteContactoInput } from "@/lib/db/pacientes";
import {
  getSignedFirmaUrl,
  listConsentimientosPaciente,
  revokeConsentimiento,
} from "@/lib/db/consentimientos";
import {
  buildDocumentoStoragePath,
  createDocumentoClinico,
  listDocumentosPaciente,
  getDocumentoDownloadUrl,
  TIPO_DOCUMENTO,
  type TipoDocumento,
} from "@/lib/db/documentos";
import { listRespuestasPaciente, saveRespuesta } from "@/lib/db/instrumentos";
import { savePacienteIntakeAvanzado } from "@/lib/db/paciente-intake";
import { createPaciente, updatePacienteCobertura } from "@/lib/db/pacientes";
import { savePlanTratamiento } from "@/lib/db/plan-tratamiento";
import { getActiveSession } from "@/lib/db/session";
import { addEnmienda, sesionPerteneceAPaciente, upsertSesion, readClinicalSessionRevision } from "@/lib/db/sesiones";
import { transitionTurno } from "@/lib/db/turnos";
import { err, ok, type Result } from "@/lib/db/errors";
import { buildUpsertSesionInput } from "@/lib/especialidades/draft";
import { ESPECIALIDAD_SLUGS } from "@/lib/especialidades/meta";
import {
  CSSRS_INSTRUMENTO_ID,
  CSSRS_ITEMS_LEN,
} from "@/lib/especialidades/psicologia/schema";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";

const createPacienteActionSchema = z.object({
  nombre: z.string().min(1).max(80),
  apellido: z.string().min(1).max(80),
  telefono: z.string().min(6).max(30),
  email: z.string().email().optional().or(z.literal("")),
  // M59 · campos comunes de intake (el form los pide requeridos, pero el schema
  // los acepta vacíos para no romper otros callers de la action).
  fechaNacimiento: z.string().date().optional().or(z.literal("")),
  // Lugar de residencia del form → domicilio_ciudad.
  domicilioCiudad: z.string().max(60).optional().or(z.literal("")),
  domicilioProvincia: z.string().max(60).optional().or(z.literal("")),
  ocupacion: z.string().max(120).optional().or(z.literal("")),
  recomendadoPor: z.string().max(120).optional().or(z.literal("")),
  motivoConsulta: z.string().max(2000).optional().or(z.literal("")),
  tipoDoc: z.enum(["DNI", "LE", "LC", "CI", "PASAPORTE"]).optional(),
  // Alineado con el writer (lib/db/pacientes.ts min(5)): un documento de 1–4
  // caracteres daba un "Datos inválidos" genérico recién en el writer (audit L5).
  // Vacío sigue permitido (el documento es opcional).
  numeroDoc: z.string().min(5, "El documento debe tener al menos 5 caracteres.").max(20).optional().or(z.literal("")),
  // F7a (M89) · cobertura del paciente (obra social/prepaga). Opcionales y
  // tolerantes a "" (el form manda strings vacíos). Límites del dominio en
  // lib/pacientes/cobertura.ts; el writer normaliza y cifra el nº de afiliado.
  coberturaNombre: z.string().max(120).optional().or(z.literal("")),
  coberturaPlan: z.string().max(40).optional().or(z.literal("")),
  coberturaNroAfiliado: z.string().max(40).optional().or(z.literal("")),
  // Workstream 5 · intake avanzado por especialidad (opcional). El shape de
  // `datos` lo valida el writer contra el schema de la especialidad.
  intakeAvanzado: z
    .object({
      especialidad: z.enum(ESPECIALIDAD_SLUGS),
      datos: z.record(z.string(), z.unknown()),
    })
    .optional(),
});

export type CreatePacienteActionInput = z.infer<typeof createPacienteActionSchema>;

const emptyToUndef = (v: string | undefined): string | undefined =>
  v && v.length > 0 ? v : undefined;

export async function createPacienteAction(
  input: CreatePacienteActionInput,
): Promise<Result<{ id: string }>> {
  const parsed = createPacienteActionSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos del paciente inválidos.", parsed.error.message);
  }
  const d = parsed.data;

  const result = await createPaciente({
    nombre: d.nombre,
    apellido: d.apellido,
    telefono: d.telefono,
    email: emptyToUndef(d.email),
    fechaNacimiento: emptyToUndef(d.fechaNacimiento),
    domicilioCiudad: emptyToUndef(d.domicilioCiudad),
    domicilioProvincia: emptyToUndef(d.domicilioProvincia),
    ocupacion: emptyToUndef(d.ocupacion),
    recomendadoPor: emptyToUndef(d.recomendadoPor),
    motivoConsulta: emptyToUndef(d.motivoConsulta),
    tipoDoc: d.tipoDoc ?? "DNI",
    numeroDoc: emptyToUndef(d.numeroDoc),
    coberturaNombre: emptyToUndef(d.coberturaNombre),
    coberturaPlan: emptyToUndef(d.coberturaPlan),
    coberturaNroAfiliado: emptyToUndef(d.coberturaNroAfiliado),
    tags: [],
    intakeAvanzado: d.intakeAvanzado,
  });

  if (!result.ok) return result;

  revalidatePath("/pacientes");
  return ok({ id: result.data.id });
}

// ─── Guardar cobertura desde la ficha (tab Información) — F7a, M89 ────────────

const saveCoberturaSchema = z.object({
  pacienteId: z.string().uuid(),
  // Tolerantes a "" (vaciar un campo = borrar el valor → NULL en DB).
  coberturaNombre: z.string().max(120).optional().or(z.literal("")),
  coberturaPlan: z.string().max(40).optional().or(z.literal("")),
  coberturaNroAfiliado: z.string().max(40).optional().or(z.literal("")),
});

export type SaveCoberturaActionInput = z.infer<typeof saveCoberturaSchema>;

/**
 * Persiste la cobertura (obra social/prepaga + plan + nº de afiliado) del
 * paciente desde el modal de edición de la ficha. El writer normaliza
 * ("Particular"/vacío → NULL) y cifra el nº de afiliado (M89).
 */
export async function savePacienteCoberturaAction(
  input: SaveCoberturaActionInput,
): Promise<Result<{ identidadId: string }>> {
  const parsed = saveCoberturaSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos de cobertura inválidos.", parsed.error.message);
  }

  const result = await updatePacienteCobertura({
    pacienteId: parsed.data.pacienteId,
    coberturaNombre: parsed.data.coberturaNombre,
    coberturaPlan: parsed.data.coberturaPlan,
    coberturaNroAfiliado: parsed.data.coberturaNroAfiliado,
  });
  if (!result.ok) return result;

  // La vuelta: la ficha y el directorio (columna/filtro Cobertura) se refrescan.
  revalidatePath(`/pacientes/${parsed.data.pacienteId}`);
  revalidatePath("/pacientes");
  return result;
}

// ─── Guardar intake avanzado desde la ficha (tab Información) ─────────────────

const saveIntakeAvanzadoSchema = z.object({
  pacienteId: z.string().uuid(),
  especialidad: z.enum(ESPECIALIDAD_SLUGS),
  datos: z.record(z.string(), z.unknown()),
});

export type SaveIntakeAvanzadoActionInput = z.infer<typeof saveIntakeAvanzadoSchema>;

/**
 * Persiste el intake avanzado de una especialidad desde el modal de edición de
 * la ficha (1:1 por paciente+especialidad, M60). El writer valida `datos`
 * contra el schema de la especialidad y cifra el JSON server-side. Tenancy y
 * coherencia los cubren la RLS + el trigger same-org en DB.
 */
export async function savePacienteIntakeAvanzadoAction(
  input: SaveIntakeAvanzadoActionInput,
): Promise<Result<{ id: string }>> {
  const parsed = saveIntakeAvanzadoSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos del intake avanzado inválidos.", parsed.error.message);
  }

  const result = await savePacienteIntakeAvanzado({
    pacienteId: parsed.data.pacienteId,
    especialidad: parsed.data.especialidad,
    datos: parsed.data.datos,
  });
  if (!result.ok) return result;

  // La vuelta: la ficha re-renderiza la sección avanzada con los valores nuevos.
  revalidatePath("/pacientes/[id]");
  revalidatePath(`/pacientes/${parsed.data.pacienteId}`);
  return ok({ id: result.data.id });
}

// ─── Registrar el screener C-SSRS en el historial de riesgo (C7) ─────────────
//
// El workflow de riesgo suicida de psicología (Tool, tab Plan) documenta el
// plan de crisis en el toolData de la sesión (cifrado, viaja con el SOAP). Este
// action, ADEMÁS, registra el screener C-SSRS en instrumento_respuesta (C2) para
// el TRACKING LONGITUDINAL del riesgo — una serie de bandas independiente del
// SOAP, base del dashboard de outcomes (C8). Se persiste una fila POR aplicación
// (append-only): el profesional lo dispara explícitamente al completar el
// screener, no en cada guardado de la sesión (evita duplicados por re-save).
//
// El scoring canónico se recomputa server-side en saveRespuesta (nunca se
// confía en un score del cliente); acá solo se validan pacienteId/turnoId y las
// 6 respuestas 0/1. Tenancy: paciente ∈ org activa (guard IDOR) + RLS +
// trigger same-org de instrumento_respuesta (M73).

const registrarCssrsSchema = z.object({
  pacienteId: z.string().uuid(),
  /** Turno en curso (opcional): resuelve la sesion_id para atar la aplicación. */
  turnoId: z.string().uuid().optional().nullable(),
  /** Screener C-SSRS completo: 6 respuestas 0 (No) / 1 (Sí). */
  cssrs: z.array(z.number().int().min(0).max(1)).length(CSSRS_ITEMS_LEN),
});

export type RegistrarCssrsActionInput = z.infer<typeof registrarCssrsSchema>;

/**
 * Registra una aplicación del screener C-SSRS en instrumento_respuesta (C2) para
 * el tracking longitudinal del riesgo. Si hay un turno en curso con sesión
 * guardada, la aplicación se ata a esa sesión; si no, se guarda como aplicación
 * suelta (sesion_id NULL) — sigue siendo parte de la HC del paciente.
 */
export async function registrarCssrsAction(
  input: RegistrarCssrsActionInput,
): Promise<Result<{ id: string }>> {
  const parsed = registrarCssrsSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos del C-SSRS inválidos.", parsed.error.message);
  }
  const d = parsed.data;

  const session = await getActiveSession();
  if (!session.ok) return session;
  const organizationId = session.data.organizationId;

  const supabase = await createSupabaseServerClient();

  // F-AUTH (IDOR): paciente ∈ org activa. Mismo guard que los vecinos — no se
  // confía en ids del cliente. La RLS de instrumento_respuesta + el trigger
  // same-org (M73) son la última línea.
  const { data: pacienteRow, error: pacienteErr } = await supabase
    .from("paciente")
    .select("id")
    .eq("id", d.pacienteId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (pacienteErr) {
    return err("db_error", "No pudimos validar el paciente.", pacienteErr.message);
  }
  if (!pacienteRow) {
    return err("forbidden", "Ese paciente no pertenece a tu organización.");
  }

  // Resuelve la sesion del turno en curso (best-effort): la aplicación se ata a
  // ella si existe. El SELECT es org-scoped + valida turno↔paciente para que un
  // turno ajeno no ate la respuesta a una sesión de otro paciente/tenant.
  let sesionId: string | null = null;
  if (d.turnoId) {
    const { data: sesionRow } = await supabase
      .from("sesion")
      .select("id")
      .eq("turno_id", d.turnoId)
      .eq("organization_id", organizationId)
      .eq("paciente_id", d.pacienteId)
      .maybeSingle();
    sesionId = (sesionRow as { id: string } | null)?.id ?? null;
  }

  const result = await saveRespuesta({
    pacienteId: d.pacienteId,
    sesionId,
    instrumentoId: CSSRS_INSTRUMENTO_ID,
    respuestas: d.cssrs,
    completadoPor: "profesional",
  });
  if (!result.ok) return result;

  // La vuelta: la serie longitudinal de riesgo de la ficha trae la aplicación nueva.
  revalidatePath(`/pacientes/${d.pacienteId}`);
  return ok({ id: result.data.id });
}

// ─── Dashboard de outcomes de psicología (C8) ────────────────────────────────
//
// El dashboard de la Tool de psicología (psicologia/dashboard.tsx) grafica las
// series de instrumento_respuesta (PHQ-9/GAD-7/DASS-21/PCL-5 en el tiempo). Esta
// action expone SOLO el snapshot no-PHI que el dashboard necesita
// (instrumentoId + scoreTotal + createdAt) — NUNCA las respuestas crudas
// descifradas. La tenancy la cubre listRespuestasPaciente, que ya filtra por la
// org activa (organization_id de la sesión) además de la RLS + rol clínico.

/** Punto de serie de un instrumento para el dashboard (score en claro, no-PHI). */
export interface OutcomeSeriePunto {
  instrumentoId: string;
  scoreTotal: number | null;
  createdAt: string;
}

/**
 * Serie de instrumentos de un paciente para el dashboard de outcomes: devuelve
 * solo { instrumentoId, scoreTotal, createdAt } — el score ya viene en claro del
 * snapshot (C2), así que no se descifra ni viaja PHI al cliente. Filtra al set de
 * salud mental del dashboard (PHQ-9/GAD-7/DASS-21/PCL-5) server-side para no
 * mandar filas de otros dominios (p. ej. el C-SSRS de riesgo, que tiene su propia
 * vista). RLS + rol clínico son la barrera real.
 */
export async function listOutcomeSeriesAction(
  pacienteId: string,
): Promise<Result<OutcomeSeriePunto[]>> {
  if (!z.string().uuid().safeParse(pacienteId).success) {
    return err("validation", "ID de paciente inválido.");
  }

  const { OUTCOME_INSTRUMENTOS, familiaInstrumento } = await import(
    "@/lib/especialidades/psicologia/schema"
  );
  const familias = new Set(OUTCOME_INSTRUMENTOS.map((o) => o.key));

  const result = await listRespuestasPaciente(pacienteId);
  if (!result.ok) return result;

  const puntos: OutcomeSeriePunto[] = result.data
    .filter((r) => familias.has(familiaInstrumento(r.instrumentoId)))
    .map((r) => ({
      instrumentoId: r.instrumentoId,
      scoreTotal: r.scoreTotal,
      createdAt: r.createdAt,
    }));
  return ok(puntos);
}

// ─── Guardar sesión desde la ficha (tab Plan) ───────────────────────────────

const saveSesionFichaSchema = z.object({
  turnoId:z.string().uuid(),pacienteId:z.string().uuid(),toolValue:z.unknown().optional(),
  soap:z.object({subjetivo:z.string().max(5000),objetivo:z.string().max(5000),analisis:z.string().max(5000),plan:z.string().max(5000)}),
  autosave:z.boolean().optional(),revisionEsperada:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1),operacionId:z.string().uuid(),
});
export type SaveSesionFichaActionInput=z.infer<typeof saveSesionFichaSchema>;
export interface SaveSesionFichaResult {sesionId:string;revision:number;updatedAt:string;operationId:string;cerrado:boolean}
export interface SaveSesionYCerrarResult extends SaveSesionFichaResult {aviso?:string}

/** One database transaction owns the clinical revision and optional state change.
 * Network uncertainty preserves the operation ID so its receipt can be recovered. */
export async function saveSesionFichaAction(input:SaveSesionFichaActionInput):Promise<Result<SaveSesionFichaResult>>{
  const parsed=saveSesionFichaSchema.safeParse(input);
  if(!parsed.success)return err("validation","Falta una revisión válida del borrador. Conservá lo escrito antes de recargar.");
  try{
    const v=parsed.data;
    const result=await upsertSesion(buildUpsertSesionInput({...v,toolValue:v.toolValue??null,intencion:v.autosave?"AUTOSAVE":"SAVE"}));
    if(!result.ok)return result;
    revalidatePath(`/pacientes/${v.pacienteId}`);if(!v.autosave)revalidatePath("/hoy");
    return ok({sesionId:result.data.id,revision:result.data.revision,updatedAt:result.data.updatedAt,operationId:result.data.operationId,cerrado:result.data.closed});
  }catch{return err("network","No pudimos confirmar la respuesta. Conservá el borrador y reintentá la misma operación.");}
}

export async function saveSesionYCerrarAction(input:SaveSesionFichaActionInput):Promise<Result<SaveSesionYCerrarResult>>{
  const parsed=saveSesionFichaSchema.safeParse(input);
  if(!parsed.success)return err("validation","Falta una revisión válida del borrador. No se solicitó el cierre.");
  try{
    const v=parsed.data;
    const result=await upsertSesion(buildUpsertSesionInput({...v,toolValue:v.toolValue??null,intencion:"CLOSE"}));
    if(!result.ok)return result;
    // Core close and immutable original already committed atomically. Reuse the
    // existing idempotent scheduling/payment follow-ups; their failure cannot
    // turn the successful clinical close into a misleading failed-save result.
    let aviso:string|undefined;
    try{const followup=await transitionTurno({turnoId:v.turnoId,to:"CERRADO"});
      if(!followup.ok||followup.data.pagoRegistrado===false)aviso="La atención quedó guardada y cerrada. Revisá las gestiones posteriores y el registro del cobro en la agenda.";
    }catch{aviso="La atención quedó guardada y cerrada. No pudimos confirmar las gestiones posteriores; revisalas en la agenda.";}
    revalidatePath("/hoy");revalidatePath(`/pacientes/${v.pacienteId}`);
    return ok({sesionId:result.data.id,revision:result.data.revision,updatedAt:result.data.updatedAt,operationId:result.data.operationId,cerrado:result.data.closed,...(aviso?{aviso}:{})});
  }catch{return err("network","No pudimos confirmar si se guardó y cerró. Conservá el borrador y reintentá la misma operación.");}
}

export async function readClinicalSessionRevisionAction(turnoId:string,pacienteId:string){
  try{return await readClinicalSessionRevision(turnoId,pacienteId);}catch{return err("db_error","No pudimos leer la revisión guardada. El borrador local sigue intacto.");}
}

// ─── Guardar plan de tratamiento (card "Plan de tratamiento") ────────────────

const savePlanTratamientoSchema = z.object({
  pacienteId: z.string().uuid(),
  sesionesObjetivo: z.number().int().min(0).max(1000).nullable(),
  frecuencia: z.string().max(60).nullable(),
  diagnostico: z.string().max(2000).nullable(),
  proximoControl: z.string().date().nullable(),
  notas: z.string().max(5000).nullable(),
});

export type SavePlanTratamientoActionInput = z.infer<typeof savePlanTratamientoSchema>;

/**
 * Persiste los campos editables del plan de tratamiento (1:1 por paciente,
 * M58) — genérico, sin campos por especialidad. `diagnostico` y `notas` son
 * PHI y se cifran en el writer (savePlanTratamiento); el resto es no-PHI.
 * Tenancy/coherencia los cubre la RLS + el trigger same-org en DB.
 */
export async function savePlanTratamientoAction(
  input: SavePlanTratamientoActionInput,
): Promise<Result<{ id: string }>> {
  const parsed = savePlanTratamientoSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos del plan de tratamiento inválidos.", parsed.error.message);
  }

  const result = await savePlanTratamiento(parsed.data);
  if (!result.ok) return result;

  // La vuelta: la ficha re-renderiza el card con los valores recién guardados.
  revalidatePath("/pacientes/[id]");
  revalidatePath(`/pacientes/${parsed.data.pacienteId}`);
  return ok({ id: result.data.id });
}

// ─── Adjuntos clínicos por sesión (documento_clinico, M08) ───────────────────
//
// Un solo core (uploadDocumentoSesion) que sube los bytes server-side al bucket
// privado y registra la fila atada a la sesion del turno en curso. Lo usan:
//   - Radiografías de la Tool quiropraxia (tipo RADIOGRAFIA, Workstream 6).
//   - C6 · adjuntos de estudios de la Tool cardio (tipo INFORME_EXTERNO:
//     ECG/Holter/ergometría escaneados o en PDF).
// El waveform NO se renderiza: el archivo se ABRE por signed URL en la galería.

const DOC_BUCKET = CLINICAL_BUCKET;
const DOC_MAX_BYTES = CLINICAL_UPLOAD_MAX_BYTES;

/**
 * Core compartido: adjunta un documento a la sesión del turno en curso.
 *
 * Reglas (idénticas para radiografías y estudios cardio):
 *   - turno ∈ org activa Y turno.paciente_id == pacienteId (mismo guard IDOR
 *     que upsertSesion — no se confía en IDs del cliente).
 *   - debe existir una sesion para el turno (el documento cuelga de ella): sino
 *     se pide guardar la sesión primero, así el documento queda atado a la visita.
 *   - tipo binario reconocido y tamaño máximo de 4 MiB.
 *
 * PHI: el nombre/descripción no se loguean; el blob vive en el bucket privado y
 * la fila la lee la ficha con signed URLs de vida corta.
 */
async function uploadDocumentoSesion(params: {
  file: unknown;
  pacienteId: string;
  turnoId: string;
  descripcion?: string;
  /**
   * D2 · cualquier tipo del enum M08 salvo FOTO_POSTURAL (exige un
   * consentimiento FOTOS vigente — flujo aparte, el trigger SQL lo valida).
   */
  tipo: Exclude<TipoDocumento, "FOTO_POSTURAL">;
  /** Nombre de la entidad para los mensajes de error ("radiografía"/"estudio"). */
  etiqueta: string;
  /** Filename por defecto si el Blob no trae nombre. */
  fallbackFilename: string;
}): Promise<Result<{ documentoId: string }>> {
  const { file, pacienteId, turnoId, descripcion, tipo, etiqueta } = params;

  try {
  if (!(file instanceof Blob) || file.size === 0) {
    return err("validation", "Adjuntá un archivo válido.");
  }
  if (!z.string().uuid().safeParse(pacienteId).success || !z.string().uuid().safeParse(turnoId).success) {
    return err("validation", `Datos del ${etiqueta} inválidos.`);
  }
  if (file.size > DOC_MAX_BYTES) {
    return err("validation", "El archivo supera el límite de 4 MiB.");
  }
  // Actual bytes determine the content type and generated extension.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const inspected = inspectClinicalFile(bytes);
  if (!inspected.ok) return inspected;
  const mimeType = inspected.data.mime;
  const filename = `documento.${inspected.data.extension}`;

  const ctx = await getActiveContext();
  if (!ctx.ok) return ctx;
  const organizationId = ctx.data.session.organizationId;
  if (!capabilitiesFor(ctx.data.session.role, ctx.data.session.esColegiado).canReadClinical) return err("forbidden", "No tenés acceso a los documentos clínicos.");
  const supabase = await createSupabaseServerClient();
  const patientAccess = await supabase.from("paciente").select("id").eq("id", pacienteId)
    .eq("organization_id", organizationId).is("deleted_at", null).is("pseudonimizado_en", null).maybeSingle();
  if (patientAccess.error) return err("db_error", "No pudimos verificar el acceso al paciente.");
  if (!patientAccess.data) return err("not_found", "Paciente no encontrado.");

  // F-AUTH (IDOR): turno ∈ org activa Y turno↔paciente. Mismo SELECT-guard que
  // upsertSesion/checkTurnoOwnership; resolvemos también la sesion del turno.
  const { data: turnoRow, error: turnoErr } = await supabase
    .from("turno")
    .select("organization_id, paciente_id")
    .eq("id", turnoId)
    .maybeSingle();
  if (turnoErr) return err("db_error", "No pudimos validar el turno.", turnoErr.message);
  const turno = turnoRow as { organization_id: string; paciente_id: string } | null;
  if (!turno || turno.organization_id !== organizationId) {
    return err("forbidden", "Ese turno no pertenece a tu organización.");
  }
  if (turno.paciente_id !== pacienteId) {
    return err("forbidden", "El turno no corresponde a ese paciente.");
  }

  // El documento cuelga de la sesion del turno: si todavía no hay sesión, se
  // pide guardarla primero (el documento siempre queda atado a una visita).
  const { data: sesionRow, error: sesionError } = await supabase
    .from("sesion")
    .select("id")
    .eq("turno_id", turnoId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (sesionError) return err("db_error", "No pudimos verificar la sesión.");
  const sesionId = (sesionRow as { id: string } | null)?.id ?? null;
  if (!sesionId) {
    return err("validation", `Guardá la sesión antes de adjuntar el ${etiqueta}.`);
  }

  // Subida server-side de los bytes al bucket privado. El storage_path canónico
  // (bucket/{org}/{paciente}/{uuid}.{ext}) lo arma buildDocumentoStoragePath;
  // el upload va SIN el prefijo del bucket.
  const storagePath = buildDocumentoStoragePath({ organizationId, pacienteId, filename });
  const pathInBucket = storagePath.replace(/^documentos-clinicos\//, "");
  const service = createSupabaseServiceClient();
  const { error: uploadErr } = await service.storage
    .from(DOC_BUCKET)
    .upload(pathInBucket, bytes, { contentType: mimeType, upsert: false, cacheControl: "0" });
  if (uploadErr) {
    return err("db_error", "No pudimos subir el archivo.", uploadErr.message);
  }

  const created = await createDocumentoClinico({
    pacienteId,
    sesionId,
    tipo,
    storagePath,
    mimeType,
    tamanioBytes: file.size,
    descripcion,
  });
  if (!created.ok) {
    // Only remove this newly generated object when the DB positively confirms
    // no record exists; a lost INSERT response must not delete a committed file.
    const recorded = await service.from("documento_clinico").select("id").eq("storage_path", storagePath).maybeSingle();
    if (!recorded.error && !recorded.data) await service.storage.from(DOC_BUCKET).remove([pathInBucket]);
    return created;
  }

  // La vuelta: la galería de la Tool trae el documento nuevo.
  revalidatePath(`/pacientes/${pacienteId}`);
  return ok({ documentoId: created.data.id });
  } catch {
    return err("network", "No pudimos subir el archivo. Intentá nuevamente.");
  }
}

/**
 * Adjunta una radiografía a la sesión del turno en curso (documento_clinico
 * tipo RADIOGRAFIA, M08). Delega en uploadDocumentoSesion (core compartido).
 */
export async function uploadRadiografiaAction(
  formData: FormData,
): Promise<Result<{ documentoId: string }>> {
  const descripcionRaw = formData.get("descripcion");
  return uploadDocumentoSesion({
    file: formData.get("file"),
    pacienteId: String(formData.get("pacienteId") ?? ""),
    turnoId: String(formData.get("turnoId") ?? ""),
    descripcion:
      typeof descripcionRaw === "string" && descripcionRaw.trim() !== ""
        ? descripcionRaw.trim().slice(0, 2000)
        : undefined,
    tipo: "RADIOGRAFIA",
    etiqueta: "radiografía",
    fallbackFilename: "radiografia.bin",
  });
}

/**
 * C6 · adjunta un estudio cardiológico (ECG/Holter/ergometría escaneado o en
 * PDF) a la sesión del turno en curso, como documento_clinico tipo
 * INFORME_EXTERNO (el enum tipo_documento de M08 no tiene ECG/HOLTER; la
 * categoría clínica fina la lleva el campo `estudios[].tipo` del panel cardio).
 * Delega en uploadDocumentoSesion (mismo core + guards que las radiografías).
 * Waveform: el archivo se ABRE por signed URL — Folio NO renderiza la señal.
 */
export async function uploadEstudioCardioAction(
  formData: FormData,
): Promise<Result<{ documentoId: string }>> {
  const descripcionRaw = formData.get("descripcion");
  return uploadDocumentoSesion({
    file: formData.get("file"),
    pacienteId: String(formData.get("pacienteId") ?? ""),
    turnoId: String(formData.get("turnoId") ?? ""),
    descripcion:
      typeof descripcionRaw === "string" && descripcionRaw.trim() !== ""
        ? descripcionRaw.trim().slice(0, 2000)
        : undefined,
    tipo: "INFORME_EXTERNO",
    etiqueta: "estudio",
    fallbackFilename: "estudio.bin",
  });
}

// ─── Tab Documentos de la ficha (D2 · listado + subida generalizada) ─────────

/** Item plano del tab Documentos (sin ciphertext: descripcion ya descifrada). */
export interface DocumentoFichaItem {
  id: string;
  tipo: TipoDocumento;
  /** YYYY-MM-DD: fecha_estudio ?? created_at. */
  fecha: string;
  descripcion: string | null;
  mimeType: string;
  /** Signed URL de vida corta (5 min) — refrescar al abrir si expiró. */
  downloadUrl: string;
}

/**
 * Lista TODOS los documentos clínicos vigentes del paciente para el tab
 * Documentos (todas las categorías — el tab es la vista transversal; las
 * galerías de las Tools siguen filtrando por su tipo). Tenancy: la cubre
 * listDocumentosPaciente (org de la sesión activa) + RLS clínica.
 */
export async function listDocumentosPacienteAction(
  pacienteId: string,
): Promise<Result<DocumentoFichaItem[]>> {
  if (!z.string().uuid().safeParse(pacienteId).success) {
    return err("validation", "ID de paciente inválido.");
  }
  const result = await listDocumentosPaciente({ pacienteId });
  if (!result.ok) return result;
  return ok(
    result.data.map((doc) => ({
      id: doc.id,
      tipo: doc.tipo,
      fecha: (doc.fecha_estudio ?? doc.created_at).slice(0, 10),
      descripcion: doc.descripcion,
      mimeType: doc.mime_type,
      downloadUrl: doc.downloadUrl,
    })),
  );
}

/**
 * D2 · sube un documento clínico desde el tab Documentos, generalizando
 * uploadRadiografiaAction: el TIPO viaja en el FormData y se valida contra el
 * enum M08 (FOTO_POSTURAL excluida: exige consentimiento FOTOS firmado — ese
 * flujo tiene su propia puerta). Mismo core y guards que radiografías/estudios
 * (turno ∈ org, turno↔paciente, sesión guardada como ancla del documento).
 */
export async function uploadDocumentoPacienteAction(
  formData: FormData,
): Promise<Result<{ documentoId: string }>> {
  const tipoRaw = String(formData.get("tipo") ?? "");
  const tipo = (TIPO_DOCUMENTO as readonly string[]).includes(tipoRaw)
    ? (tipoRaw as TipoDocumento)
    : null;
  if (!tipo || tipo === "FOTO_POSTURAL") {
    return err("validation", "Elegí un tipo de documento válido.");
  }
  const descripcionRaw = formData.get("descripcion");
  return uploadDocumentoSesion({
    file: formData.get("file"),
    pacienteId: String(formData.get("pacienteId") ?? ""),
    turnoId: String(formData.get("turnoId") ?? ""),
    descripcion:
      typeof descripcionRaw === "string" && descripcionRaw.trim() !== ""
        ? descripcionRaw.trim().slice(0, 2000)
        : undefined,
    tipo,
    etiqueta: "documento",
    fallbackFilename: "documento.bin",
  });
}

/**
 * Refresca el signed URL de un documento clínico (los URLs de la galería
 * expiran a los 5 min). Wrapper fino sobre refreshSignedUrl — la tenancy la
 * cubre el propio reader (org-scoped). Lo usan tanto la galería de radiografías
 * (quiro) como la de estudios adjuntos (cardio).
 */
export async function refreshRadiografiaUrlAction(
  documentoId: string,
): Promise<Result<{ downloadUrl: string }>> {
  if (!z.string().uuid().safeParse(documentoId).success) {
    return err("validation", "ID inválido.");
  }
  const result = await getDocumentoDownloadUrl(documentoId);
  if (!result.ok) return result;
  return ok({ downloadUrl: result.data });
}

// ─── Consentimiento informado con firma (Ley 26.529) ─────────────────────────
//
// Primer caller de lib/db/consentimientos.ts. La firma se dibuja en canvas
// (components/paciente/firma-canvas-modal.tsx), viaja como PNG en FormData y
// se sube SERVER-SIDE al bucket privado `consentimientos-firmados` (mismo
// patrón que uploadRadiografiaAction: el browser nunca habla con Storage).
// El path canónico consentimientos-firmados/{org}/{paciente}/{uuid}.png lo
// arma buildFirmaStoragePath con ids de la SESIÓN — nunca del cliente — y
// respeta el CHECK consentimiento_path_format (M07).
//
// PHI: nunca se loguean nombres ni contenido; los identificadores de los
// mensajes de error son uuids.

// La firma de un canvas pesa decenas de KB; 5 MB es holgado y queda por debajo
// del file_size_limit del bucket (10 MB, M27).

/**
 * Espejo app-side de public.can_read_clinical (M01): OWNER, PROFESIONAL o
 * DIRECTOR colegiado. La RLS de M07/M27 es la barrera real — esto solo da un
 * error claro antes de subir bytes.
 */
/**
 * Lista los consentimientos del paciente (vigentes + revocados) mapeados al
 * item plano de la card. Tenancy: listConsentimientosPaciente ya es org-scoped
 * (organizationId de la sesión) + RLS consentimiento_select_clinical.
 */
export async function listConsentimientosPacienteAction(
  pacienteId: string,
): Promise<Result<ConsentimientoListItem[]>> {
  if (!z.string().uuid().safeParse(pacienteId).success) {
    return err("validation", "ID de paciente inválido.");
  }
  const result = await listConsentimientosPaciente(pacienteId);
  if (!result.ok) return result;
  return ok(result.data.map(mapConsentimientoRow));
}

/**
 * Plantillas de consentimiento elegibles para firmar: globales (M68 seed) +
 * custom de la org, ya resueltas a UNA por tipo (custom > global, mayor
 * versión). RLS plantilla_select_global_or_own limita la visibilidad.
 */
export async function listPlantillasConsentimientoAction(): Promise<Result<PlantillaVigente[]>> {
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("plantilla_consentimiento")
    .select("id, organization_id, tipo, version, titulo, texto_markdown")
    .is("reemplazado_por", null)
    .or(`organization_id.is.null,organization_id.eq.${session.data.organizationId}`);
  if (error) {
    return err("db_error", "No pudimos cargar las plantillas de consentimiento.", error.message);
  }

  const vigentes = elegirPlantillasVigentes((data ?? []) as PlantillaConsentimientoRow[]);
  if (vigentes.length === 0) {
    return err(
      "not_found",
      "No hay plantillas de consentimiento disponibles. Contactá a soporte.",
    );
  }
  return ok(vigentes);
}

/**
 * Tutores legales VIGENTES del paciente para el selector de firmante (Ley
 * 26.061: menores firman vía representante legal). El nombre está cifrado
 * app-side (M06) — se desencripta server-side con tryDecrypt (una fila
 * corrupta no rompe el selector).
 */
export async function listTutoresConsentimientoAction(pacienteId:string):Promise<Result<TutorOption[]>> {
  const result=await listRepresentaciones(pacienteId);
  if(!result.ok)return result;
  return ok(result.data.filter(r=>r.vigenteParaConsentir).map(r=>({id:r.id,nombre:r.nombre,vinculo:r.vinculo,esPrincipal:false})));
}

/**
 * Registra un consentimiento firmado: sube el PNG del canvas al bucket privado
 * y crea la fila vía createConsentimiento (que resuelve tipo desde la
 * plantilla y registra ip/user_agent para el audit AAIP).
 *
 * Upload + create van JUNTOS en esta action (no separados) para que el
 * firma_storage_path NUNCA viaje del cliente: un path client-supplied con el
 * org de OTRO tenant pasaría el regex del writer aunque la firma no sea
 * legible cross-org (la RLS de storage lo impide). Server-built path cierra
 * la clase entera.
 *
 * FormData: file (PNG), pacienteId, plantillaId, tutorId (opcional, "" = firma
 * el paciente). Guards:
 *   - rol clínico (espejo de can_read_clinical) — la RLS es la barrera real;
 *   - IDOR: paciente ∈ org activa (SELECT org-scoped);
 *   - tutorId ∈ tutores del MISMO paciente y org (el trigger
 *     consentimiento_tutor_guard de M07 re-valida en DB).
 *
 * Si el INSERT falla después del upload, se borra el PNG huérfano best-effort
 * con el service client (el bucket no tiene DELETE policy para usuarios —
 * inmutabilidad M27).
 */
export async function uploadFirmaConsentimientoAction(formData: FormData): Promise<Result<{ consentimientoId: string }>> {
  return uploadReviewedConsent(formData, "staff");
}

const revokeConsentimientoActionSchema = z.object({
  consentimientoId: z.string().uuid(),
  /** Solo para revalidatePath — la tenancy del UPDATE la resuelve el writer. */
  pacienteId: z.string().uuid(),
  motivo: z.string().min(5, "Contá el motivo en al menos 5 caracteres.").max(500),
});

export type RevokeConsentimientoActionInput = z.infer<typeof revokeConsentimientoActionSchema>;

/**
 * Revoca un consentimiento (Ley 26.529 art. 11: revocable en cualquier
 * momento). Solo marca revocado_en + motivo — el archivo de la firma se
 * conserva por compliance (retención 10 años). Org-scoped en el writer.
 */
export async function revokeConsentimientoAction(
  input: RevokeConsentimientoActionInput,
): Promise<Result<void>> {
  const parsed = revokeConsentimientoActionSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos de la revocación inválidos.", parsed.error.message);
  }

  const result = await revokeConsentimiento({
    consentimientoId: parsed.data.consentimientoId,
    motivo: parsed.data.motivo,
  });
  if (!result.ok) return result;

  revalidatePath(`/pacientes/${parsed.data.pacienteId}`);
  return ok(undefined);
}

/**
 * Signed URL temporal (5 min) para ver la firma. Recibe el ID del
 * consentimiento — NUNCA un storage path del cliente: el path se lee de la
 * fila org-scoped y recién ahí se firma (IDOR-proof por construcción; la RLS
 * de storage además exige rol clínico de la org del path).
 */
export async function getFirmaConsentimientoUrlAction(
  consentimientoId: string,
): Promise<Result<{ signedUrl: string }>> {
  if (!z.string().uuid().safeParse(consentimientoId).success) {
    return err("validation", "ID inválido.");
  }
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  const { data: row, error } = await supabase
    .from("consentimiento")
    .select("firma_storage_path")
    .eq("id", consentimientoId)
    .eq("organization_id", session.data.organizationId)
    .maybeSingle();
  if (error) {
    return err("db_error", "No pudimos buscar el consentimiento.", error.message);
  }
  const path = (row as { firma_storage_path: string } | null)?.firma_storage_path;
  if (!path) {
    return err("not_found", "No encontramos ese consentimiento.");
  }

  const url = await getSignedFirmaUrl(path);
  if (!url.ok) return url;
  return ok({ signedUrl: url.data });
}

// ─── Notas de la ficha (M96) ───────────────────────────────────────────────

/**
 * Anota en la ficha de un paciente, sin turno de por medio.
 *
 * Es el pedido del quiropráctico: la ficha de papel "la agarra, la lee y la
 * modifica cuando quiere". La llamada telefónica y el WhatsApp no esperan a que
 * haya un turno abierto.
 *
 * Append-only: no hay action para editar ni borrar, y no la va a haber. Para
 * corregir se agrega otra nota (Ley 26.529 art. 15).
 */
export async function addNotaFichaAction(
  pacienteId: string,
  texto: string,
): Promise<Result<{ id: string }>> {
  const result = await addNotaClinica({ pacienteId, texto });
  if (!result.ok) return result;
  revalidatePath(`/pacientes/${pacienteId}`);
  return result;
}

/**
 * Historial de cambios de la ficha (lazy: sólo cuando el profesional despliega
 * la card). Devuelve labels de campos, nunca valores — ver
 * lib/ficha/timeline-core.
 */
export async function getFichaTimelineAction(
  pacienteId: string,
): Promise<Result<EventoTimeline[]>> {
  return getFichaTimeline(pacienteId);
}

// ─── Contacto y enmiendas de la ficha (B8) ─────────────────────────────────

/** Edita los datos de contacto del paciente desde la ficha. */
export async function updateContactoPacienteAction(
  input: UpdatePacienteContactoInput,
): Promise<Result<{ identidadId: string }>> {
  const result = await updatePacienteContacto(input);
  if (!result.ok) return result;
  revalidatePath(`/pacientes/${input.pacienteId}`);
  // El nombre y el teléfono viven también en el directorio: sin esto, la lista
  // sigue mostrando el dato viejo hasta el próximo hard refresh.
  revalidatePath("/pacientes");
  return result;
}

/**
 * Agrega una enmienda a una sesión ya cerrada (Ley 26.529 art. 15).
 *
 * `addEnmienda` existía desde M10 —con su tabla, su RLS y sus triggers
 * append-only— y **nunca tuvo un caller**: una vez que la sesión quedaba
 * lockeada, corregir un error era imposible desde la app. La ley no permite
 * reescribir la historia clínica, pero sí exige poder enmendarla.
 *
 * El guard de pertenencia va acá y no en `addEnmienda`: el sesionId viene del
 * cliente, así que hay que confirmar que esa sesión es del paciente cuya ficha
 * se está mirando antes de colgarle nada.
 */
export async function addEnmiendaSesionAction(
  pacienteId: string,
  sesionId: string,
  motivo: string,
  texto: string,
): Promise<Result<{ id: string }>> {
  const motivoLimpio = motivo.trim();
  // Espejo del CHECK de la tabla (sesion_enmienda_motivo_len, 10-500): validar
  // acá da un mensaje entendible en vez de un error de constraint de Postgres.
  if (motivoLimpio.length < 10 || motivoLimpio.length > 500) {
    return err(
      "validation",
      "El motivo de la enmienda tiene que tener entre 10 y 500 caracteres — es lo que queda registrado como justificación.",
    );
  }
  const textoLimpio = texto.trim();
  if (textoLimpio.length === 0) {
    return err("validation", "Escribí la corrección antes de guardar la enmienda.");
  }

  const ctx = await getActiveContext();
  if (!ctx.ok) return ctx;

  // Guard IDOR: la sesión tiene que ser de ESTE paciente y de la org activa.
  // Se lee con el client del usuario (bajo RLS), así que una sesión que no
  // puede ver no existe para él.
  const supabase = await createSupabaseServerClient();
  const { data: sesionRow } = await supabase
    .from("sesion")
    .select("id, paciente_id")
    .eq("id", sesionId)
    .eq("organization_id", ctx.data.organization.id)
    .maybeSingle();
  const row = sesionRow as { id: string; paciente_id: string } | null;
  if (!row || !sesionPerteneceAPaciente(row.paciente_id, pacienteId)) {
    return err("not_found", "No encontramos esa sesión en la ficha.");
  }

  const result = await addEnmienda(sesionId, motivoLimpio, textoLimpio);
  if (!result.ok) return result;
  revalidatePath(`/pacientes/${pacienteId}`);
  return result;
}
