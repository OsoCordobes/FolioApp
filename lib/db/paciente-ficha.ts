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
 *   - `tool_data_cifrado` (M50) por sesión → `toolHistorial` para la
 *     herramienta de la especialidad; fallback legacy a `vertebras_json`.
 *
 * Si el paciente no tiene sesiones todavía, se devuelve un `plan` mínimo
 * (SOAP vacío, 0 sesiones completadas, sin diagnóstico).
 *
 * Role gating: el caller decide qué mostrar según `role`. Si role es
 * ASISTENTE, NO se debe llamar este fetcher (devuelve PHI). El page.tsx
 * gating: si ASISTENTE, redirigir a `/pacientes`.
 */

import { decryptColumn } from "@/lib/crypto";
import {
  ESPECIALIDADES_META,
  getEspecialidadMetaByToolId,
} from "@/lib/especialidades/meta";
import {
  deriveSpineState,
  extractVertebras,
  type EstadoVertebra,
} from "@/lib/especialidades/quiropraxia/schema";
import type { ToolHistorialEntry } from "@/lib/especialidades/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, ok, type Result } from "./errors";

// ─── Shapes esperados por el componente (prototipo) ───────────────────────

// Re-export de compat: el tipo vive en lib/especialidades/quiropraxia desde
// Fase B (la quiropraxia es una especialidad más del registry).
export type { EstadoVertebra } from "@/lib/especialidades/quiropraxia/schema";

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

/** Turno en curso del paciente — ancla del guardado de sesión desde la ficha. */
export interface TurnoActivoFicha {
  id: string;
  estado: "EN_SALA" | "ATENDIENDO";
  /**
   * toolData ya guardado para este turno (sesion.tool_data_cifrado
   * descifrado) o null si todavía no hay sesión / no tiene tool data.
   * El tab Plan re-hidrata el borrador del slot con esto: el writer
   * (upsertSesion) sobreescribe todas las columnas en cada guardado, así
   * que sin re-hidratación un "guardar solo SOAP" pisaría la herramienta.
   */
  toolDraft: unknown;
}

export interface PlanData {
  total: number;
  completadas: number;
  frecuencia: string;
  inicio: string;
  proximoControl: string;
  precio: number;
  diagnostico: string;
  /**
   * Compat quiro (Fase B): derivación de toolHistorial vía deriveSpineState.
   * El Tool de quiropraxia reconstruye lo mismo client-side desde historial.
   */
  vertebrasEstado: Record<string, EstadoVertebra>;
  ultimoAjuste: Record<string, string>;
  soap: { subjetivo: string; objetivo: string; analisis: string; plan: string };
  sesiones: SesionPlan[];
  /**
   * Historial genérico para la herramienta de la especialidad (DESC por
   * fecha). toolData descifrado de sesion.tool_data_cifrado, o fallback
   * legacy mapeando vertebras_json a { v: 1, vertebras } (filas pre-M50).
   */
  toolHistorial: ToolHistorialEntry[];
  /**
   * Turno en curso (EN_SALA/ATENDIENDO, el más reciente) o null. Habilita
   * "Guardar sesión" en el tab Plan: la sesión se upsertea 1:1 contra este
   * turno (sesion.turno_id UNIQUE, M10) vía saveSesionFichaAction.
   */
  turnoActivo: TurnoActivoFicha | null;
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
  tool_id: string | null;
  tool_data_cifrado: string | null;
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
      .select("id, turno_id, paciente_id, soap_s_cifrado, soap_o_cifrado, soap_a_cifrado, soap_p_cifrado, vertebras_json, tool_id, tool_data_cifrado, notas_cifrado, created_at")
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

  // Historial genérico de la herramienta (Fase B): toolData por sesión,
  // descifrado o con fallback legacy a vertebras_json.
  const toolHistorial: ToolHistorialEntry[] = sesiones.map((s) => ({
    fecha: s.created_at.slice(0, 10),
    toolData: sesionToolData(s),
  }));

  // Vertebras (compat quiro): estado acumulado derivado del historial —
  // misma lógica pre-Fase B, ahora compartida con el Tool en el registry.
  const { vertebrasEstado, ultimoAjuste } = deriveSpineState(toolHistorial);

  // Historial de sesiones (top 10 cerradas para visual del tab). El resumen
  // lo genera la especialidad dueña del tool_id (fallback quiro para filas
  // legacy/sin sesión — mismo output que antes de Fase B).
  const historial: SesionPlan[] = cerrados.slice(0, 10).map((t) => {
    const sesion = sesiones.find((s) => s.turno_id === t.id);
    const toolData = sesion ? sesionToolData(sesion) : null;
    const meta =
      getEspecialidadMetaByToolId(sesion?.tool_id) ?? ESPECIALIDADES_META.quiropraxia;
    const vertebras =
      meta.slug === "quiropraxia" ? extractVertebras(toolData).map((v) => v.id) : [];
    return {
      fecha: t.inicio.slice(0, 10),
      servicio: t.servicio_nombre,
      dur: t.duracion_real_min ?? t.duracion_min,
      cambio: meta.resumenSesion(toolData),
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

  // Turno en curso (el más reciente EN_SALA/ATENDIENDO — `turnos` ya viene
  // DESC por inicio): ancla del guardado de la sesión desde la ficha.
  // toolDraft = toolData ya persistido para ese turno, para re-hidratar el
  // borrador del slot (guardados sucesivos no pisan la herramienta).
  const turnoEnCurso =
    turnos.find((t) => t.estado === "ATENDIENDO" || t.estado === "EN_SALA") ?? null;
  const sesionTurnoEnCurso = turnoEnCurso
    ? sesiones.find((s) => s.turno_id === turnoEnCurso.id) ?? null
    : null;
  const turnoActivo: TurnoActivoFicha | null = turnoEnCurso
    ? {
        id: turnoEnCurso.id,
        estado: turnoEnCurso.estado as TurnoActivoFicha["estado"],
        toolDraft:
          sesionTurnoEnCurso && sesionTurnoEnCurso.tool_data_cifrado != null
            ? sesionToolData(sesionTurnoEnCurso)
            : null,
      }
    : null;

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
    toolHistorial,
    turnoActivo,
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
    // PHI: en producción degradamos en silencio (fallback null). Loguear el
    // fallo atado a un label/ID de sesión crea metadata enlazable a PHI en
    // los logs del server — solo se loguea en desarrollo.
    if (process.env.NODE_ENV === "development") {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[paciente-ficha] decrypt falló (${label}): ${msg}`);
    }
    return null;
  }
}

/**
 * toolData de una sesión: si hay tool_data_cifrado, descifra + JSON.parse
 * (tolerante: ciphertext corrupto o JSON inválido NO rompe la ficha). Sino,
 * fallback legacy: vertebras_json (M10) mapeada al shape quiro { v: 1, ... }.
 */
function sesionToolData(s: SesionRow): unknown {
  if (s.tool_data_cifrado != null) {
    const plain = tryDecrypt(s.tool_data_cifrado, "tool_data");
    if (plain != null) {
      try {
        return JSON.parse(plain) as unknown;
      } catch (e) {
        // PHI: no loguear en producción — el UUID de sesión en los logs
        // crea linkage rastreable hacia datos clínicos. Solo en desarrollo.
        if (process.env.NODE_ENV === "development") {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[paciente-ficha] tool_data JSON inválido (sesion ${s.id}): ${msg}`);
        }
      }
    }
    // cae al fallback legacy de abajo
  }
  return {
    v: 1,
    vertebras: (s.vertebras_json ?? []).map((v) => ({ id: v.id, estado: v.estado })),
  };
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
