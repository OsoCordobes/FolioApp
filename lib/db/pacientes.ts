/**
 * Folio · queries y mutations de Paciente.
 *
 * Maneja el split PII (paciente_identidad) / PHI (paciente). Las funciones
 * de creación cifran nombre/apellido/dni/email/teléfono ANTES de INSERT
 * usando `lib/crypto.ts`, y desencriptan al leer si el rol del usuario lo
 * permite (RLS controla la fila; la app desencripta los bytea).
 */

import { z } from "zod";

import { capabilitiesFor } from "@/lib/auth/capabilities";
import { blindIndex, blindIndexPhone, encryptColumn, tryDecrypt } from "@/lib/crypto";
import { ESPECIALIDAD_SLUGS } from "@/lib/especialidades/meta";
import { trackEvent } from "@/lib/observability/events";
import { coberturaInputSchema, normalizarCobertura } from "@/lib/pacientes/cobertura";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, mapSupabaseError, ok, type Result } from "./errors";
import { savePacienteIntakeAvanzado } from "./paciente-intake";
import { resolveProfesionalDestino } from "./profesional-destino";
import { getActiveSession } from "./session";

// ─── Schemas Zod ────────────────────────────────────────────────────────

const tipoDocSchema = z.enum(["DNI", "LE", "LC", "CI", "PASAPORTE"]);

const createPacienteSchema = z.object({
  nombre: z.string().min(1).max(80),
  apellido: z.string().min(1).max(80),
  tipoDoc: tipoDocSchema.default("DNI"),
  numeroDoc: z.string().min(5).max(20).optional(),
  email: z.string().email().optional(),
  telefono: z.string().min(6).max(30),
  fechaNacimiento: z.string().date().optional(),
  sexoBiologico: z.enum(["M", "F", "I"]).optional(),
  generoAutopercibido: z.string().max(40).optional(),
  domicilioCalle: z.string().max(120).optional(),
  domicilioNumero: z.string().max(20).optional(),
  domicilioCiudad: z.string().max(60).optional(),
  domicilioProvincia: z.string().max(60).optional(),
  domicilioCp: z.string().max(15).optional(),
  // M59 · campos comunes de intake (PII cifrada en paciente_identidad).
  ocupacion: z.string().max(120).optional(),
  recomendadoPor: z.string().max(120).optional(),
  motivoConsulta: z.string().max(2000).optional(),
  notasImportantes: z.string().max(2000).optional(),
  tags: z.array(z.string().max(40)).max(10).default([]),
  profesionalPrincipalId: z.string().uuid().optional(),
  // F7a (M89) · cobertura del paciente: obra social/prepaga + plan (en claro)
  // y nº de afiliado (se cifra). Todos opcionales — sin cobertura = particular.
  ...coberturaInputSchema.shape,
  // Workstream 5 · intake avanzado por especialidad (opcional, M60). Se inserta
  // best-effort DESPUÉS del paciente — nunca bloquea el alta (ver createPaciente).
  intakeAvanzado: z
    .object({
      especialidad: z.enum(ESPECIALIDAD_SLUGS),
      datos: z.record(z.string(), z.unknown()),
    })
    .optional(),
});

export type CreatePacienteInput = z.infer<typeof createPacienteSchema>;

export interface PacienteDecoded {
  id: string;
  identidadId: string | null;
  nombre: string | null;
  apellido: string | null;
  telefono: string | null;
  email: string | null;
  tipo: "NUEVO" | "RECURRENTE";
  tags: string[];
  pseudonimizado: boolean;
  fechaNacimiento: string | null;
  ciudad: string | null;
  provincia: string | null;
  ultimaVisita: string | null;
  proximoTurno: string | null;
  sesionesCompletadas: number;
  /**
   * F7a (M89) · cobertura EN CLARO (nombre + plan) para columna/filtro/export
   * del directorio. null = particular / sin informar. Solo la llena
   * `listPacientesDirectorio` (la vista M14 no expone las columnas — se
   * joinean acá contra paciente_identidad); `buscarPaciente` la deja en null.
   */
  coberturaNombre: string | null;
  coberturaPlan: string | null;
}

// ─── Listar (vista paciente_directorio_lite) ──────────────────────────

/**
 * Tamaño de chunk del lookup `.in("id", …)` de coberturas (F7a · M89). Mismo
 * valor que el LOOKUP_CHUNK del importador: mantiene la URL de PostgREST
 * lejos del límite de largo sin multiplicar round-trips.
 */
const COBERTURA_LOOKUP_CHUNK = 100;

export async function listPacientesDirectorio(): Promise<Result<PacienteDecoded[]>> {
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("paciente_directorio_lite")
    .select("*")
    .eq("organization_id", session.data.organizationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) return err("db_error", "Error listando pacientes.", error.message);

  // F7a (M89) · cobertura del directorio. La vista `paciente_directorio_lite`
  // (M14) no expone las columnas nuevas y las vistas son append-only-por-
  // migración: en vez de redefinirla, un segundo SELECT barato sobre
  // paciente_identidad (columnas EN CLARO, org-scoped por RLS) y join en
  // memoria por identidad_id. Best-effort: si falla, el directorio sale sin
  // cobertura (null = "Particular") en vez de romperse — pero el fallo se
  // reporta a Sentry: si no, una regresión de schema/RLS mostraría "Particular"
  // en TODO el directorio sin una sola señal.
  //
  // Se busca por los identidad_id de ESTA página (chunks de LOOKUP_CHUNK, como
  // el importador) en vez de "todas las identidades de la org": PostgREST
  // corta en 1000 filas por request, y ese techo aplicado a un SELECT sin
  // orden explícito desalinearía el join con el directorio (pacientes reales
  // apareciendo como "Particular" a partir del paciente 1001).
  const coberturas = new Map<string, { nombre: string | null; plan: string | null }>();
  const identidadIds = Array.from(
    new Set(
      (data ?? [])
        .map((row: Record<string, unknown>) => row.identidad_id as string | null)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );
  for (let i = 0; i < identidadIds.length; i += COBERTURA_LOOKUP_CHUNK) {
    const chunk = identidadIds.slice(i, i + COBERTURA_LOOKUP_CHUNK);
    const { data: cobRows, error: cobErr } = await supabase
      .from("paciente_identidad")
      .select("id, cobertura_nombre, cobertura_plan")
      .eq("organization_id", session.data.organizationId)
      .in("id", chunk)
      .is("deleted_at", null);
    if (cobErr) {
      // No rompemos el directorio, pero tampoco callamos: sin esto el modo
      // degradado ("todos particulares") es indistinguible del dato real.
      console.error(`[pacientes] lookup de cobertura falló: ${cobErr.message}`);
      const { captureException } = await import("@sentry/nextjs");
      captureException(new Error(`Cobertura lookup falló — ${cobErr.message}`), {
        tags: { component: "pacientes", op: "listPacientesDirectorio.cobertura" },
      });
      break;
    }
    for (const c of (cobRows ?? []) as Array<Record<string, unknown>>) {
      coberturas.set(String(c.id), {
        nombre: (c.cobertura_nombre as string | null) ?? null,
        plan: (c.cobertura_plan as string | null) ?? null,
      });
    }
  }

  const decoded: PacienteDecoded[] = (data ?? []).map((row: Record<string, unknown>) => {
    const cobertura = row.identidad_id ? coberturas.get(String(row.identidad_id)) : undefined;
    return {
      id: String(row.paciente_id),
      identidadId: (row.identidad_id as string | null) ?? null,
      nombre: tryDecrypt((row.nombre_cifrado as Buffer | null) ?? null, "paciente.nombre"),
      apellido: tryDecrypt((row.apellido_cifrado as Buffer | null) ?? null, "paciente.apellido"),
      telefono: tryDecrypt((row.telefono_cifrado as Buffer | null) ?? null, "paciente.telefono"),
      email: tryDecrypt((row.email_cifrado as Buffer | null) ?? null, "paciente.email"),
      tipo: (row.tipo_paciente as "NUEVO" | "RECURRENTE") ?? "NUEVO",
      tags: (row.tags as string[]) ?? [],
      pseudonimizado: row.pseudonimizado_en != null,
      fechaNacimiento: (row.fecha_nacimiento as string | null) ?? null,
      ciudad: (row.domicilio_ciudad as string | null) ?? null,
      provincia: (row.domicilio_provincia as string | null) ?? null,
      ultimaVisita: (row.ultima_visita as string | null) ?? null,
      proximoTurno: (row.proximo_turno as string | null) ?? null,
      sesionesCompletadas: Number(row.sesiones_completadas ?? 0),
      coberturaNombre: cobertura?.nombre ?? null,
      coberturaPlan: cobertura?.plan ?? null,
    };
  });

  return ok(decoded);
}

// ─── Buscar (blind index sobre nombre o DNI) ──────────────────────────

export async function buscarPaciente(query: string): Promise<Result<PacienteDecoded[]>> {
  if (!query || query.trim().length < 2) return ok([]);
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  const orgId = session.data.organizationId;

  // Per-tenant salt (Sprint 1 T1.5.3 / audit A2). Computamos ambos hashes
  // (con y sin salt) durante la ventana de transición; primero buscamos
  // con salt, y si no hay resultados intentamos con el hash legacy. Una
  // vez que el rehash (T1.5.4) corra y 72h pasen sin fallbacks legacy,
  // el código del fallback se remueve en T1.5.5.
  const queryHash = blindIndex(query, orgId);
  const queryHashLegacy = blindIndex(query);
  if (!queryHash) return ok([]);

  // Buscar por nombre_hash O dni_hash con el hash salted.
  const { data: salted, error: saltedErr } = await supabase
    .from("paciente_directorio_lite")
    .select("*")
    .eq("organization_id", orgId)
    .or(`nombre_hash.eq.${queryHash},dni_hash.eq.${queryHash}`)
    .is("deleted_at", null)
    .limit(20);

  if (saltedErr) return err("db_error", "Error buscando pacientes.", saltedErr.message);

  let data = salted ?? [];

  // Fallback legacy: si el salted lookup no devolvió nada y el legacy hash
  // es distinto, probar con el hash sin salt. Loguear a Sentry para
  // monitorear el progreso del backfill — cuando este log deja de aparecer
  // por 72h, T1.5.5 puede remover el fallback.
  if (data.length === 0 && queryHashLegacy && queryHashLegacy !== queryHash) {
    const { data: legacy, error: legacyErr } = await supabase
      .from("paciente_directorio_lite")
      .select("*")
      .eq("organization_id", orgId)
      .or(`nombre_hash.eq.${queryHashLegacy},dni_hash.eq.${queryHashLegacy}`)
      .is("deleted_at", null)
      .limit(20);

    if (legacyErr) return err("db_error", "Error buscando pacientes.", legacyErr.message);
    if (legacy && legacy.length > 0) {
      const { captureMessage } = await import("@sentry/nextjs");
      captureMessage("blind-index-legacy-fallback fired in buscarPaciente", {
        level: "warning",
        tags: { audit: "A2", fallback: "buscarPaciente" },
        extra: { orgId, hitCount: legacy.length },
      });
      data = legacy;
    }
  }

  // Decode (igual que listPacientesDirectorio)
  const decoded: PacienteDecoded[] = (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.paciente_id),
    identidadId: (row.identidad_id as string | null) ?? null,
    nombre: tryDecrypt((row.nombre_cifrado as Buffer | null) ?? null, "paciente.nombre"),
    apellido: tryDecrypt((row.apellido_cifrado as Buffer | null) ?? null, "paciente.apellido"),
    telefono: tryDecrypt((row.telefono_cifrado as Buffer | null) ?? null, "paciente.telefono"),
    email: tryDecrypt((row.email_cifrado as Buffer | null) ?? null, "paciente.email"),
    tipo: (row.tipo_paciente as "NUEVO" | "RECURRENTE") ?? "NUEVO",
    tags: (row.tags as string[]) ?? [],
    pseudonimizado: row.pseudonimizado_en != null,
    fechaNacimiento: (row.fecha_nacimiento as string | null) ?? null,
    ciudad: (row.domicilio_ciudad as string | null) ?? null,
    provincia: (row.domicilio_provincia as string | null) ?? null,
    ultimaVisita: (row.ultima_visita as string | null) ?? null,
    proximoTurno: (row.proximo_turno as string | null) ?? null,
    sesionesCompletadas: Number(row.sesiones_completadas ?? 0),
    // La búsqueda no necesita cobertura (se usa para pickers/quick-search);
    // solo el directorio la joinea. null = sin dato acá, no "particular".
    coberturaNombre: null,
    coberturaPlan: null,
  }));

  return ok(decoded);
}

// ─── Crear paciente (PII + PHI atómico) ──────────────────────────────

export async function createPaciente(input: CreatePacienteInput): Promise<Result<{ id: string }>> {
  const parsed = createPacienteSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos del paciente inválidos.", parsed.error.message);
  }
  const session = await getActiveSession();
  if (!session.ok) return session;

  // M1 (docs/AUDIT.md): esta función crea el PAR identidad (PII) + paciente
  // (PHI). La RLS de `paciente` ya bloquea el INSERT de PHI a roles no
  // clínicos, pero recién en el paso 2 — dejaría una identidad huérfana
  // (el rollback manual de abajo choca con paciente_identidad_no_delete).
  // Cortamos antes, espejando capabilities.canCreatePacienteClinical.
  const caps = capabilitiesFor(session.data.role, session.data.esColegiado);
  if (!caps.canCreatePacienteClinical) {
    return err(
      "forbidden",
      "Tu rol no permite crear la ficha clínica de un paciente. Pedile a un profesional o a dirección que lo registre.",
    );
  }

  const supabase = await createSupabaseServerClient();
  const d = parsed.data;

  // Profesional principal (CLINICA-4, review #52 — misma medicina que
  // CLINICA-3 aplicó en turnos): el fallback ciego a session.memberId
  // asignaba como "profesional principal" a un OWNER/DIRECTOR no colegiado.
  // resolveProfesionalDestino valida el param explícito como colegiado
  // activo de la org, usa la sesión solo si ES colegiada, y si no → err
  // accionable. Va ANTES del insert de identidad para no dejar una
  // identidad huérfana ante un destino inválido.
  const profRes = await resolveProfesionalDestino(supabase, {
    organizationId: session.data.organizationId,
    profesionalId: d.profesionalPrincipalId ?? null,
    sessionMemberId: session.data.memberId,
    sessionEsColegiado: session.data.esColegiado,
  });
  if (!profRes.ok) return profRes;
  const profesionalPrincipalId = profRes.data;

  // 1. Insert paciente_identidad (PII cifrada)
  const nombreFull = `${d.nombre} ${d.apellido}`;
  // F7a (M89) · cobertura normalizada: trim, vacío → null, "Particular" → null
  // (el canónico de particular es cobertura_nombre NULL). El nº de afiliado se
  // CIFRA (mismo tratamiento que el DNI); nombre y plan van en claro (filtro).
  const cobertura = normalizarCobertura({
    nombre: d.coberturaNombre,
    plan: d.coberturaPlan,
    nroAfiliado: d.coberturaNroAfiliado,
  });
  const { data: identidad, error: idErr } = await supabase
    .from("paciente_identidad")
    .insert({
      organization_id: session.data.organizationId,
      nombre_cifrado: encryptColumn(d.nombre)!,
      apellido_cifrado: encryptColumn(d.apellido)!,
      tipo_doc: d.tipoDoc,
      numero_doc_cifrado: encryptColumn(d.numeroDoc ?? null),
      email_cifrado: encryptColumn(d.email ?? null),
      telefono_cifrado: encryptColumn(d.telefono)!,
      domicilio_calle_cifrado: encryptColumn(d.domicilioCalle ?? null),
      domicilio_numero_cifrado: encryptColumn(d.domicilioNumero ?? null),
      // M59 · campos comunes de intake (PII cifrada). recomendado_por es PII de
      // un tercero; ambos los borra la pseudonimización al eliminar la identidad.
      ocupacion_cifrado: encryptColumn(d.ocupacion ?? null),
      recomendado_por_cifrado: encryptColumn(d.recomendadoPor ?? null),
      fecha_nacimiento: d.fechaNacimiento ?? null,
      sexo_biologico: d.sexoBiologico ?? null,
      genero_autopercibido: d.generoAutopercibido ?? null,
      domicilio_ciudad: d.domicilioCiudad ?? null,
      domicilio_provincia: d.domicilioProvincia ?? null,
      domicilio_cp: d.domicilioCp ?? null,
      // F7a (M89) · cobertura: nombre/plan en claro, nº afiliado cifrado.
      cobertura_nombre: cobertura.nombre,
      cobertura_plan: cobertura.plan,
      cobertura_nro_afiliado_cifrado: encryptColumn(cobertura.nroAfiliado),
      // Per-tenant salt (Sprint 1 T1.5.3 / audit A2)
      nombre_hash: blindIndex(nombreFull, session.data.organizationId),
      dni_hash: d.numeroDoc ? blindIndex(d.numeroDoc, session.data.organizationId) : null,
      telefono_hash: blindIndexPhone(d.telefono, session.data.organizationId),
    })
    .select("id")
    .single();

  if (idErr || !identidad) {
    const mapped = idErr ? mapSupabaseError(idErr) : { code: "db_error" as const, message: "No se creó la identidad." };
    return err(mapped.code, mapped.message, idErr?.message);
  }

  // 2. Insert paciente (PHI) FK a identidad
  const { data: paciente, error: pacErr } = await supabase
    .from("paciente")
    .insert({
      organization_id: session.data.organizationId,
      identidad_id: identidad.id,
      motivo_consulta_cifrado: encryptColumn(d.motivoConsulta ?? null),
      notas_importantes_cifrado: encryptColumn(d.notasImportantes ?? null),
      tags: d.tags,
      profesional_principal_id: profesionalPrincipalId,
    })
    .select("id")
    .single();

  if (pacErr || !paciente) {
    // Rollback manual de identidad (en F11 mejorar con stored proc transaccional)
    await supabase.from("paciente_identidad").delete().eq("id", identidad.id);
    const mapped = pacErr ? mapSupabaseError(pacErr) : { code: "db_error" as const, message: "No se creó el paciente." };
    return err(mapped.code, mapped.message, pacErr?.message);
  }

  // Workstream 5 · intake avanzado (opcional, M60). BEST-EFFORT: el alta NUNCA
  // se bloquea ni se rollbackea por el intake (requisito del owner: la sección
  // avanzada jamás impide guardar al paciente). Solo se intenta si hay al menos
  // un valor no vacío; si falla, se ignora (el savePacienteIntakeAvanzado ya
  // valida + cifra server-side y mapea sus propios errores). El paciente queda
  // creado y el usuario puede completar/corregir el avanzado desde la ficha.
  if (d.intakeAvanzado && tieneAlgunValor(d.intakeAvanzado.datos)) {
    await savePacienteIntakeAvanzado({
      pacienteId: paciente.id,
      especialidad: d.intakeAvanzado.especialidad,
      datos: d.intakeAvanzado.datos,
    });
  }

  // Business event (Sprint 2 T2.2). Fire-and-forget: si PostHog falla no
  // bloquea el flow del usuario. captureServerEvent ya hace no-op si
  // POSTHOG_KEY no está configurada.
  void trackEvent.pacienteCreated({
    orgId: session.data.organizationId,
    source: "manual",
    hasDni: Boolean(d.numeroDoc),
    hasEmail: Boolean(d.email),
    isInternal: session.data.isInternalAccount,
  });

  return ok({ id: paciente.id });
}

// ─── Get individual (vista paciente_completo) ────────────────────────

export async function getPacienteCompleto(pacienteId: string): Promise<Result<Record<string, unknown>>> {
  if (!z.string().uuid().safeParse(pacienteId).success) {
    return err("validation", "ID de paciente inválido.");
  }
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("paciente_completo")
    .select("*")
    .eq("id", pacienteId)
    .eq("organization_id", session.data.organizationId)
    .maybeSingle();

  if (error) return err(mapSupabaseError(error).code, mapSupabaseError(error).message, error.message);
  if (!data) return err("not_found", "Paciente no encontrado o sin permisos.");

  // Decode los cifrados
  const row = data as Record<string, unknown>;
  return ok({
    ...row,
    nombre: tryDecrypt(row.nombre_cifrado as Buffer | null, "paciente.nombre"),
    apellido: tryDecrypt(row.apellido_cifrado as Buffer | null, "paciente.apellido"),
    telefono: tryDecrypt(row.telefono_cifrado as Buffer | null, "paciente.telefono"),
    email: tryDecrypt(row.email_cifrado as Buffer | null, "paciente.email"),
    numero_doc: tryDecrypt(row.numero_doc_cifrado as Buffer | null, "paciente.numero_doc"),
    domicilio_calle: tryDecrypt(row.domicilio_calle_cifrado as Buffer | null, "paciente.domicilio_calle"),
    domicilio_numero: tryDecrypt(row.domicilio_numero_cifrado as Buffer | null, "paciente.domicilio_numero"),
    motivo_consulta: tryDecrypt(row.motivo_consulta_cifrado as Buffer | null, "paciente.motivo_consulta"),
    notas_importantes: tryDecrypt(row.notas_importantes_cifrado as Buffer | null, "paciente.notas_importantes"),
  });
}

// ─── Cobertura (obra social / prepaga) — F7a, M89 ────────────────────────────

const updateCoberturaSchema = z.object({
  pacienteId: z.string().uuid(),
  ...coberturaInputSchema.shape,
});

export type UpdatePacienteCoberturaInput = z.infer<typeof updateCoberturaSchema>;

/**
 * Actualiza SOLO los 3 campos de cobertura de la identidad del paciente
 * (edición desde la ficha, tab Información). Campos vacíos/"Particular" →
 * NULL (borra el valor). El nº de afiliado se cifra app-side (M89 — mismo
 * tratamiento que el DNI); nombre y plan quedan en claro para filtro/export.
 *
 * Tenancy: la identidad se resuelve vía `paciente_directorio_lite` (org
 * activa) y el UPDATE va por el cliente RLS-aware — la policy
 * `paciente_identidad_update_admin` (M03) es el gate real (OWNER, DIRECTOR,
 * PROFESIONAL, ASISTENTE de la org).
 */
export async function updatePacienteCobertura(
  input: UpdatePacienteCoberturaInput,
): Promise<Result<{ identidadId: string }>> {
  const parsed = updateCoberturaSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos de cobertura inválidos.", parsed.error.message);
  }
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();

  // Resolver la identidad del paciente dentro de la org activa (guard IDOR:
  // un pacienteId de otra org no matchea y devuelve not_found).
  const { data: dirRow, error: dirErr } = await supabase
    .from("paciente_directorio_lite")
    .select("identidad_id")
    .eq("paciente_id", parsed.data.pacienteId)
    .eq("organization_id", session.data.organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (dirErr) return err("db_error", "Error leyendo el paciente.", dirErr.message);
  const identidadId = (dirRow as { identidad_id: string | null } | null)?.identidad_id ?? null;
  if (!identidadId) return err("not_found", "Paciente no encontrado o sin permisos.");

  const cobertura = normalizarCobertura({
    nombre: parsed.data.coberturaNombre,
    plan: parsed.data.coberturaPlan,
    nroAfiliado: parsed.data.coberturaNroAfiliado,
  });

  const { data: updated, error: updErr } = await supabase
    .from("paciente_identidad")
    .update({
      cobertura_nombre: cobertura.nombre,
      cobertura_plan: cobertura.plan,
      cobertura_nro_afiliado_cifrado: encryptColumn(cobertura.nroAfiliado),
    })
    .eq("id", identidadId)
    .eq("organization_id", session.data.organizationId)
    .select("id");

  if (updErr) {
    const mapped = mapSupabaseError(updErr);
    return err(mapped.code, mapped.message, updErr.message);
  }
  if (!updated || updated.length === 0) {
    // RLS bloqueó el UPDATE (rol sin permiso de edición de identidad).
    return err("forbidden", "Tu rol no permite editar la cobertura del paciente.");
  }

  return ok({ identidadId });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * ¿El objeto de datos del intake avanzado tiene AL MENOS un valor "real"?
 * (string no vacío o booleano true). Sirve para no insertar una fila vacía si el
 * usuario abrió la sección avanzada pero no completó nada. `false` (un checkbox
 * destildado) cuenta como "sin valor" — no aporta información clínica.
 */
function tieneAlgunValor(datos: Record<string, unknown>): boolean {
  return Object.values(datos).some((v) => {
    if (typeof v === "string") return v.trim().length > 0;
    if (typeof v === "boolean") return v === true;
    return v != null;
  });
}
