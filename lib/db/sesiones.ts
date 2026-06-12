/**
 * Folio · queries y mutations de Sesion (SOAP + tool de especialidad + lock).
 *
 * Writer ÚNICO de sesion.tool_id / tool_data_cifrado (M50). El toolId NO viaja
 * del cliente: se deriva acá, server-side, de la especialidad EFECTIVA del
 * PROFESIONAL del turno (M55: member.especialidad ?? organization.especialidad
 * — la herramienta es la del profesional que atiende, no la del usuario que
 * guarda: un director colegiado puede escribir sobre un turno ajeno y la
 * sesión queda con la tool del profesional del turno). El toolData se valida
 * contra el schema del registry (lib/especialidades/meta.ts) ANTES de cifrar;
 * los schemas son .strict(), así que un payload de OTRA herramienta RECHAZA
 * con error visible en vez de stripearse a `{ v: 1 }` (sin corrupción
 * silenciosa). Un guardado solo-SOAP sobre una sesión cuyos datos de
 * herramienta la ficha NO pudo re-hidratar (tool_id de otra especialidad /
 * fila legacy) PRESERVA esas columnas en vez de nullearlas
 * (debePreservarToolData) — conservador con PHI.
 * Para quiropraxia, vertebras_json se espeja como hasta ahora (compat con la
 * vista sesion_con_enmiendas M14 + índice gin — se retira en Fase F).
 */

import { z } from "zod";

import { encryptColumn, tryDecrypt } from "@/lib/crypto";
import {
  ESPECIALIDADES_META,
  resolveEspecialidadEfectiva,
  toolPerteneceAEspecialidad,
  type EspecialidadMeta,
  type EspecialidadSlug,
} from "@/lib/especialidades/meta";
import type { QuiropraxiaToolData } from "@/lib/especialidades/quiropraxia/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, mapSupabaseError, ok, type Result } from "./errors";
import { getActiveSession } from "./session";

const vertebraEstadoSchema = z.enum(["normal", "leve", "moderado", "severo", "ajustada"]);

const soapSchema = z.object({
  s: z.string().max(5000).optional(),
  o: z.string().max(5000).optional(),
  a: z.string().max(5000).optional(),
  p: z.string().max(5000).optional(),
});

const upsertSesionSchema = z.object({
  turnoId: z.string().uuid(),
  pacienteId: z.string().uuid(),
  soap: soapSchema.optional(),
  vertebras: z.array(z.object({
    id: z.string().regex(/^[CTL][0-9]{1,2}$/),
    estado: vertebraEstadoSchema,
  })).optional(),
  /**
   * Payload de la herramienta — OPACO para el caller. El toolId se deriva
   * server-side (especialidad efectiva del profesional del turno, M55) y el
   * payload se valida contra el schema zod de esa especialidad antes de cifrar.
   */
  toolData: z.unknown().optional(),
  evaAntes: z.number().int().min(0).max(10).nullable().optional(),
  evaDespues: z.number().int().min(0).max(10).nullable().optional(),
  notas: z.string().max(10000).optional(),
});

export type UpsertSesionInput = z.infer<typeof upsertSesionSchema>;

// ─── IDOR guard (puro, testeable) ──────────────────────────────────────
//
// F-AUTH: decide si un turno (leído de DB) habilita escribir la sesión que el
// cliente pidió. Pura a propósito — sin I/O — para fijar las invariantes en un
// test unitario sin mockear Supabase. La lectura del turno la hace el caller
// (upsertSesion) bajo RLS; acá solo se evalúa el resultado.
//
//   - turno inexistente o de otra org           → forbidden (IDOR cross-tenant)
//   - turno.paciente_id != pacienteId del input → forbidden (turno↔paciente)
//   - coincide todo                              → ok
export type TurnoOwnershipRow = {
  organization_id: string;
  paciente_id: string;
  /**
   * Profesional asignado al turno (M55: decide la especialidad efectiva de la
   * sesión). Opcional para el guard puro — la verificación de ownership no lo
   * usa; el writer sí, después de que el guard aprueba.
   */
  profesional_id?: string | null;
} | null;

export type TurnoOwnershipVerdict =
  | { ok: true }
  | { ok: false; code: "forbidden"; message: string };

export function checkTurnoOwnership(
  turno: TurnoOwnershipRow,
  activeOrgId: string,
  pacienteId: string,
): TurnoOwnershipVerdict {
  if (!turno || turno.organization_id !== activeOrgId) {
    return { ok: false, code: "forbidden", message: "Ese turno no pertenece a tu organización." };
  }
  if (turno.paciente_id !== pacienteId) {
    return { ok: false, code: "forbidden", message: "El turno no corresponde a ese paciente." };
  }
  return { ok: true };
}

// ─── Preservación de tool data en guardados solo-SOAP (puro, testeable) ─

/**
 * Columnas de herramienta de la fila `sesion` existente, tal como las lee el
 * writer. De `tool_data_cifrado` solo importa la NULIDAD — acá nunca se
 * descifra nada.
 */
export type SesionToolColumnsRow = {
  tool_id: string | null;
  tool_data_cifrado: unknown | null;
  vertebras_json: unknown;
};

/** ¿La fila existente tiene ALGÚN dato de herramienta que un UPDATE podría pisar? */
export function sesionTieneToolData(row: SesionToolColumnsRow): boolean {
  return (
    row.tool_data_cifrado != null ||
    row.tool_id != null ||
    (Array.isArray(row.vertebras_json) && row.vertebras_json.length > 0)
  );
}

/**
 * F-PHI (review PR #56): ¿un guardado SIN toolData (solo SOAP) debe PRESERVAR
 * las columnas tool existentes en vez de nullearlas?
 *
 * La regla espeja el criterio de re-hidratación del reader
 * (lib/db/paciente-ficha.ts → turnoActivo.toolDraft): la ficha solo re-hidrata
 * el borrador si `tool_data_cifrado != null` Y el `tool_id` pertenece a la
 * especialidad efectiva. Entonces:
 *
 *   - Fila RE-HIDRATABLE (el usuario VIO sus datos en la herramienta y aun así
 *     mandó toolValue null) → es un vaciado deliberado (los Tools de
 *     cardio/psico emiten null cuando se borra todo el contenido) → NO
 *     preservar: se honra el vaciado y las columnas van a NULL.
 *   - Fila NO re-hidratable con datos (tool_id de OTRA especialidad — turno
 *     reasignado / member.especialidad cambiada —, tool_id desconocido para
 *     este deploy, o fila legacy quiro con solo vertebras_json) → la UI NUNCA
 *     mostró esos datos, el null no puede ser una decisión del usuario →
 *     PRESERVAR: el UPDATE no toca tool_id / tool_data_cifrado /
 *     vertebras_json y el SOAP se guarda igual.
 *
 * Semántica deliberadamente conservadora con PHI: ante la duda, no se borra.
 * Pura a propósito (sin I/O) — invariantes en tests/unit/sesion-tool-preserve.test.ts.
 */
export function debePreservarToolData(
  existing: SesionToolColumnsRow | null,
  especialidadEfectiva: EspecialidadSlug,
): boolean {
  if (!existing || !sesionTieneToolData(existing)) return false; // nada que pisar
  const rehidratable =
    existing.tool_data_cifrado != null &&
    toolPerteneceAEspecialidad(existing.tool_id, especialidadEfectiva);
  return !rehidratable;
}

// ─── Especialidad efectiva del turno (M55) ─────────────────────────────

/**
 * Deriva SERVER-SIDE la especialidad efectiva del PROFESIONAL del turno
 * (member.especialidad ?? organization.especialidad; fallback a la org si el
 * turno no tuviera profesional — imposible post-CLINICA-3, defensivo).
 *
 * El lookup del member NO filtra `deleted_at` a propósito: el turno sigue
 * siendo de ese profesional aunque después lo hayan dado de baja — su
 * especialidad sigue decidiendo la herramienta de la sesión. Filtrar la baja
 * degradaría la sesión a la especialidad de la org y cambiaría de herramienta
 * en silencio.
 */
async function especialidadEfectivaDelTurno(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  profesionalId: string | null,
  organizationId: string,
): Promise<Result<EspecialidadSlug>> {
  const [memberRes, orgRes] = await Promise.all([
    profesionalId
      ? supabase.from("member").select("especialidad").eq("id", profesionalId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("organization")
      .select("especialidad")
      .eq("id", organizationId)
      .maybeSingle(),
  ]);
  if (memberRes.error || orgRes.error) {
    return err(
      "db_error",
      "No pudimos resolver la especialidad del profesional del turno.",
      memberRes.error?.message ?? orgRes.error?.message,
    );
  }
  return ok(
    resolveEspecialidadEfectiva(
      (memberRes.data as { especialidad: string | null } | null)?.especialidad ?? null,
      (orgRes.data as { especialidad: string | null } | null)?.especialidad ?? null,
    ),
  );
}

// ─── Upsert (crear o actualizar pre-lock) ──────────────────────────────

export async function upsertSesion(input: UpsertSesionInput): Promise<Result<{ id: string }>> {
  const parsed = upsertSesionSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos de sesión inválidos.", parsed.error.message);
  }
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  const d = parsed.data;

  // F-AUTH (IDOR / defensa en profundidad): turnoId y pacienteId vienen del
  // caller (cliente). El INSERT/UPDATE estampa session.organizationId y la RLS
  // + el trigger sesion_same_org_guard rechazan en DB un turno/paciente ajeno,
  // pero validamos app-side ANTES de cifrar/escribir para no confiar en IDs del
  // cliente y para que cualquier futuro caller de upsertSesion herede el guard.
  // Una sola lectura confirma (1) turno ∈ org activa y (2) turno.paciente_id ==
  // pacienteId (el trigger M09 garantiza turno.paciente_id en la misma org).
  const { data: turnoRow, error: turnoErr } = await supabase
    .from("turno")
    .select("organization_id, paciente_id, profesional_id")
    .eq("id", d.turnoId)
    .maybeSingle();
  if (turnoErr) {
    return err("db_error", "No pudimos validar el turno.", turnoErr.message);
  }
  const turno = turnoRow as TurnoOwnershipRow;
  const ownership = checkTurnoOwnership(
    turno,
    session.data.organizationId,
    d.pacienteId,
  );
  if (!ownership.ok) {
    return err(ownership.code, ownership.message);
  }

  // ¿Ya existe sesion para este turno? (las columnas tool se leen solo para
  // decidir preservación — tool_data_cifrado viaja opaco, nunca se descifra acá)
  const { data: existingRow } = await supabase
    .from("sesion")
    .select("id, locked_at, tool_id, tool_data_cifrado, vertebras_json")
    .eq("turno_id", d.turnoId)
    .maybeSingle();
  const existing = existingRow as
    | ({ id: string; locked_at: string | null } & SesionToolColumnsRow)
    | null;

  if (existing && existing.locked_at) {
    return err("locked", "La sesión está bloqueada. Creá una enmienda en su lugar.");
  }

  // ── Tool de especialidad (M50/M55) ────────────────────────────────────
  let toolData: unknown = d.toolData ?? null;
  let toolMeta: EspecialidadMeta | null = null;
  // F-PHI: si el guardado viene SIN toolData pero la sesión existente tiene
  // datos de una herramienta que la ficha NO pudo re-hidratar (tool_id de otra
  // especialidad / fila legacy), el UPDATE no debe tocar las columnas tool.
  let preservarToolColumns = false;

  if (toolData == null && d.vertebras) {
    // Callers legacy mandan solo `vertebras` → toolData quiro implícito (sin
    // lookup de especialidad: vertebras ES la herramienta de quiropraxia).
    toolMeta = ESPECIALIDADES_META.quiropraxia;
    toolData = { v: 1, vertebras: d.vertebras } satisfies QuiropraxiaToolData;
  } else if (toolData != null) {
    // M55 · derivación SERVER-SIDE del toolId: especialidad efectiva del
    // PROFESIONAL del turno (especialidadEfectivaDelTurno). Nunca se confía en
    // un toolId del cliente: si el toolValue que llegó es de OTRA herramienta
    // (UI desactualizada / turno reasignado o member.especialidad cambiada
    // entre render y save), el zod .strict() del registry lo RECHAZA con un
    // error de validación visible — las claves desconocidas no se stripean,
    // así que un payload ajeno no puede degradar a `{ v: 1 }` y persistirse
    // con el tool_id equivocado.
    const efectivaRes = await especialidadEfectivaDelTurno(
      supabase,
      turno?.profesional_id ?? null,
      session.data.organizationId,
    );
    if (!efectivaRes.ok) return efectivaRes;
    toolMeta = ESPECIALIDADES_META[efectivaRes.data];
  } else if (existing && sesionTieneToolData(existing)) {
    // Guardado solo-SOAP sobre una sesión que YA tiene datos de herramienta:
    // decidir si el null es un vaciado deliberado (la ficha re-hidrató el
    // borrador y el usuario lo dejó vacío) o datos que la UI nunca mostró
    // (cambio de especialidad entre medio) — en ese caso se preservan.
    const efectivaRes = await especialidadEfectivaDelTurno(
      supabase,
      turno?.profesional_id ?? null,
      session.data.organizationId,
    );
    if (!efectivaRes.ok) return efectivaRes;
    preservarToolColumns = debePreservarToolData(existing, efectivaRes.data);
  }

  // Espejo legacy de quiropraxia (vista M14 + índice gin; se retira en Fase F).
  let vertebrasEspejo: Array<{ id: string; estado: string }> = d.vertebras ?? [];
  let toolId: string | null = null;

  if (toolMeta) {
    const parsedTool = toolMeta.schema.safeParse(toolData);
    if (!parsedTool.success) {
      return err(
        "validation",
        `toolData inválido para ${toolMeta.nombre}.`,
        parsedTool.error.message,
      );
    }
    toolData = parsedTool.data;
    toolId = toolMeta.toolId;
    if (toolMeta.slug === "quiropraxia") {
      vertebrasEspejo = (toolData as QuiropraxiaToolData).vertebras;
    }
  }

  const basePayload = {
    organization_id: session.data.organizationId,
    turno_id: d.turnoId,
    paciente_id: d.pacienteId,
    soap_s_cifrado: encryptColumn(d.soap?.s ?? null),
    soap_o_cifrado: encryptColumn(d.soap?.o ?? null),
    soap_a_cifrado: encryptColumn(d.soap?.a ?? null),
    soap_p_cifrado: encryptColumn(d.soap?.p ?? null),
    notas_cifrado: encryptColumn(d.notas ?? null),
    eva_antes: d.evaAntes ?? null,
    eva_despues: d.evaDespues ?? null,
  };
  // F-PHI: en el caso preservación las columnas tool se OMITEN del UPDATE (el
  // SOAP se guarda igual); en el resto, "el borrador es la verdad completa":
  // toolData null = vaciado deliberado → columnas a NULL / espejo vacío.
  const toolColumns = {
    vertebras_json: vertebrasEspejo,
    tool_id: toolId,
    tool_data_cifrado: toolData == null ? null : encryptColumn(JSON.stringify(toolData)),
  };

  if (existing) {
    const payload = preservarToolColumns ? basePayload : { ...basePayload, ...toolColumns };
    const { error } = await supabase.from("sesion").update(payload).eq("id", existing.id);
    if (error) return err(mapSupabaseError(error).code, mapSupabaseError(error).message, error.message);
    return ok({ id: existing.id });
  }

  const { data, error } = await supabase
    .from("sesion")
    .insert({ ...basePayload, ...toolColumns })
    .select("id")
    .single();

  if (error) return err(mapSupabaseError(error).code, mapSupabaseError(error).message, error.message);
  if (!data) return err("db_error", "No se creó la sesión.");
  return ok({ id: data.id });
}

// ─── Lock (al cerrar turno) ────────────────────────────────────────────

export async function lockSesion(sesionId: string): Promise<Result<void>> {
  if (!z.string().uuid().safeParse(sesionId).success) {
    return err("validation", "ID de sesión inválido.");
  }
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("sesion")
    .update({
      locked_at: new Date().toISOString(),
      locked_by_id: session.data.memberId,
    })
    .eq("id", sesionId)
    .is("locked_at", null);                          // idempotente

  if (error) return err(mapSupabaseError(error).code, mapSupabaseError(error).message, error.message);
  return ok(undefined);
}

// ─── Enmendar (post-lock) ─────────────────────────────────────────────

export async function addEnmienda(
  sesionId: string,
  motivo: string,
  texto: string,
): Promise<Result<{ id: string }>> {
  if (motivo.length < 10) {
    return err("validation", "El motivo debe tener al menos 10 caracteres.");
  }
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("sesion_enmienda")
    .insert({
      organization_id: session.data.organizationId,
      sesion_id: sesionId,
      autor_id: session.data.memberId,
      motivo,
      texto_correccion_cifrado: encryptColumn(texto)!,
    })
    .select("id")
    .single();

  if (error) return err(mapSupabaseError(error).code, mapSupabaseError(error).message, error.message);
  if (!data) return err("db_error", "No se creó la enmienda.");
  return ok({ id: data.id });
}

// ─── Leer sesion + enmiendas (vista sesion_con_enmiendas) ─────────────

export async function getSesionCompleta(sesionId: string): Promise<Result<Record<string, unknown>>> {
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("sesion_con_enmiendas")
    .select("*")
    .eq("id", sesionId)
    .eq("organization_id", session.data.organizationId)
    .maybeSingle();

  if (error) return err(mapSupabaseError(error).code, mapSupabaseError(error).message, error.message);
  if (!data) return err("not_found", "Sesión no encontrada.");

  const row = data as Record<string, unknown>;
  // tryDecrypt (no decryptColumn crudo): un campo corrupto no debe tirar una
  // excepción que escape el contrato Result y tumbe la vista de la sesión —
  // degrada ese campo a null y reporta a Sentry.
  return ok({
    ...row,
    soap: {
      s: tryDecrypt(row.soap_s_cifrado as Buffer | null, "sesion.soap_s"),
      o: tryDecrypt(row.soap_o_cifrado as Buffer | null, "sesion.soap_o"),
      a: tryDecrypt(row.soap_a_cifrado as Buffer | null, "sesion.soap_a"),
      p: tryDecrypt(row.soap_p_cifrado as Buffer | null, "sesion.soap_p"),
    },
    notas: tryDecrypt(row.notas_cifrado as Buffer | null, "sesion.notas"),
  });
}
