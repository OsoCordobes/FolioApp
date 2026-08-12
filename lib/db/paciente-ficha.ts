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

import { tryDecrypt as tryDecryptCanonico } from "@/lib/crypto";
import { esToolDataRehidratable } from "@/lib/db/sesiones";
import {
  ESPECIALIDADES_META,
  getEspecialidadMetaByToolId,
  resolveEspecialidadEfectiva,
  toolPerteneceAEspecialidad,
  type EspecialidadSlug,
} from "@/lib/especialidades/meta";
import {
  deriveSpineState,
  extractVertebras,
  type EstadoVertebra,
} from "@/lib/especialidades/quiropraxia/schema";
import type { ToolHistorialEntry } from "@/lib/especialidades/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { listDocumentosPaciente } from "./documentos";
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
  /** M59 · ocupación (PII desencriptada). "" si no está cargada. */
  ocupacion: string;
  /** M59 · recomendado por (PII de tercero, desencriptada). "" si no está. */
  recomendadoPor: string;
  /** F7a (M89) · obra social/prepaga (en claro). null = particular. */
  coberturaNombre: string | null;
  /** F7a (M89) · plan de la cobertura (en claro). */
  coberturaPlan: string | null;
  /** F7a (M89) · nº de afiliado DESCIFRADO server-side (viaja como el resto de la PII de la ficha). */
  coberturaNroAfiliado: string | null;
  /**
   * F7a (M89) · false si el SELECT de cobertura falló. Distingue "no tiene
   * cobertura" de "no pudimos leerla": con false la UI muestra el estado
   * degradado y NO abre el editor (guardaría NULL sobre datos reales).
   */
  coberturaLeida: boolean;
}

/**
 * Workstream 5 · intake avanzado por especialidad para la ficha (M60). La
 * especialidad es la ACTIVA resuelta (member del turno en curso ?? org); `datos`
 * ya viene descifrado + JSON.parse tolerante. null si no hay fila para esa
 * especialidad. Los labels los pone la UI desde el config del registry.
 */
export interface IntakeAvanzadoFicha {
  especialidad: EspecialidadSlug;
  datos: Record<string, unknown>;
}

export interface SesionPlan {
  fecha: string;          // YYYY-MM-DD
  servicio: string;
  dur: number;
  cambio: string;
  vertebras: string[];
  /**
   * D2 · id de la fila `sesion` de esta visita (o null si el turno cerró sin
   * sesión registrada). Habilita el "Ver detalle" del tab Sesiones y el link
   * al PDF de ESA sesión (/api/pacientes/[id]/ficha-pdf?sesion=<uuid>).
   */
  sesionId: string | null;
  /**
   * D2 · SOAP de la sesión YA DESCIFRADO server-side (costo cero extra: las
   * columnas soap_*_cifrado ya venían en la misma query y se descartaban).
   * null si la visita no tiene sesión. Los campos pueden ser "" (sección no
   * escrita). NUNCA viaja ciphertext al cliente — solo el plaintext que la
   * ficha ya muestra para la última sesión.
   */
  soap: { s: string; o: string; a: string; p: string } | null;
}

/**
 * Modo del ancla de guardado de la ficha (feedback quiro jul-2026: la ficha se
 * puede editar SIEMPRE que exista una visita contra la cual guardar):
 *   - "en_curso":    turno EN_SALA/ATENDIENDO — comportamiento histórico.
 *   - "por_iniciar": turno de HOY (tz de la org) AGENDADO/CONFIRMADO — la
 *                    ficha edita ya; al guardar, la action inicia la atención
 *                    (AGENDADO/CONFIRMADO → EN_SALA → ATENDIENDO).
 *   - "retroactivo": sin turno en curso ni de hoy — se edita la sesión del
 *                    último turno CERRADO (completar/corregir la ficha después
 *                    de la visita; Ley 26.529: editable mientras la sesión no
 *                    esté lockeada).
 */
export type TurnoAnclaModo = "en_curso" | "por_iniciar" | "retroactivo";

/** Turno ANCLA del guardado de sesión desde la ficha (ver TurnoAnclaModo). */
export interface TurnoActivoFicha {
  id: string;
  estado: "EN_SALA" | "ATENDIENDO" | "AGENDADO" | "CONFIRMADO" | "CERRADO";
  /** Cómo se eligió este ancla — decide el copy del aviso del tab Plan. */
  modo: TurnoAnclaModo;
  /** turno.inicio (ISO) — la ficha muestra fecha/hora en por_iniciar/retroactivo. */
  inicio: string;
  /**
   * M55 · especialidad EFECTIVA del profesional del turno
   * (member.especialidad ?? organization.especialidad). Es la herramienta que
   * el tab Plan renderiza y la misma que el writer (upsertSesion) deriva
   * server-side al guardar — render y persistencia quedan alineados.
   */
  especialidad: EspecialidadSlug;
  /**
   * turno.atendiendo_desde (ISO) o null. Lo usa "Guardar y cerrar" en la ficha
   * para derivar la duración real de la sesión (Date.now() − atendiendoDesde)
   * al cerrar el turno — mismo cálculo que el botón "Cerrar turno" de /hoy.
   * Solo es non-null mientras el turno está ATENDIENDO (CHECK M09).
   */
  atendiendoDesde: string | null;
  /**
   * toolData ya guardado para este turno (sesion.tool_data_cifrado
   * descifrado) o null si todavía no hay sesión / no tiene tool data.
   * El tab Plan re-hidrata el borrador del slot con esto: el writer
   * (upsertSesion) sobreescribe todas las columnas en cada guardado, así
   * que sin re-hidratación un "guardar solo SOAP" pisaría la herramienta.
   * M55: solo se re-hidrata si el tool_id persistido pertenece a la
   * especialidad activa — un draft de OTRA herramienta (cobertura cruzada /
   * cambio de especialidad con turno en curso) haría fallar el zod del writer
   * y bloquearía también el guardado del SOAP.
   */
  toolDraft: unknown;
  /**
   * SOAP ya guardado para ESTE turno (el ancla), o null si el ancla todavía no
   * tiene fila `sesion`.
   *
   * Existe porque el editor se hidrataba de `plan.soap`, que es el SOAP de la
   * ÚLTIMA sesión DEL PACIENTE — no de esta visita. Como iniciar la atención no
   * crea la fila `sesion`, en cada visita nueva los cuatro campos aparecían con
   * el texto de la visita anterior bajo el título "Nota SOAP · sesión de hoy" y
   * se persistían como hallazgos de hoy: la historia clínica terminaba
   * afirmando que hoy se auscultó un soplo que nunca se auscultó.
   *
   * `null` significa "esta visita todavía no tiene nota", y el editor arranca
   * vacío. La continuidad con la visita anterior se ofrece aparte, explícita y
   * fechada.
   */
  soapDraft: { subjetivo: string; objetivo: string; analisis: string; plan: string } | null;
  /**
   * SOAP de la visita ANTERIOR + su fecha, para ofrecer la continuidad de forma
   * explícita cuando el ancla no tiene nota propia. Nunca se aplica solo.
   */
  soapPrevio: {
    fecha: string;
    soap: { subjetivo: string; objetivo: string; analisis: string; plan: string };
  } | null;
  /**
   * `sesion.updated_at` de la sesión del ancla (null si todavía no hay fila).
   *
   * Control de concurrencia optimista: viaja de vuelta en cada guardado. Sin
   * esto el writer era last-write-wins ciego — el profesional escribe en la
   * tablet durante la consulta y después, desde la PC con la ficha abierta
   * desde antes, agrega una palabra: el autosave pisaba el hallazgo de la
   * tablet y mostraba "Guardado ✓".
   */
  sesionUpdatedAt: string | null;
  /**
   * Workstream 6 · ¿existe YA una fila sesion para este turno? (cualquier
   * sesion.turno_id == turnoEnCurso.id). La Tool quiro lo usa para dos cosas:
   *   1. habilitar el adjunto de radiografías (necesitan una sesión donde
   *      colgar el documento_clinico).
   *   2. decidir el carry-forward: solo se siembra el borrador desde la última
   *      visita cuando el turno es GENUINAMENTE fresco (sin sesión todavía).
   */
  tieneSesionGuardada: boolean;
}

/**
 * Workstream 6 · una radiografía del paciente para la galería de la Tool quiro.
 * `signedUrl` es de vida corta (5 min, lib/db/documentos.ts) — se refresca
 * client-side al expirar. Solo se trae para fichas con especialidad activa
 * quiropraxia (otras orgs reciben []).
 */
export interface RadiografiaFicha {
  id: string;
  /** YYYY-MM-DD: fecha_estudio ?? created_at.slice(0,10). */
  fecha: string;
  descripcion: string | null;
  signedUrl: string;
  sesionId: string | null;
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
   * Turno ANCLA del guardado (elegirTurnoAncla: en curso ?? de hoy por iniciar
   * ?? último cerrado editable) o null si el paciente no tiene ninguna visita
   * contra la cual guardar. Habilita "Guardar sesión" en el tab Plan: la
   * sesión se upsertea 1:1 contra este turno (sesion.turno_id UNIQUE, M10)
   * vía saveSesionFichaAction.
   */
  turnoActivo: TurnoActivoFicha | null;
  /**
   * Workstream 6 · galería de radiografías del paciente (documento_clinico tipo
   * RADIOGRAFIA) para la Tool quiro, con signed URLs de vida corta. Solo se
   * llena cuando la especialidad ACTIVA es quiropraxia (otras orgs: []) — la
   * Tool de cardio/psico la ignora. Server-side: los URLs firmados son seguros
   * de mandar al cliente (expiran en 5 min).
   */
  radiografias: RadiografiaFicha[];
  /**
   * C6 · adjuntos de estudios del paciente (documento_clinico tipo
   * INFORME_EXTERNO — ECG/Holter/ergometría escaneados/PDF) para la Tool cardio,
   * con signed URLs de vida corta. Generaliza el bloque de radiografías: solo se
   * llena cuando la especialidad ACTIVA es cardiología (otras orgs: []). Mismo
   * shape que `radiografias` (documento por sesión). La Tool los ABRE por signed
   * URL — Folio NO renderiza señal ECG.
   */
  estudiosAdjuntos: RadiografiaFicha[];
  /**
   * M58 · valores CRUDOS del plan persistido (plan_tratamiento, 1:1 por
   * paciente) para prefillear el modal de edición. Todos null cuando no hay
   * fila todavía — el card sigue mostrando los valores derivados de arriba.
   * Separado de los campos de display (total/frecuencia/…) que ya combinan
   * stored ?? derivado: acá el modal necesita el valor stored tal cual.
   */
  planEditable: {
    sesionesObjetivo: number | null;
    frecuencia: string | null;
    diagnostico: string | null;
    proximoControl: string | null;
    notas: string | null;
  };
}

export interface PacienteFichaData {
  paciente: PacienteFichaInfo;
  plan: PlanData;
  cumple: string; // "18 may" o "—"
  /**
   * Workstream 5 · intake avanzado de la especialidad ACTIVA (M60), o null si no
   * hay fila. La sección "Información avanzada" de la ficha lo rinde read-only +
   * un modal de edición. Solo se trae el de la especialidad activa (no las otras
   * de una ficha mixta) — la edición es por la especialidad del slot.
   */
  intakeAvanzado: IntakeAvanzadoFicha | null;
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
  // M59 · campos comunes de intake (PII cifrada, expuestos por paciente_completo).
  ocupacion_cifrado: string | null;
  recomendado_por_cifrado: string | null;
  diagnosticos_activos: number;
  alergias_activas: number;
  medicaciones_vigentes: number;
}

/** M60 · fila de intake avanzado (1 por paciente+especialidad). */
interface IntakeAvanzadoRow {
  especialidad: string;
  datos_cifrado: string | null;
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
  /** Versión de la fila (trigger sesion_set_updated_at): control de concurrencia. */
  updated_at: string;
  /** Ancla retroactiva: una sesión lockeada NO se puede re-editar (M10). */
  locked_at: string | null;
}

interface TurnoExtRow {
  id: string;
  inicio: string;
  duracion_min: number;
  duracion_real_min: number | null;
  estado: string;
  servicio_nombre: string;
  /** M55 · profesional asignado — decide la especialidad efectiva del slot. */
  profesional_id: string | null;
  /** turno.atendiendo_desde (ISO) — base del cálculo de duración real al cerrar. */
  atendiendo_desde: string | null;
}

/** M58 · plan de tratamiento persistido (1:1 por paciente). */
interface PlanTratamientoRow {
  id: string;
  sesiones_objetivo: number | null;
  frecuencia: string | null;
  diagnostico_cifrado: string | null;
  proximo_control: string | null;
  notas_cifrado: string | null;
}

// ─── Ancla de guardado (pura, testeable) ───────────────────────────────────

const TZ_DEFAULT = "America/Argentina/Buenos_Aires";

/**
 * Cuánto tiempo después de su hora un turno AGENDADO sigue contando como "por
 * iniciar". Dos horas: cubre a un profesional que arranca tarde o se extiende,
 * y descarta el turno de la mañana que quedó sin marcar cuando ya es la tarde.
 */
const MARGEN_TURNO_VENCIDO_MS = 2 * 60 * 60 * 1000;

/** Subset de turno que necesita la elección del ancla (turno_extendido). */
export interface TurnoAnclaCandidato {
  id: string;
  estado: string;
  inicio: string;
}

/**
 * Elige el turno ANCLA del guardado de la ficha (feedback quiro jul-2026: la
 * ficha ya no se bloquea sin turno en curso). Cascada:
 *
 *   1. en_curso    — EN_SALA/ATENDIENDO más reciente (comportamiento histórico).
 *   2. por_iniciar — turno AGENDADO/CONFIRMADO cuyo `inicio` cae HOY en la tz
 *                    de la org (el más cercano a ahora si hay varios). Evita la
 *                    trampa de escribir la visita de hoy sobre la sesión de la
 *                    semana pasada cuando el profesional no pasó por /hoy.
 *   3. retroactivo — el CERRADO más reciente cuya sesión no está lockeada (o
 *                    sin sesión todavía): completar/corregir la ficha después
 *                    de la visita. Si la sesión está lockeada NO se cae a un
 *                    turno más viejo (editar una visita anterior a la última
 *                    sería confuso) — la ficha queda read-only.
 *
 * null = ningún turno editable → la ficha queda read-only con CTA de sacar
 * turno. Pura a propósito (sin I/O): invariantes en tests/unit/turno-ancla.
 *
 * `turnos` DEBE venir DESC por inicio (así lo lee getPacienteFicha).
 */
export function elegirTurnoAncla<T extends TurnoAnclaCandidato>(
  turnos: T[],
  sesiones: Array<{ turno_id: string; locked_at: string | null }>,
  ahora: Date,
  timezone: string,
): { turno: T; modo: TurnoAnclaModo } | null {
  const enCurso = turnos.find((t) => t.estado === "ATENDIENDO" || t.estado === "EN_SALA");
  if (enCurso) return { turno: enCurso, modo: "en_curso" };

  // "en-CA" formatea YYYY-MM-DD; una tz inválida cae al default AR (defensivo,
  // mismo criterio que horaEnTz en lib/db/hoy.ts).
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone || TZ_DEFAULT });
  } catch {
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ_DEFAULT });
  }
  const fechaOrg = (iso: string): string => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? "" : fmt.format(d);
  };
  const hoy = fmt.format(ahora);

  const cerrado = turnos.find((t) => t.estado === "CERRADO");
  const cerradoEditable =
    cerrado && !sesiones.find((s) => s.turno_id === cerrado.id)?.locked_at ? cerrado : null;

  const deHoy = turnos.filter(
    (t) => (t.estado === "AGENDADO" || t.estado === "CONFIRMADO") && fechaOrg(t.inicio) === hoy,
  );

  // Un turno AGENDADO cuya hora ya pasó hace rato NO es "por iniciar": es, casi
  // siempre, un ausente que nadie marcó. Antes cualquier AGENDADO de hoy ganaba
  // sin mirar la hora, así que con dos turnos el mismo día —un no-show a las
  // 08:00 y la visita real de las 16:00— a las 19:00 la ficha anclaba al
  // no-show: la nota se colgaba del turno equivocado y, al guardar, la action
  // lo empujaba a EN_SALA→ATENDIENDO. Con "Guardar y cerrar" quedaba CERRADO y
  // con fila `pago`: un ausente facturado, contaminando /finanzas y la métrica
  // de ausentismo.
  //
  // El margen es generoso a propósito: una consulta que empieza tarde o se
  // extiende sigue siendo la visita de hoy.
  const limite = ahora.getTime() - MARGEN_TURNO_VENCIDO_MS;
  const vigentes = deHoy.filter((t) => {
    const ms = new Date(t.inicio).getTime();
    return isNaN(ms) || ms >= limite;
  });

  if (vigentes.length > 0) {
    // Varios turnos del mismo paciente en el día es raro; gana el más cercano
    // a ahora para que la ficha edite la visita que está pasando.
    const masCercano = vigentes.reduce((a, b) =>
      Math.abs(new Date(a.inicio).getTime() - ahora.getTime()) <=
      Math.abs(new Date(b.inicio).getTime() - ahora.getTime())
        ? a
        : b,
    );
    // Si además hay un CERRADO de hoy MÁS TARDE que el candidato, esa es la
    // visita que realmente se atendió: la ficha se escribe sobre ella.
    const cerradoPosterior =
      cerradoEditable &&
      fechaOrg(cerradoEditable.inicio) === hoy &&
      new Date(cerradoEditable.inicio).getTime() > new Date(masCercano.inicio).getTime()
        ? cerradoEditable
        : null;
    if (cerradoPosterior) return { turno: cerradoPosterior, modo: "retroactivo" };
    return { turno: masCercano, modo: "por_iniciar" };
  }

  // Sin candidato vigente: el CERRADO más reciente editable. Si su sesión está
  // lockeada NO se cae a un turno más viejo (editar una visita anterior a la
  // última sería confuso) — la ficha queda read-only.
  if (cerradoEditable) return { turno: cerradoEditable, modo: "retroactivo" };
  return null;
}

// ─── Fetcher principal ─────────────────────────────────────────────────────

export async function getPacienteFicha(
  pacienteId: string,
  organizationId: string,
  /**
   * M55 · especialidad de la org (fallback de la derivación efectiva). El
   * caller ya la tiene en el ActiveContext — se pasa para no re-leerla acá.
   */
  orgEspecialidad: EspecialidadSlug,
  /**
   * Override de especialidad para CUENTAS INTERNAS (is_internal_account): si se
   * provee, FUERZA la especialidad activa del slot (ficha + intake + radiografías)
   * sin importar el turno/org. El caller solo lo pasa cuando la org es interna y
   * hay cookie válida (ver pacientes/[id]/page.tsx). null/undefined = comportamiento
   * normal (turno en curso ?? org).
   */
  especialidadOverride?: EspecialidadSlug | null,
  /**
   * IANA timezone de la org (ActiveContext.organization.timezone). Decide qué
   * turnos AGENDADO/CONFIRMADO cuentan como "de hoy" para el ancla por_iniciar.
   * Ausente/inválida → America/Argentina/Buenos_Aires (default del producto).
   */
  orgTimezone?: string,
): Promise<Result<PacienteFichaData>> {
  if (!/^[0-9a-f-]{36}$/i.test(pacienteId)) {
    return err("validation", "ID de paciente inválido.");
  }

  const supabase = await createSupabaseServerClient();

  const [pacRes, sesionesRes, turnosRes, planRes, intakeRes] = await Promise.all([
    supabase
      .from("paciente_completo")
      .select("*")
      .eq("id", pacienteId)
      .eq("organization_id", organizationId)
      .maybeSingle(),
    // Workstream 6 · .limit(50) (antes 10): más historial de visitas para el
    // "Control de visitas" quiro. Costo: hasta 50 sesiones descifran SOAP +
    // tool_data por ficha (vs 10) — aceptable para una sola ficha por request.
    supabase
      .from("sesion")
      .select("id, turno_id, paciente_id, soap_s_cifrado, soap_o_cifrado, soap_a_cifrado, soap_p_cifrado, vertebras_json, tool_id, tool_data_cifrado, notas_cifrado, created_at, updated_at, locked_at")
      .eq("paciente_id", pacienteId)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("turno_extendido")
      .select("id, inicio, duracion_min, duracion_real_min, estado, servicio_nombre, profesional_id, atendiendo_desde")
      .eq("paciente_id", pacienteId)
      .eq("organization_id", organizationId)
      .order("inicio", { ascending: false })
      .limit(50),
    // M58 · plan de tratamiento persistido (1:1 por paciente). maybeSingle:
    // la mayoría de los pacientes no tiene fila todavía → el card cae a los
    // valores derivados de los turnos.
    supabase
      .from("plan_tratamiento")
      .select("id, sesiones_objetivo, frecuencia, diagnostico_cifrado, proximo_control, notas_cifrado")
      .eq("paciente_id", pacienteId)
      .eq("organization_id", organizationId)
      .maybeSingle(),
    // M60 · intake avanzado del paciente (puede haber uno por especialidad en
    // fichas mixtas). Traemos todos y abajo elegimos el de la especialidad
    // ACTIVA (resuelta más abajo, una vez conocido el profesional del turno).
    supabase
      .from("paciente_intake_avanzado")
      .select("especialidad, datos_cifrado")
      .eq("paciente_id", pacienteId)
      .eq("organization_id", organizationId),
  ]);

  if (pacRes.error) return err("db_error", "Error leyendo paciente.", pacRes.error.message);
  if (!pacRes.data) return err("not_found", "Paciente no encontrado o sin permisos.");

  const row = pacRes.data as unknown as PacienteCompletoRow;
  const sesiones = (sesionesRes.data ?? []) as unknown as SesionRow[];
  const turnos = (turnosRes.data ?? []) as unknown as TurnoExtRow[];
  // M58 · plan persistido. Un error de lectura NO rompe la ficha: degradamos a
  // null (el card sigue funcionando con los valores derivados de los turnos).
  const planRow = (planRes.data ?? null) as unknown as PlanTratamientoRow | null;
  const planDiagnostico = tryDecrypt(planRow?.diagnostico_cifrado, "plan.diagnostico");
  const planNotas = tryDecrypt(planRow?.notas_cifrado, "plan.notas");

  const nombre = tryDecrypt(row.nombre_cifrado, "nombre");
  const apellido = tryDecrypt(row.apellido_cifrado, "apellido");
  const fullName = [nombre, apellido].filter(Boolean).join(" ").trim() || "Paciente sin nombre";
  const motivo = tryDecrypt(row.motivo_consulta_cifrado, "motivo") ?? "";
  const notas = tryDecrypt(row.notas_importantes_cifrado, "notas") ?? "";
  const tel = tryDecrypt(row.telefono_cifrado, "telefono") ?? "";
  const email = tryDecrypt(row.email_cifrado, "email") ?? "";
  // M59 · campos comunes de intake (PII).
  const ocupacion = tryDecrypt(row.ocupacion_cifrado, "ocupacion") ?? "";
  const recomendadoPor = tryDecrypt(row.recomendado_por_cifrado, "recomendado_por") ?? "";

  // F7a (M89) · cobertura. La vista `paciente_completo` no expone las columnas
  // nuevas (las vistas son append-only-por-migración): SELECT chico directo a
  // paciente_identidad (RLS org-scoped). Best-effort: si falla, la ficha
  // muestra "Particular" en vez de romperse. El nº de afiliado se descifra acá
  // (mismo criterio que el resto de la PII de la ficha).
  let coberturaNombre: string | null = null;
  let coberturaPlan: string | null = null;
  let coberturaNroAfiliado: string | null = null;
  // false → el SELECT falló y los tres campos de arriba son "no sé", NO
  // "particular". La UI lo usa para no ofrecer el modal de edición: prefillado
  // en vacío, "Guardar cobertura" pisaría con NULL una cobertura real.
  let coberturaLeida = true;
  if (row.identidad_id) {
    const { data: cobRow, error: cobErr } = await supabase
      .from("paciente_identidad")
      .select("cobertura_nombre, cobertura_plan, cobertura_nro_afiliado_cifrado")
      .eq("id", row.identidad_id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (cobErr) {
      // Degradamos la ficha, no la rompemos — pero con señal: una regresión de
      // schema/RLS acá se vería como "Particular" en todas las fichas.
      coberturaLeida = false;
      console.error(`[paciente-ficha] lookup de cobertura falló: ${cobErr.message}`);
      const { captureException } = await import("@sentry/nextjs");
      captureException(new Error(`Cobertura ficha falló — ${cobErr.message}`), {
        tags: { component: "paciente-ficha", op: "cobertura" },
      });
    }
    if (cobRow) {
      const c = cobRow as {
        cobertura_nombre: string | null;
        cobertura_plan: string | null;
        cobertura_nro_afiliado_cifrado: string | null;
      };
      coberturaNombre = c.cobertura_nombre ?? null;
      coberturaPlan = c.cobertura_plan ?? null;
      coberturaNroAfiliado = tryDecrypt(c.cobertura_nro_afiliado_cifrado, "cobertura.nro_afiliado");
    }
  }

  const cerrados = turnos.filter((t) => t.estado === "CERRADO");
  const sesionesCompletadas = cerrados.length;
  const lastSesion = sesiones[0] ?? null;

  // Diagnóstico: para MVP usamos el motivo de consulta como diagnóstico de display.
  // Cuando T-1.7 expanda a leer tabla `diagnostico`, mostraremos el principal activo.
  const diagnostico = motivo || "—";

  const leerSoap = (row: {
    soap_s_cifrado: string | null;
    soap_o_cifrado: string | null;
    soap_a_cifrado: string | null;
    soap_p_cifrado: string | null;
  }) => ({
    subjetivo: tryDecrypt(row.soap_s_cifrado, "soap.s") ?? "",
    objetivo: tryDecrypt(row.soap_o_cifrado, "soap.o") ?? "",
    analisis: tryDecrypt(row.soap_a_cifrado, "soap.a") ?? "",
    plan: tryDecrypt(row.soap_p_cifrado, "soap.p") ?? "",
  });

  // SOAP de la ÚLTIMA sesión del paciente. Es dato de DISPLAY ("última
  // sesión"): NO es lo que edita el profesional hoy. Lo editable sale de
  // `turnoActivo.soapDraft`, que corresponde al turno ancla.
  const soap = lastSesion
    ? leerSoap(lastSesion)
    : { subjetivo: "", objetivo: "", analisis: "", plan: "" };

  // Historial genérico de la herramienta (Fase B): toolData por sesión,
  // descifrado o con fallback legacy a vertebras_json. Cada entrada lleva su
  // tool_id persistido (M55): el tab Plan filtra por la especialidad activa
  // antes de pasárselo a la Tool (filtrarToolHistorial) — en fichas mixtas
  // cada herramienta ve solo SUS sesiones.
  const toolHistorial: ToolHistorialEntry[] = sesiones.map((s) => ({
    fecha: s.created_at.slice(0, 10),
    toolData: sesionToolData(s),
    toolId: s.tool_id,
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
      // D2 · SOAP por sesión ya descifrado (mismas filas que la query trajo;
      // antes se descartaba). Habilita "Ver detalle" + la sección Evolución
      // del PDF sin queries extra.
      sesionId: sesion?.id ?? null,
      soap: sesion
        ? {
            s: tryDecrypt(sesion.soap_s_cifrado, "soap.s") ?? "",
            o: tryDecrypt(sesion.soap_o_cifrado, "soap.o") ?? "",
            a: tryDecrypt(sesion.soap_a_cifrado, "soap.a") ?? "",
            p: tryDecrypt(sesion.soap_p_cifrado, "soap.p") ?? "",
          }
        : null,
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
    ocupacion,
    recomendadoPor,
    coberturaNombre,
    coberturaPlan,
    coberturaNroAfiliado,
    coberturaLeida,
  };

  const proximoTurno = turnos.find((t) =>
    ["AGENDADO", "CONFIRMADO", "EN_SALA"].includes(t.estado) &&
    new Date(t.inicio).getTime() > Date.now(),
  );

  // Turno ANCLA del guardado (feedback quiro jul-2026): en curso ?? de hoy por
  // iniciar ?? último cerrado editable — `turnos` ya viene DESC por inicio.
  // toolDraft = toolData ya persistido para ese turno, para re-hidratar el
  // borrador del slot (guardados sucesivos no pisan la herramienta).
  const ancla = elegirTurnoAncla(turnos, sesiones, new Date(), orgTimezone ?? TZ_DEFAULT);
  const turnoAncla = ancla?.turno ?? null;
  const sesionTurnoAncla = turnoAncla
    ? sesiones.find((s) => s.turno_id === turnoAncla.id) ?? null
    : null;

  // M55 · especialidad EFECTIVA del slot: la del PROFESIONAL del turno ANCLA
  // (member.especialidad ?? org), espejo exacto de la derivación server-side
  // del writer (upsertSesion) — vale igual para el ancla retroactiva: la
  // herramienta que se edita es la del profesional de ESA visita. Sin ancla no
  // hay guardado posible y la ficha rinde la herramienta de la org, como
  // siempre. Si la lectura del member falla, degradamos a la org (display-only:
  // ante un mismatch el zod .strict() del writer rechaza el guardado con error
  // visible, sin corrupción). El lookup NO filtra deleted_at a propósito: el
  // turno sigue siendo de ese profesional aunque esté de baja — su especialidad
  // sigue decidiendo la herramienta (mismo criterio que el writer).
  let especialidadActiva: EspecialidadSlug = orgEspecialidad;
  if (especialidadOverride) {
    // Cuenta interna previsualizando otra ficha: el override manda sobre todo
    // (intake, radiografías, herramienta). Display-only; el writer igual valida
    // con zod .strict() al guardar.
    especialidadActiva = especialidadOverride;
  } else if (turnoAncla?.profesional_id) {
    const { data: profRow } = await supabase
      .from("member")
      .select("especialidad")
      .eq("id", turnoAncla.profesional_id)
      .maybeSingle();
    especialidadActiva = resolveEspecialidadEfectiva(
      (profRow as { especialidad: string | null } | null)?.especialidad ?? null,
      orgEspecialidad,
    );
  }

  // M60 · intake avanzado de la especialidad ACTIVA. De todas las filas del
  // paciente (una por especialidad en fichas mixtas) tomamos la que matchea la
  // especialidad activa del slot — es la que el modal de edición de la ficha
  // edita. datos_cifrado se descifra + JSON.parse tolerante (corrupción/JSON
  // inválido degrada a null, no rompe la ficha).
  const intakeRows = (intakeRes.data ?? []) as unknown as IntakeAvanzadoRow[];
  const intakeRow = intakeRows.find((r) => r.especialidad === especialidadActiva) ?? null;
  const intakeAvanzado: IntakeAvanzadoFicha | null = intakeRow
    ? { especialidad: especialidadActiva, datos: parseIntakeDatos(intakeRow.datos_cifrado) }
    : null;

  const turnoActivo: TurnoActivoFicha | null = turnoAncla
    ? {
        id: turnoAncla.id,
        estado: turnoAncla.estado as TurnoActivoFicha["estado"],
        modo: ancla!.modo,
        inicio: turnoAncla.inicio,
        especialidad: especialidadActiva,
        atendiendoDesde: turnoAncla.atendiendo_desde ?? null,
        // Workstream 6 · ¿ya hay una sesion para este turno? (sesiones ya está
        // en memoria — sin query extra). Habilita radiografías + gatea el
        // carry-forward de la Tool quiro.
        tieneSesionGuardada: sesiones.some((s) => s.turno_id === turnoAncla.id),
        toolDraft:
          // M55 · re-hidratar SOLO si el tool_id persistido es el de la
          // especialidad activa: un draft cross-tool re-enviado al writer
          // fallaría la validación zod (.strict()) y bloquearía también el
          // SOAP. El toolDraft null resultante NO pone en riesgo los datos de
          // la otra herramienta: el writer detecta el guardado solo-SOAP
          // sobre una fila no re-hidratable y PRESERVA las columnas tool
          // (debePreservarToolData, lib/db/sesiones.ts).
          // MISMA regla que el writer (esToolDataRehidratable): sólo se
          // re-hidrata el payload de la versión de ESCRITURA vigente. Una fila
          // guardada con un shape anterior (cardio/psico pre-v3, quiro pre-v2)
          // se trata como ilegible: el borrador arranca sin herramienta y el
          // writer preserva esas columnas. Antes esa fila llegaba tal cual al
          // borrador, el zod .strict() de la versión actual la rechazaba y el
          // guardado se cortaba ENTERO — el profesional no podía registrar ni
          // el SOAP de la visita.
          sesionTurnoAncla &&
          esToolDataRehidratable(
            sesionTurnoAncla.tool_id,
            sesionTurnoAncla.tool_data_cifrado,
            especialidadActiva,
          )
            ? sesionToolData(sesionTurnoAncla)
            : null,
        // El SOAP editable es el de ESTA visita, no el de la última del
        // paciente. Sin fila `sesion` para el ancla, la nota de hoy está vacía.
        soapDraft: sesionTurnoAncla ? leerSoap(sesionTurnoAncla) : null,
        // Y si está vacía, ofrecemos la anterior aparte: con fecha, y sólo si
        // es de OTRA sesión (no la del propio ancla).
        soapPrevio:
          !sesionTurnoAncla && lastSesion
            ? { fecha: lastSesion.created_at, soap: leerSoap(lastSesion) }
            : null,
        sesionUpdatedAt: sesionTurnoAncla?.updated_at ?? null,
      }
    : null;

  // Workstream 6 / C6 · adjuntos clínicos por sesión para la Tool activa. Solo
  // se consultan para la especialidad que los usa (una org de otra especialidad
  // no paga la query extra; la Tool igual ignora el campo). Un error de lectura
  // degrada a [] (la galería se muestra vacía, la ficha no se rompe).
  //   - quiropraxia → radiografías (documento_clinico tipo RADIOGRAFIA).
  //   - cardiología → estudios adjuntos (tipo INFORME_EXTERNO: ECG/Holter/
  //     ergometría escaneados o en PDF). Mismo mapeo doc → RadiografiaFicha.
  const mapDocFicha = (doc: {
    id: string;
    fecha_estudio: string | null;
    created_at: string;
    descripcion: string | null;
    signedUrl: string;
    sesion_id: string | null;
  }): RadiografiaFicha => ({
    id: doc.id,
    fecha: (doc.fecha_estudio ?? doc.created_at).slice(0, 10),
    descripcion: doc.descripcion,
    signedUrl: doc.signedUrl,
    sesionId: doc.sesion_id,
  });

  let radiografias: RadiografiaFicha[] = [];
  let estudiosAdjuntos: RadiografiaFicha[] = [];
  if (especialidadActiva === "quiropraxia") {
    const radRes = await listDocumentosPaciente({ pacienteId, tipo: "RADIOGRAFIA" });
    if (radRes.ok) radiografias = radRes.data.map(mapDocFicha);
  } else if (especialidadActiva === "cardiologia") {
    const estRes = await listDocumentosPaciente({ pacienteId, tipo: "INFORME_EXTERNO" });
    if (estRes.ok) estudiosAdjuntos = estRes.data.map(mapDocFicha);
  }

  // M58 · valores derivados (de los turnos) usados como fallback cuando el
  // plan persistido no llena un campo.
  const frecuenciaDerivada = deducirFrecuencia(cerrados.map((t) => t.inicio));
  const proximoControlDerivado = proximoTurno?.inicio.slice(0, 10) ?? "—";

  const plan: PlanData = {
    // Si hay plan persistido, sus campos OVERRIDEAN el display derivado (campo
    // a campo: stored ?? derivado). `completadas` SIEMPRE es derivado (cuenta
    // de turnos cerrados — no editable). El resto del shape no cambia, así el
    // card renderiza idéntico con o sin fila.
    total: planRow?.sesiones_objetivo ?? Math.max(sesionesCompletadas, 1),
    completadas: sesionesCompletadas,
    frecuencia: planRow?.frecuencia ?? frecuenciaDerivada,
    inicio,
    proximoControl: planRow?.proximo_control ?? proximoControlDerivado,
    precio: 0,
    diagnostico: planDiagnostico ?? diagnostico,
    vertebrasEstado,
    ultimoAjuste,
    soap,
    sesiones: historial,
    toolHistorial,
    turnoActivo,
    radiografias,
    estudiosAdjuntos,
    // Valores CRUDOS para prefillear el modal (null cuando no hay fila).
    planEditable: {
      sesionesObjetivo: planRow?.sesiones_objetivo ?? null,
      frecuencia: planRow?.frecuencia ?? null,
      diagnostico: planDiagnostico,
      proximoControl: planRow?.proximo_control ?? null,
      notas: planNotas,
    },
  };

  const cumple = row.fecha_nacimiento ? formatCumple(row.fecha_nacimiento) : "—";

  return ok({ paciente, plan, cumple, intakeAvanzado });
}

// ─── Helpers ───────────────────────────────────────────────────────────────

// El tryDecrypt canónico vive en lib/crypto.ts. El duplicado que había acá era
// una versión DEGRADADA: sólo logueaba en desarrollo, así que en producción una
// rotación de key a medias mostraría todas las fichas vacías sin que nadie se
// entere — y el profesional reescribiría encima, destruyendo ciphertext que
// todavía era recuperable. El canónico reporta a Sentry sin PHI (sólo el label
// del campo y la razón categórica).
//
// Este wrapper existe sólo para prefijar el label con el módulo.
function tryDecrypt(value: string | null | undefined, label: string): string | null {
  return tryDecryptCanonico(value, `paciente-ficha.${label}`);
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
    // No se pudo leer el payload real. El fallback legacy de abajo es el shape
    // de QUIROPRAXIA, así que sólo aplica si la fila es de quiropraxia.
    if (!toolPerteneceAEspecialidad(s.tool_id, "quiropraxia")) {
      // Devolver `{v:1,vertebras:[]}` para una sesión de cardio o psico le
      // entregaba a la Tool —y de vuelta al writer— un payload de OTRA
      // herramienta: el zod .strict() lo rechazaba y bloqueaba el guardado
      // ENTERO, SOAP incluido. null = "ilegible", y el writer preserva las
      // columnas tool en vez de pisarlas (debePreservarToolData).
      return null;
    }
  }
  return {
    v: 1,
    vertebras: (s.vertebras_json ?? []).map((v) => ({ id: v.id, estado: v.estado })),
  };
}

/**
 * Descifra + JSON.parse del datos_cifrado del intake avanzado (M60). Tolerante:
 * ciphertext corrupto, JSON inválido o shape no-objeto degradan a `{}` (la
 * sección de la ficha muestra "sin datos" en vez de romper).
 */
function parseIntakeDatos(datosCifrado: string | null): Record<string, unknown> {
  if (datosCifrado == null) return {};
  const plain = tryDecrypt(datosCifrado, "intake.datos");
  if (plain == null) return {};
  try {
    const parsed = JSON.parse(plain) as unknown;
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // PHI: no loguear en producción (linkage a datos clínicos). Degrada a {}.
  }
  return {};
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
