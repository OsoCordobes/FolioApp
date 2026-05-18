/**
 * Folio · /pacientes/[id] data fetcher (Sprint S1 T-1.7).
 *
 * Devuelve dos shapes compatibles con el prototipo:
 *   - `paciente`: misma forma que el const PACIENTE_DETALLE del mock.
 *   - `plan`: misma forma que el const PLAN del mock.
 *
 * Fuentes:
 *   - `paciente_completo` (vista M14): PII desencriptada + counters de
 *     diagnósticos/alergias/medicaciones activos.
 *   - `turno_extendido` filtrado por paciente: lista de sesiones reales
 *     ordenadas desc por inicio.
 *   - `sesion`: trae SOAP de la sesión más reciente "abierta" o "cerrada".
 *   - `vertebras_json` de la última sesion: mapeo para SpineMap.
 *
 * Si el paciente no tiene sesiones todavía, se devuelve un `plan` mínimo
 * (SOAP vacío, 0 sesiones completadas, sin diagnóstico).
 *
 * Role gating: el caller decide qué mostrar según `role`. Si role es
 * ASISTENTE, NO se debe llamar este fetcher (devuelve PHI). El page.tsx
 * gating: si ASISTENTE, redirigir a `/pacientes`.
 */

import { decryptColumn } from "@/lib/crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, ok, type Result } from "./errors";

// ─── Shapes esperados por el componente (prototipo) ───────────────────────

export type EstadoVertebra = "normal" | "leve" | "moderado" | "severo" | "ajustada";

export interface PacienteFichaInfo {
  id: string;
  nombre: string;
  tipo: "nuevo" | "recurrente";
  sesiones: number;
  edad: number;
  genero: "F" | "M";
  motivo: string;
  tags: string[];
  notasImportantes: string;
  telefono: string;
  tel: string;
  email: string;
}

export interface SesionPlan {
  fecha: string;          // YYYY-MM-DD
  servicio: string;
  dur: number;
  cambio: string;
  vertebras: string[];
}

export interface PlanData {
  total: number;
  completadas: number;
  frecuencia: string;
  inicio: string;
  proximoControl: string;
  precio: number;
  diagnostico: string;
  vertebrasEstado: Record<string, EstadoVertebra>;
  ultimoAjuste: Record<string, string>;
  soap: { subjetivo: string; objetivo: string; analisis: string; plan: string };
  sesiones: SesionPlan[];
}

export interface PacienteFichaData {
  paciente: PacienteFichaInfo;
  plan: PlanData;
  cumple: string; // "18 may" o "—"
}

// ─── Tipos de rows DB ──────────────────────────────────────────────────────

interface PacienteCompletoRow {
  id: string;
  organization_id: string;
  identidad_id: string | null;
  tipo_paciente: "NUEVO" | "ACTIVO" | "EN_ESPERA" | "INACTIVO";
  tags: string[] | null;
  motivo_consulta_cifrado: string | null;
  notas_importantes_cifrado: string | null;
  fecha_nacimiento: string | null;
  sexo_biologico: "M" | "F" | "I" | null;
  nombre_cifrado: string | null;
  apellido_cifrado: string | null;
  email_cifrado: string | null;
  telefono_cifrado: string | null;
  diagnosticos_activos: number;
  alergias_activas: number;
  medicaciones_vigentes: number;
}

interface SesionRow {
  id: string;
  turno_id: string;
  paciente_id: string;
  soap_s_cifrado: string | null;
  soap_o_cifrado: string | null;
  soap_a_cifrado: string | null;
  soap_p_cifrado: string | null;
  vertebras_json: Array<{ id: string; estado: string }> | null;
  notas_cifrado: string | null;
  created_at: string;
}

interface TurnoExtRow {
  id: string;
  inicio: string;
  duracion_min: number;
  duracion_real_min: number | null;
  estado: string;
  servicio_nombre: string;
}

// ─── Fetcher principal ─────────────────────────────────────────────────────

export async function getPacienteFicha(
  pacienteId: string,
  organizationId: string,
): Promise<Result<PacienteFichaData>> {
  if (!/^[0-9a-f-]{36}$/i.test(pacienteId)) {
    return err("validation", "ID de paciente inválido.");
  }

  const supabase = await createSupabaseServerClient();

  const [pacRes, sesionesRes, turnosRes] = await Promise.all([
    supabase
      .from("paciente_completo")
      .select("*")
      .eq("id", pacienteId)
      .eq("organization_id", organizationId)
      .maybeSingle(),
    supabase
      .from("sesion")
      .select("id, turno_id, paciente_id, soap_s_cifrado, soap_o_cifrado, soap_a_cifrado, soap_p_cifrado, vertebras_json, notas_cifrado, created_at")
      .eq("paciente_id", pacienteId)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("turno_extendido")
      .select("id, inicio, duracion_min, duracion_real_min, estado, servicio_nombre")
      .eq("paciente_id", pacienteId)
      .eq("organization_id", organizationId)
      .order("inicio", { ascending: false })
      .limit(10),
  ]);

  if (pacRes.error) return err("db_error", "Error leyendo paciente.", pacRes.error.message);
  if (!pacRes.data) return err("not_found", "Paciente no encontrado o sin permisos.");

  const row = pacRes.data as unknown as PacienteCompletoRow;
  const sesiones = (sesionesRes.data ?? []) as unknown as SesionRow[];
  const turnos = (turnosRes.data ?? []) as unknown as TurnoExtRow[];

  const nombre = tryDecrypt(row.nombre_cifrado, "nombre");
  const apellido = tryDecrypt(row.apellido_cifrado, "apellido");
  const fullName = [nombre, apellido].filter(Boolean).join(" ").trim() || "Paciente sin nombre";
  const motivo = tryDecrypt(row.motivo_consulta_cifrado, "motivo") ?? "";
  const notas = tryDecrypt(row.notas_importantes_cifrado, "notas") ?? "";
  const tel = tryDecrypt(row.telefono_cifrado, "telefono") ?? "";
  const email = tryDecrypt(row.email_cifrado, "email") ?? "";

  const cerrados = turnos.filter((t) => t.estado === "CERRADO");
  const sesionesCompletadas = cerrados.length;
  const lastSesion = sesiones[0] ?? null;

  // Diagnóstico: para MVP usamos el motivo de consulta como diagnóstico de display.
  // Cuando T-1.7 expanda a leer tabla `diagnostico`, mostraremos el principal activo.
  const diagnostico = motivo || "—";

  // SOAP: si hay última sesión, leer su contenido; sino vacío.
  const soap = lastSesion
    ? {
        subjetivo: tryDecrypt(lastSesion.soap_s_cifrado, "soap.s") ?? "",
        objetivo: tryDecrypt(lastSesion.soap_o_cifrado, "soap.o") ?? "",
        analisis: tryDecrypt(lastSesion.soap_a_cifrado, "soap.a") ?? "",
        plan: tryDecrypt(lastSesion.soap_p_cifrado, "soap.p") ?? "",
      }
    : { subjetivo: "", objetivo: "", analisis: "", plan: "" };

  // Vertebras: tomar el estado de la última sesión que las tenga.
  const vertebrasEstado: Record<string, EstadoVertebra> = {};
  const ultimoAjuste: Record<string, string> = {};
  for (const s of sesiones) {
    const vlist = (s.vertebras_json ?? []) as Array<{ id?: string; estado?: string }>;
    for (const v of vlist) {
      if (!v.id) continue;
      const estado = normalizeEstadoVertebra(v.estado);
      if (!vertebrasEstado[v.id]) {
        vertebrasEstado[v.id] = estado;
        ultimoAjuste[v.id] = s.created_at.slice(0, 10);
      }
    }
  }

  // Historial de sesiones (top 10 cerradas para visual del tab)
  const historial: SesionPlan[] = cerrados.slice(0, 10).map((t) => {
    const sesion = sesiones.find((s) => s.turno_id === t.id);
    const vertebras = (sesion?.vertebras_json ?? []).map((v) => v.id);
    return {
      fecha: t.inicio.slice(0, 10),
      servicio: t.servicio_nombre,
      dur: t.duracion_real_min ?? t.duracion_min,
      cambio: vertebras.length > 0 ? `${vertebras.join(", ")} ajustadas` : "Sin notas vertebrales",
      vertebras,
    };
  });

  const inicio = historial[historial.length - 1]?.fecha ?? new Date().toISOString().slice(0, 10);
  const tipoUI: PacienteFichaInfo["tipo"] = sesionesCompletadas > 1 ? "recurrente" : "nuevo";

  const paciente: PacienteFichaInfo = {
    id: row.id,
    nombre: fullName,
    tipo: tipoUI,
    sesiones: sesionesCompletadas,
    edad: row.fecha_nacimiento ? calcularEdad(row.fecha_nacimiento) : 0,
    genero: row.sexo_biologico === "F" ? "F" : "M",
    motivo,
    tags: row.tags ?? [],
    notasImportantes: notas,
    telefono: tel,
    tel,
    email,
  };

  const proximoTurno = turnos.find((t) =>
    ["AGENDADO", "CONFIRMADO", "EN_SALA"].includes(t.estado) &&
    new Date(t.inicio).getTime() > Date.now(),
  );

  const plan: PlanData = {
    total: Math.max(sesionesCompletadas, 1),
    completadas: sesionesCompletadas,
    frecuencia: deducirFrecuencia(cerrados.map((t) => t.inicio)),
    inicio,
    proximoControl: proximoTurno?.inicio.slice(0, 10) ?? "—",
    precio: 0,
    diagnostico,
    vertebrasEstado,
    ultimoAjuste,
    soap,
    sesiones: historial,
  };

  const cumple = row.fecha_nacimiento ? formatCumple(row.fecha_nacimiento) : "—";

  return ok({ paciente, plan, cumple });
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function tryDecrypt(value: string | null | undefined, label: string): string | null {
  if (value == null) return null;
  try {
    return decryptColumn(value);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[paciente-ficha] decrypt falló (${label}): ${msg}`);
    return null;
  }
}

function normalizeEstadoVertebra(raw: string | undefined): EstadoVertebra {
  const v = (raw ?? "").toLowerCase();
  if (v === "leve" || v === "moderado" || v === "severo" || v === "ajustada") return v;
  return "normal";
}

function calcularEdad(fechaNacimiento: string): number {
  const dob = new Date(fechaNacimiento + (fechaNacimiento.length === 10 ? "T00:00:00" : ""));
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const mDiff = now.getMonth() - dob.getMonth();
  if (mDiff < 0 || (mDiff === 0 && now.getDate() < dob.getDate())) age--;
  return Math.max(0, age);
}

const MESES_ABREV = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function formatCumple(fechaNacimiento: string): string {
  const dob = new Date(fechaNacimiento + (fechaNacimiento.length === 10 ? "T00:00:00" : ""));
  return `${dob.getDate()} ${MESES_ABREV[dob.getMonth()]}`;
}

function deducirFrecuencia(fechasIso: string[]): string {
  if (fechasIso.length < 2) return "—";
  const sorted = [...fechasIso].sort();
  let totalDias = 0;
  for (let i = 1; i < sorted.length; i++) {
    totalDias += (new Date(sorted[i]).getTime() - new Date(sorted[i - 1]).getTime()) / 86_400_000;
  }
  const avg = totalDias / (sorted.length - 1);
  if (avg <= 8) return "Semanal";
  if (avg <= 16) return "Quincenal";
  if (avg <= 35) return "Mensual";
  return "Esporádica";
}
