/**
 * Folio · agenda multi-profesional — lógica pura del selector de profesional.
 *
 * Decide, para /hoy y /calendario, si se muestra el selector "Todos | Dr. X |
 * Dra. Y", qué profesional filtra efectivamente el fetcher y si las cards de
 * turno llevan la atribución visual (chip con iniciales del profesional).
 *
 * Reglas (auditoría 2026-06-12, área "agenda multi-profesional"):
 *   - Un member SIN `actsAcrossProfessionals` (rol PROFESIONAL) ve SIEMPRE su
 *     propia agenda: el fetcher recibe su memberId y el selector no se ofrece
 *     (ignora `?prof=` ajeno — la RLS igual sería el gate real).
 *   - Con `actsAcrossProfessionals` y >1 colegiado: selector visible; `?prof=`
 *     válido filtra; ausente/ inválido → "Todos" (org-wide, sin filtro).
 *   - Con 0–1 colegiados (org Solo): selector oculto y sin filtro — el render
 *     queda idéntico al histórico, ni un píxel cambia.
 *   - Atribución (chip por turno): solo en vista "Todos" con >1 colegiado.
 *
 * Módulo puro (sin DB/React) — testeado en tests/unit/agenda-profesional.test.ts.
 */

/** Profesional colegiado activo, reducido a lo necesario para display. */
export interface ProfesionalLite {
  /** member.id (UUID). */
  id: string;
  /** Nombre legible: "Nombre Apellido" (fallback email). Sin PHI. */
  displayName: string;
}

export interface ResolveAgendaProfInput {
  /** capabilitiesFor(role, esColegiado).actsAcrossProfessionals */
  actsAcrossProfessionals: boolean;
  /** member.id de la sesión activa. */
  sessionMemberId: string;
  /** Valor crudo del searchParam `?prof=` (o null si ausente). */
  profParam: string | null;
  /** Colegiados activos de la org (listProfesionalesLite). */
  profesionales: ProfesionalLite[];
}

export interface AgendaProfResolution {
  /** ¿Renderizar la fila de chips "Todos | Dr. X | …"? */
  selectorVisible: boolean;
  /** memberId que filtra el fetcher; null = "Todos" (org-wide). */
  profesionalIdEfectivo: string | null;
  /** ¿Mostrar el chip de profesional en cada card de turno? */
  mostrarAtribucion: boolean;
}

export function resolveAgendaProfesional(input: ResolveAgendaProfInput): AgendaProfResolution {
  const { actsAcrossProfessionals, sessionMemberId, profParam, profesionales } = input;

  // PROFESIONAL (sin capability cross): su agenda, siempre. Selector oculto.
  if (!actsAcrossProfessionals) {
    return {
      selectorVisible: false,
      profesionalIdEfectivo: sessionMemberId,
      mostrarAtribucion: false,
    };
  }

  // Org Solo (0–1 colegiados): comportamiento histórico intacto.
  if (profesionales.length <= 1) {
    return { selectorVisible: false, profesionalIdEfectivo: null, mostrarAtribucion: false };
  }

  // Clínica con >1 colegiado y rol cross: selector visible. El param solo
  // filtra si referencia a un colegiado real de la org (anti-tampering UX;
  // la RLS sigue siendo el gate de datos).
  const valido = profParam != null && profesionales.some((p) => p.id === profParam);
  const efectivo = valido ? profParam : null;

  return {
    selectorVisible: true,
    profesionalIdEfectivo: efectivo,
    mostrarAtribucion: efectivo == null,
  };
}

// ─── Picker de profesional en modales (crear turno / aceptar pedido) ────────

export interface ResolvePickerProfInput {
  /** Colegiados activos de la org (listProfesionalesLite). */
  profesionales: ProfesionalLite[];
  /** member.id de la sesión activa. */
  sessionMemberId: string;
  /**
   * Profesional preferido por el caller (el filtro `?prof=` activo en /hoy o
   * /calendario), si vino. Solo se respeta si referencia a un colegiado real.
   */
  preferidoId?: string | null;
}

export interface PickerProfResolution {
  /** ¿Renderizar el <select> de profesional? Solo con >1 colegiado. */
  pickerVisible: boolean;
  /** Preselección del picker (o el destino implícito si no hay picker). */
  defaultProfesionalId: string | null;
}

/**
 * Decisión pura del picker de profesional en los modales de creación/acepte
 * (CLINICA-3): a quién se le asigna el turno por default.
 *
 * Reglas:
 *   - Picker visible SOLO con >1 colegiado (org Solo: ni un píxel cambia).
 *   - Default, en orden: (a) el profesional del filtro activo si el caller lo
 *     pasó y es un colegiado real, (b) el member de la sesión si es colegiado
 *     (está en la lista), (c) el primer colegiado. Lista vacía → null (el
 *     server decide: sesión colegiada o err de validación).
 *
 * El default es solo UX — la validación real del destino es server-side
 * (lib/db/profesional-destino.ts) y la RLS sigue siendo el gate de datos.
 */
export function resolvePickerProfesional(input: ResolvePickerProfInput): PickerProfResolution {
  const { profesionales, sessionMemberId, preferidoId } = input;

  const preferidoValido =
    preferidoId != null && profesionales.some((p) => p.id === preferidoId) ? preferidoId : null;
  const sesionColegiada = profesionales.some((p) => p.id === sessionMemberId)
    ? sessionMemberId
    : null;

  return {
    pickerVisible: profesionales.length > 1,
    defaultProfesionalId: preferidoValido ?? sesionColegiada ?? profesionales[0]?.id ?? null,
  };
}

/**
 * Iniciales para el chip de atribución: "Carla Gómez" → "CG", "Ana" → "A".
 * Máx 2 letras, uppercase; string vacío → "?" (defensivo).
 */
export function inicialesProfesional(displayName: string): string {
  const partes = displayName.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const letras = partes.map((p) => p[0]).filter(Boolean);
  return (letras.length >= 2 ? letras[0] + letras[letras.length - 1] : letras[0]).toUpperCase();
}

/**
 * Nombre corto para tooltips/cards anchas: "Carla Gómez Pérez" → "Carla G.".
 * Un solo término queda igual.
 */
export function nombreCortoProfesional(displayName: string): string {
  const partes = displayName.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "";
  if (partes.length === 1) return partes[0];
  return `${partes[0]} ${partes[1][0]}.`;
}
