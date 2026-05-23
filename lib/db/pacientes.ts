/**
 * Folio · queries y mutations de Paciente.
 *
 * Maneja el split PII (paciente_identidad) / PHI (paciente). Las funciones
 * de creación cifran nombre/apellido/dni/email/teléfono ANTES de INSERT
 * usando `lib/crypto.ts`, y desencriptan al leer si el rol del usuario lo
 * permite (RLS controla la fila; la app desencripta los bytea).
 */

import { z } from "zod";

import { blindIndex, blindIndexPhone, decryptColumn, encryptColumn } from "@/lib/crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, mapSupabaseError, ok, type Result } from "./errors";
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
  motivoConsulta: z.string().max(2000).optional(),
  notasImportantes: z.string().max(2000).optional(),
  tags: z.array(z.string().max(40)).max(10).default([]),
  profesionalPrincipalId: z.string().uuid().optional(),
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
}

// ─── Listar (vista paciente_directorio_lite) ──────────────────────────

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

  const decoded: PacienteDecoded[] = (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.paciente_id),
    identidadId: (row.identidad_id as string | null) ?? null,
    nombre: decryptColumn((row.nombre_cifrado as Buffer | null) ?? null),
    apellido: decryptColumn((row.apellido_cifrado as Buffer | null) ?? null),
    telefono: decryptColumn((row.telefono_cifrado as Buffer | null) ?? null),
    email: decryptColumn((row.email_cifrado as Buffer | null) ?? null),
    tipo: (row.tipo_paciente as "NUEVO" | "RECURRENTE") ?? "NUEVO",
    tags: (row.tags as string[]) ?? [],
    pseudonimizado: row.pseudonimizado_en != null,
    fechaNacimiento: (row.fecha_nacimiento as string | null) ?? null,
    ciudad: (row.domicilio_ciudad as string | null) ?? null,
    provincia: (row.domicilio_provincia as string | null) ?? null,
    ultimaVisita: (row.ultima_visita as string | null) ?? null,
    proximoTurno: (row.proximo_turno as string | null) ?? null,
    sesionesCompletadas: Number(row.sesiones_completadas ?? 0),
  }));

  return ok(decoded);
}

// ─── Buscar (blind index sobre nombre o DNI) ──────────────────────────

export async function buscarPaciente(query: string): Promise<Result<PacienteDecoded[]>> {
  if (!query || query.trim().length < 2) return ok([]);
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  const queryHash = blindIndex(query);
  if (!queryHash) return ok([]);

  // Buscar por nombre_hash O dni_hash
  const { data, error } = await supabase
    .from("paciente_directorio_lite")
    .select("*")
    .eq("organization_id", session.data.organizationId)
    .or(`nombre_hash.eq.${queryHash},dni_hash.eq.${queryHash}`)
    .is("deleted_at", null)
    .limit(20);

  if (error) return err("db_error", "Error buscando pacientes.", error.message);

  // Decode (igual que listPacientesDirectorio)
  const decoded: PacienteDecoded[] = (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.paciente_id),
    identidadId: (row.identidad_id as string | null) ?? null,
    nombre: decryptColumn((row.nombre_cifrado as Buffer | null) ?? null),
    apellido: decryptColumn((row.apellido_cifrado as Buffer | null) ?? null),
    telefono: decryptColumn((row.telefono_cifrado as Buffer | null) ?? null),
    email: decryptColumn((row.email_cifrado as Buffer | null) ?? null),
    tipo: (row.tipo_paciente as "NUEVO" | "RECURRENTE") ?? "NUEVO",
    tags: (row.tags as string[]) ?? [],
    pseudonimizado: row.pseudonimizado_en != null,
    fechaNacimiento: (row.fecha_nacimiento as string | null) ?? null,
    ciudad: (row.domicilio_ciudad as string | null) ?? null,
    provincia: (row.domicilio_provincia as string | null) ?? null,
    ultimaVisita: (row.ultima_visita as string | null) ?? null,
    proximoTurno: (row.proximo_turno as string | null) ?? null,
    sesionesCompletadas: Number(row.sesiones_completadas ?? 0),
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

  const supabase = await createSupabaseServerClient();
  const d = parsed.data;

  // 1. Insert paciente_identidad (PII cifrada)
  const nombreFull = `${d.nombre} ${d.apellido}`;
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
      fecha_nacimiento: d.fechaNacimiento ?? null,
      sexo_biologico: d.sexoBiologico ?? null,
      genero_autopercibido: d.generoAutopercibido ?? null,
      domicilio_ciudad: d.domicilioCiudad ?? null,
      domicilio_provincia: d.domicilioProvincia ?? null,
      domicilio_cp: d.domicilioCp ?? null,
      nombre_hash: blindIndex(nombreFull),
      dni_hash: d.numeroDoc ? blindIndex(d.numeroDoc) : null,
      telefono_hash: blindIndexPhone(d.telefono),
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
      profesional_principal_id: d.profesionalPrincipalId ?? session.data.memberId,
    })
    .select("id")
    .single();

  if (pacErr || !paciente) {
    // Rollback manual de identidad (en F11 mejorar con stored proc transaccional)
    await supabase.from("paciente_identidad").delete().eq("id", identidad.id);
    const mapped = pacErr ? mapSupabaseError(pacErr) : { code: "db_error" as const, message: "No se creó el paciente." };
    return err(mapped.code, mapped.message, pacErr?.message);
  }

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
    nombre: decryptColumn(row.nombre_cifrado as Buffer | null),
    apellido: decryptColumn(row.apellido_cifrado as Buffer | null),
    telefono: decryptColumn(row.telefono_cifrado as Buffer | null),
    email: decryptColumn(row.email_cifrado as Buffer | null),
    numero_doc: decryptColumn(row.numero_doc_cifrado as Buffer | null),
    domicilio_calle: decryptColumn(row.domicilio_calle_cifrado as Buffer | null),
    domicilio_numero: decryptColumn(row.domicilio_numero_cifrado as Buffer | null),
    motivo_consulta: decryptColumn(row.motivo_consulta_cifrado as Buffer | null),
    notas_importantes: decryptColumn(row.notas_importantes_cifrado as Buffer | null),
  });
}
