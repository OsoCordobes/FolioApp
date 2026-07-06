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

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  buildFirmaStoragePath,
  elegirPlantillasVigentes,
  mapConsentimientoRow,
  pathSinBucket,
  tutorVigente,
  type ConsentimientoListItem,
  type PlantillaConsentimientoRow,
  type PlantillaVigente,
  type TutorOption,
} from "@/lib/consentimientos/helpers";
import { tryDecrypt } from "@/lib/crypto";
import { getActiveContext } from "@/lib/db/active-context";
import {
  createConsentimiento,
  getSignedFirmaUrl,
  listConsentimientosPaciente,
  revokeConsentimiento,
} from "@/lib/db/consentimientos";
import {
  buildDocumentoStoragePath,
  createDocumentoClinico,
  refreshSignedUrl,
} from "@/lib/db/documentos";
import { saveRespuesta } from "@/lib/db/instrumentos";
import { savePacienteIntakeAvanzado } from "@/lib/db/paciente-intake";
import { createPaciente } from "@/lib/db/pacientes";
import { savePlanTratamiento } from "@/lib/db/plan-tratamiento";
import { getActiveSession } from "@/lib/db/session";
import { upsertSesion } from "@/lib/db/sesiones";
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
    tags: [],
    intakeAvanzado: d.intakeAvanzado,
  });

  if (!result.ok) return result;

  revalidatePath("/pacientes");
  return ok({ id: result.data.id });
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

// ─── Guardar sesión desde la ficha (tab Plan) ───────────────────────────────

const saveSesionFichaSchema = z.object({
  turnoId: z.string().uuid(),
  pacienteId: z.string().uuid(),
  /** Borrador del slot clínico — opaco acá; lo valida el writer contra el
   *  schema zod del registry. null/ausente = no se tocó la herramienta. */
  toolValue: z.unknown().optional(),
  soap: z.object({
    subjetivo: z.string().max(5000),
    objetivo: z.string().max(5000),
    analisis: z.string().max(5000),
    plan: z.string().max(5000),
  }),
});

export type SaveSesionFichaActionInput = z.infer<typeof saveSesionFichaSchema>;

/**
 * Persiste el borrador del tab Plan (herramienta de especialidad + SOAP)
 * como la sesión del turno en curso del paciente (upsert 1:1 por turno_id,
 * editable hasta el lock — Ley 26.529).
 *
 * El toolId NO viaja del cliente: lo deriva el writer (upsertSesion) de la
 * especialidad EFECTIVA del PROFESIONAL del turno (M55: member.especialidad
 * ?? organization.especialidad) y valida el toolData contra el schema zod del
 * registry antes de cifrar. RLS (sesion_insert/update_clinical, M10) y el
 * trigger sesion_same_org_guard cubren tenancy y coherencia turno↔paciente.
 * PHI: nunca se loguea el contenido del borrador.
 */
export async function saveSesionFichaAction(
  input: SaveSesionFichaActionInput,
): Promise<Result<{ sesionId: string }>> {
  const parsed = saveSesionFichaSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos de la sesión inválidos.", parsed.error.message);
  }

  const ctx = await getActiveContext();
  if (!ctx.ok) return ctx;

  // Feedback quiro (jul-2026): la ficha también guarda con el turno de hoy aún
  // no iniciado (ancla por_iniciar de elegirTurnoAncla). Guardar ES empezar a
  // atender: si el turno está AGENDADO/CONFIRMADO/EN_SALA se lo lleva a
  // ATENDIENDO (matriz M09: AGENDADO|CONFIRMADO → EN_SALA → ATENDIENDO) ANTES
  // del upsert, así atendiendo_desde marca el inicio real de la escritura y
  // "Guardar y cerrar" puede derivar la duración. Best-effort deliberado: si
  // una transición falla (el estado cambió en el medio / la matriz la
  // rechaza), la sesión se guarda IGUAL — los datos clínicos mandan; el estado
  // se corrige desde /hoy y el fallo queda en Sentry. El SELECT es org-scoped
  // (un turno ajeno da estado null y no se transiciona; el guard IDOR real
  // vive en upsertSesion).
  const supabase = await createSupabaseServerClient();
  const { data: turnoEstadoRow } = await supabase
    .from("turno")
    .select("estado")
    .eq("id", parsed.data.turnoId)
    .eq("organization_id", ctx.data.session.organizationId)
    .maybeSingle();
  const estadoTurno = (turnoEstadoRow as { estado: string } | null)?.estado ?? null;

  let huboTransicion = false;
  if (estadoTurno === "AGENDADO" || estadoTurno === "CONFIRMADO" || estadoTurno === "EN_SALA") {
    const pasos: Array<"EN_SALA" | "ATENDIENDO"> =
      estadoTurno === "EN_SALA" ? ["ATENDIENDO"] : ["EN_SALA", "ATENDIENDO"];
    for (const to of pasos) {
      const trans = await transitionTurno({ turnoId: parsed.data.turnoId, to });
      if (!trans.ok) {
        const { captureException } = await import("@sentry/nextjs");
        captureException(
          new Error(
            `saveSesionFicha: no se pudo iniciar la atención (→${to}): ${trans.error.message}`,
          ),
          { tags: { component: "pacientes-actions", op: "iniciarAtencionAlGuardar" } },
        );
        break;
      }
      huboTransicion = true;
    }
  }
  // El turno cambió de estado → /hoy debe dejar de mostrarlo como pendiente,
  // haya salido bien o no el guardado de abajo.
  if (huboTransicion) revalidatePath("/hoy");

  // F-AUTH (IDOR): turnoId/pacienteId vienen del cliente. El guard cross-org
  // (turno ∈ org activa + turno.paciente_id == pacienteId) vive ahora en
  // upsertSesion (lib/db/sesiones.ts), así protege a cualquier caller y evita
  // duplicar el SELECT acá. La RLS + el trigger sesion_same_org_guard son la
  // última línea en DB.
  const result = await upsertSesion(
    buildUpsertSesionInput({
      turnoId: parsed.data.turnoId,
      pacienteId: parsed.data.pacienteId,
      toolValue: parsed.data.toolValue ?? null,
      soap: parsed.data.soap,
    }),
  );
  if (!result.ok) return result;

  // La vuelta: la ficha re-renderiza con la sesión nueva en plan.toolHistorial.
  revalidatePath(`/pacientes/${parsed.data.pacienteId}`);
  return ok({ sesionId: result.data.id });
}

// ─── Guardar y cerrar el turno desde la ficha (tab Plan) ─────────────────────

/**
 * Resultado de "Guardar y cerrar". `ok` SIEMPRE implica que la sesión se
 * guardó; `cerrado` distingue el cierre exitoso del caso "se guardó pero no se
 * pudo cerrar" (el cliente muestra distinto copy y NO navega fuera). Modelarlo
 * así — en vez de un err con code adivinable — evita que el cliente tenga que
 * discriminar por code (save y close comparten codes como db_error/forbidden).
 */
export interface SaveSesionYCerrarResult {
  /** true = turno cerrado; false = sesión guardada pero el cierre falló. */
  cerrado: boolean;
  /** Mensaje del fallo del cierre (solo presente cuando cerrado === false). */
  cierreError?: string;
}

/**
 * Guarda la sesión del turno en curso (igual que saveSesionFichaAction) Y, si
 * eso ok, cierra el turno (ATENDIENDO → CERRADO). Mismo shape de input que
 * saveSesionFichaAction.
 *
 * Orden deliberado (datos clínicos primero, side-effect terminal después):
 *   1. upsertSesion — si falla, RETORNA un err temprano: NUNCA se cierra sobre
 *      un guardado fallido. Un err de esta action == el guardado falló.
 *   2. transitionTurno(→CERRADO) con la duración real derivada de
 *      atendiendo_desde (mismo cálculo que "Cerrar turno" en /hoy). Si ESTO
 *      falla, devolvemos ok({ cerrado: false, cierreError }) — la sesión YA
 *      está persistida, así que no es un fracaso de la action; el cliente
 *      muestra "Sesión guardada, pero no se pudo cerrar…" sin perder el trabajo.
 *
 * Tenancy: el SELECT de atendiendo_desde es org-scoped (organizationId del
 * contexto activo); el guard cross-org de turnoId/pacienteId ya vive en
 * upsertSesion y transitionTurno (RLS + triggers como última línea en DB).
 */
export async function saveSesionYCerrarAction(
  input: SaveSesionFichaActionInput,
): Promise<Result<SaveSesionYCerrarResult>> {
  const parsed = saveSesionFichaSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos de la sesión inválidos.", parsed.error.message);
  }

  const ctx = await getActiveContext();
  if (!ctx.ok) return ctx;

  // Duración real: minutos desde atendiendo_desde hasta ahora, org-scoped. Solo
  // se aplica si cae en [0, 480] (mismo límite que el schema de transitionTurno);
  // fuera de rango o sin timestamp → undefined (transitionTurno no toca
  // duracion_real_min y la columna conserva lo que tuviera).
  const supabase = await createSupabaseServerClient();
  const { data: turnoRow } = await supabase
    .from("turno")
    .select("atendiendo_desde")
    .eq("id", parsed.data.turnoId)
    .eq("organization_id", ctx.data.session.organizationId)
    .maybeSingle();

  const atendiendoDesde = (turnoRow as { atendiendo_desde: string | null } | null)?.atendiendo_desde ?? null;
  let duracionRealMin: number | undefined;
  if (atendiendoDesde) {
    const mins = Math.round((Date.now() - new Date(atendiendoDesde).getTime()) / 60000);
    if (mins >= 0 && mins <= 480) duracionRealMin = mins;
  }

  // 1. Guardar la sesión (writer único — deriva tool_id, valida y cifra). Si
  //    falla, NO cerramos: la sesión es lo que importa.
  const saved = await upsertSesion(
    buildUpsertSesionInput({
      turnoId: parsed.data.turnoId,
      pacienteId: parsed.data.pacienteId,
      toolValue: parsed.data.toolValue ?? null,
      soap: parsed.data.soap,
    }),
  );
  if (!saved.ok) return saved;

  // 2. Cerrar el turno. Si falla, la sesión YA quedó guardada: devolvemos un
  //    ok parcial (cerrado: false) con el mensaje del cierre para el cliente.
  const closed = await transitionTurno({
    turnoId: parsed.data.turnoId,
    to: "CERRADO",
    duracionRealMin,
  });
  if (!closed.ok) {
    // El guardado persistió → la ficha igual debe refrescar el historial.
    revalidatePath(`/pacientes/${parsed.data.pacienteId}`);
    return ok({ cerrado: false, cierreError: closed.error.message });
  }

  // La vuelta: /hoy deja de mostrar el turno como activo y la ficha re-renderiza
  // con la sesión nueva en plan.toolHistorial.
  revalidatePath("/hoy");
  revalidatePath(`/pacientes/${parsed.data.pacienteId}`);
  return ok({ cerrado: true });
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

const DOC_BUCKET = "documentos-clinicos";
const DOC_MAX_BYTES = 50 * 1024 * 1024; // espeja el CHECK documento_tamanio_limite (M08)
// image/* | pdf | dicom. El set fino lo re-valida createDocumentoClinico contra
// ALLOWED_MIME; acá hacemos un primer filtro barato antes de subir bytes.
function docMimeOk(mime: string): boolean {
  return mime.startsWith("image/") || mime === "application/pdf" || mime === "application/dicom";
}

/**
 * Core compartido: adjunta un documento a la sesión del turno en curso.
 *
 * Reglas (idénticas para radiografías y estudios cardio):
 *   - turno ∈ org activa Y turno.paciente_id == pacienteId (mismo guard IDOR
 *     que upsertSesion — no se confía en IDs del cliente).
 *   - debe existir una sesion para el turno (el documento cuelga de ella): sino
 *     se pide guardar la sesión primero, así el documento queda atado a la visita.
 *   - mime image/* | pdf | dicom y tamaño <= 50 MB.
 *
 * PHI: el nombre/descripción no se loguean; el blob vive en el bucket privado y
 * la fila la lee la ficha con signed URLs de vida corta.
 */
async function uploadDocumentoSesion(params: {
  file: unknown;
  pacienteId: string;
  turnoId: string;
  descripcion?: string;
  tipo: "RADIOGRAFIA" | "INFORME_EXTERNO";
  /** Nombre de la entidad para los mensajes de error ("radiografía"/"estudio"). */
  etiqueta: string;
  /** Filename por defecto si el Blob no trae nombre. */
  fallbackFilename: string;
}): Promise<Result<{ documentoId: string }>> {
  const { file, pacienteId, turnoId, descripcion, tipo, etiqueta, fallbackFilename } = params;

  if (!(file instanceof Blob) || file.size === 0) {
    return err("validation", "Adjuntá un archivo válido.");
  }
  if (!z.string().uuid().safeParse(pacienteId).success || !z.string().uuid().safeParse(turnoId).success) {
    return err("validation", `Datos del ${etiqueta} inválidos.`);
  }
  if (file.size > DOC_MAX_BYTES) {
    return err("validation", "El archivo supera el límite de 50 MB.");
  }
  const mimeType = file.type || "application/octet-stream";
  if (!docMimeOk(mimeType)) {
    return err("validation", `Tipo de archivo no permitido: ${mimeType}.`);
  }
  const filename = file instanceof File && file.name ? file.name : fallbackFilename;

  const ctx = await getActiveContext();
  if (!ctx.ok) return ctx;
  const organizationId = ctx.data.session.organizationId;

  const supabase = await createSupabaseServerClient();

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
  const { data: sesionRow } = await supabase
    .from("sesion")
    .select("id")
    .eq("turno_id", turnoId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  const sesionId = (sesionRow as { id: string } | null)?.id ?? null;
  if (!sesionId) {
    return err("validation", `Guardá la sesión antes de adjuntar el ${etiqueta}.`);
  }

  // Subida server-side de los bytes al bucket privado. El storage_path canónico
  // (bucket/{org}/{paciente}/{uuid}.{ext}) lo arma buildDocumentoStoragePath;
  // el upload va SIN el prefijo del bucket.
  const storagePath = buildDocumentoStoragePath({ organizationId, pacienteId, filename });
  const pathInBucket = storagePath.replace(/^documentos-clinicos\//, "");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: uploadErr } = await supabase.storage
    .from(DOC_BUCKET)
    .upload(pathInBucket, bytes, { contentType: mimeType });
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
  if (!created.ok) return created;

  // La vuelta: la galería de la Tool trae el documento nuevo.
  revalidatePath(`/pacientes/${pacienteId}`);
  return ok({ documentoId: created.data.id });
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

/**
 * Refresca el signed URL de un documento clínico (los URLs de la galería
 * expiran a los 5 min). Wrapper fino sobre refreshSignedUrl — la tenancy la
 * cubre el propio reader (org-scoped). Lo usan tanto la galería de radiografías
 * (quiro) como la de estudios adjuntos (cardio).
 */
export async function refreshRadiografiaUrlAction(
  documentoId: string,
): Promise<Result<{ signedUrl: string }>> {
  if (!z.string().uuid().safeParse(documentoId).success) {
    return err("validation", "ID inválido.");
  }
  const result = await refreshSignedUrl(documentoId);
  if (!result.ok) return result;
  return ok({ signedUrl: result.data });
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

const CONSENT_BUCKET = "consentimientos-firmados";
// La firma de un canvas pesa decenas de KB; 5 MB es holgado y queda por debajo
// del file_size_limit del bucket (10 MB, M27).
const FIRMA_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Espejo app-side de public.can_read_clinical (M01): OWNER, PROFESIONAL o
 * DIRECTOR colegiado. La RLS de M07/M27 es la barrera real — esto solo da un
 * error claro antes de subir bytes.
 */
function puedeFirmarConsentimientos(session: {
  role: "OWNER" | "DIRECTOR" | "PROFESIONAL" | "COORDINADOR" | "ASISTENTE";
  esColegiado: boolean;
}): boolean {
  return (
    session.role === "OWNER" ||
    session.role === "PROFESIONAL" ||
    (session.role === "DIRECTOR" && session.esColegiado)
  );
}

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
export async function listTutoresConsentimientoAction(
  pacienteId: string,
): Promise<Result<TutorOption[]>> {
  if (!z.string().uuid().safeParse(pacienteId).success) {
    return err("validation", "ID de paciente inválido.");
  }
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("tutor_legal")
    .select("id, vinculo, es_principal, nombre_cifrado, vigencia_desde, vigencia_hasta")
    .eq("organization_id", session.data.organizationId)
    .eq("paciente_id", pacienteId)
    .order("es_principal", { ascending: false });
  if (error) {
    return err("db_error", "No pudimos cargar los tutores del paciente.", error.message);
  }

  const hoy = new Date().toISOString().slice(0, 10);
  const tutores = ((data ?? []) as Array<{
    id: string;
    vinculo: string;
    es_principal: boolean;
    nombre_cifrado: string | null;
    vigencia_desde: string | null;
    vigencia_hasta: string | null;
  }>)
    .filter((t) =>
      tutorVigente({ vigenciaDesde: t.vigencia_desde, vigenciaHasta: t.vigencia_hasta }, hoy),
    )
    .map((t) => ({
      id: t.id,
      nombre: tryDecrypt(t.nombre_cifrado, "tutor_legal.nombre") ?? "Tutor legal",
      vinculo: t.vinculo,
      esPrincipal: t.es_principal,
    }));
  return ok(tutores);
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
export async function uploadFirmaConsentimientoAction(
  formData: FormData,
): Promise<Result<{ consentimientoId: string }>> {
  const file = formData.get("file");
  const pacienteId = String(formData.get("pacienteId") ?? "");
  const plantillaId = String(formData.get("plantillaId") ?? "");
  const tutorIdRaw = String(formData.get("tutorId") ?? "");
  const tutorId = tutorIdRaw.trim() === "" ? null : tutorIdRaw;

  if (!(file instanceof Blob) || file.size === 0) {
    return err("validation", "La firma llegó vacía. Dibujala de nuevo e intentá otra vez.");
  }
  if (file.size > FIRMA_MAX_BYTES) {
    return err("validation", "La firma supera el límite de 5 MB.");
  }
  if (file.type !== "image/png") {
    return err("validation", "La firma debe ser una imagen PNG.");
  }
  if (
    !z.string().uuid().safeParse(pacienteId).success ||
    !z.string().uuid().safeParse(plantillaId).success ||
    (tutorId !== null && !z.string().uuid().safeParse(tutorId).success)
  ) {
    return err("validation", "Datos del consentimiento inválidos.");
  }

  const session = await getActiveSession();
  if (!session.ok) return session;
  if (!puedeFirmarConsentimientos(session.data)) {
    return err("forbidden", "Tu rol no puede registrar consentimientos.");
  }
  const organizationId = session.data.organizationId;

  const supabase = await createSupabaseServerClient();

  // F-AUTH (IDOR): paciente ∈ org activa. Mismo guard que los vecinos — no se
  // confía en ids del cliente. La RLS de paciente es la última línea.
  const { data: pacienteRow, error: pacienteErr } = await supabase
    .from("paciente")
    .select("id")
    .eq("id", pacienteId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (pacienteErr) {
    return err("db_error", "No pudimos validar el paciente.", pacienteErr.message);
  }
  if (!pacienteRow) {
    return err("forbidden", "Ese paciente no pertenece a tu organización.");
  }

  // Firmante tutor: debe ser tutor del MISMO paciente en la MISMA org (el
  // trigger consentimiento_tutor_guard re-valida en DB; acá damos error claro).
  if (tutorId !== null) {
    const { data: tutorRow, error: tutorErr } = await supabase
      .from("tutor_legal")
      .select("id")
      .eq("id", tutorId)
      .eq("paciente_id", pacienteId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (tutorErr) {
      return err("db_error", "No pudimos validar el tutor.", tutorErr.message);
    }
    if (!tutorRow) {
      return err("validation", "El tutor seleccionado no corresponde a este paciente.");
    }
  }

  // Path canónico server-built (CHECK M07). El upload va SIN el prefijo del
  // bucket (storage.objects.name no lo incluye — M27).
  const firmaStoragePath = buildFirmaStoragePath({
    organizationId,
    pacienteId,
    archivoUuid: crypto.randomUUID(),
  });
  const pathEnBucket = pathSinBucket(firmaStoragePath);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: uploadErr } = await supabase.storage
    .from(CONSENT_BUCKET)
    .upload(pathEnBucket, bytes, { contentType: "image/png" });
  if (uploadErr) {
    return err("db_error", "No pudimos subir la firma.", uploadErr.message);
  }

  const created = await createConsentimiento({
    pacienteId,
    plantillaId,
    firmaStoragePath,
    firmadoPorTutorId: tutorId,
  });
  if (!created.ok) {
    // El PNG quedó huérfano y los usuarios no tienen DELETE en este bucket
    // (M27): limpieza best-effort con service client. Si también falla, el
    // archivo huérfano es benigno (uuid sin fila que lo referencie).
    try {
      const service = createSupabaseServiceClient();
      await service.storage.from(CONSENT_BUCKET).remove([pathEnBucket]);
    } catch {
      // best-effort: nunca enmascarar el error real del INSERT
    }
    return created;
  }

  // La vuelta: la card de la ficha muestra el consentimiento nuevo.
  revalidatePath(`/pacientes/${pacienteId}`);
  return ok({ consentimientoId: created.data.id });
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
