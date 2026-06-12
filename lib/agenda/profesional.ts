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
