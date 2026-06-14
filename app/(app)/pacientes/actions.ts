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

import { getActiveContext } from "@/lib/db/active-context";
import {
  buildDocumentoStoragePath,
  createDocumentoClinico,
  refreshSignedUrl,
} from "@/lib/db/documentos";
import { savePacienteIntakeAvanzado } from "@/lib/db/paciente-intake";
import { createPaciente } from "@/lib/db/pacientes";
import { savePlanTratamiento } from "@/lib/db/plan-tratamiento";
import { upsertSesion } from "@/lib/db/sesiones";
import { transitionTurno } from "@/lib/db/turnos";
import { err, ok, type Result } from "@/lib/db/errors";
import { buildUpsertSesionInput } from "@/lib/especialidades/draft";
import { ESPECIALIDAD_SLUGS } from "@/lib/especialidades/meta";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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

// ─── Radiografías de la Tool quiropraxia (Workstream 6) ──────────────────────

const RADIO_BUCKET = "documentos-clinicos";
const RADIO_MAX_BYTES = 50 * 1024 * 1024; // espeja el CHECK documento_tamanio_limite (M08)
// image/* | pdf | dicom. El set fino lo re-valida createDocumentoClinico contra
// ALLOWED_MIME; acá hacemos un primer filtro barato antes de subir bytes.
function radioMimeOk(mime: string): boolean {
  return mime.startsWith("image/") || mime === "application/pdf" || mime === "application/dicom";
}

/**
 * Adjunta una radiografía a la sesión del turno en curso (documento_clinico
 * tipo RADIOGRAFIA, M08). Sube los bytes server-side al bucket privado y
 * registra la fila con el storage_path canónico.
 *
 * Reglas:
 *   - turno ∈ org activa Y turno.paciente_id == pacienteId (mismo guard IDOR
 *     que upsertSesion — no se confía en IDs del cliente).
 *   - debe existir una sesion para el turno (la radiografía cuelga de ella):
 *     sino se pide "Guardá la sesión antes de adjuntar radiografías." — así el
 *     documento siempre queda atado a una visita.
 *   - mime image/* | pdf | dicom y tamaño <= 50 MB.
 *
 * PHI: el nombre/descripción no se loguean; el blob vive en el bucket privado y
 * la fila la lee la ficha con signed URLs de vida corta.
 */
export async function uploadRadiografiaAction(
  formData: FormData,
): Promise<Result<{ documentoId: string }>> {
  const file = formData.get("file");
  const pacienteId = String(formData.get("pacienteId") ?? "");
  const turnoId = String(formData.get("turnoId") ?? "");
  const descripcionRaw = formData.get("descripcion");
  const descripcion =
    typeof descripcionRaw === "string" && descripcionRaw.trim() !== ""
      ? descripcionRaw.trim().slice(0, 2000)
      : undefined;

  if (!(file instanceof Blob) || file.size === 0) {
    return err("validation", "Adjuntá un archivo válido.");
  }
  if (!z.string().uuid().safeParse(pacienteId).success || !z.string().uuid().safeParse(turnoId).success) {
    return err("validation", "Datos de la radiografía inválidos.");
  }
  if (file.size > RADIO_MAX_BYTES) {
    return err("validation", "El archivo supera el límite de 50 MB.");
  }
  const mimeType = file.type || "application/octet-stream";
  if (!radioMimeOk(mimeType)) {
    return err("validation", `Tipo de archivo no permitido: ${mimeType}.`);
  }
  const filename = file instanceof File && file.name ? file.name : "radiografia.bin";

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

  // La radiografía cuelga de la sesion del turno: si todavía no hay sesión, se
  // pide guardarla primero (el documento siempre queda atado a una visita).
  const { data: sesionRow } = await supabase
    .from("sesion")
    .select("id")
    .eq("turno_id", turnoId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  const sesionId = (sesionRow as { id: string } | null)?.id ?? null;
  if (!sesionId) {
    return err("validation", "Guardá la sesión antes de adjuntar radiografías.");
  }

  // Subida server-side de los bytes al bucket privado. El storage_path canónico
  // (bucket/{org}/{paciente}/{uuid}.{ext}) lo arma buildDocumentoStoragePath;
  // el upload va SIN el prefijo del bucket.
  const storagePath = buildDocumentoStoragePath({ organizationId, pacienteId, filename });
  const pathInBucket = storagePath.replace(/^documentos-clinicos\//, "");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: uploadErr } = await supabase.storage
    .from(RADIO_BUCKET)
    .upload(pathInBucket, bytes, { contentType: mimeType });
  if (uploadErr) {
    return err("db_error", "No pudimos subir el archivo.", uploadErr.message);
  }

  const created = await createDocumentoClinico({
    pacienteId,
    sesionId,
    tipo: "RADIOGRAFIA",
    storagePath,
    mimeType,
    tamanioBytes: file.size,
    descripcion,
  });
  if (!created.ok) return created;

  // La vuelta: la galería de la Tool quiro trae la radiografía nueva.
  revalidatePath(`/pacientes/${pacienteId}`);
  return ok({ documentoId: created.data.id });
}

/**
 * Refresca el signed URL de una radiografía (los URLs de la galería expiran a
 * los 5 min). Wrapper fino sobre refreshSignedUrl — la tenancy la cubre el
 * propio reader (org-scoped).
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
