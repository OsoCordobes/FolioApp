/**
 * Folio · especialidades · contrato del slot clínico (Fase B).
 *
 * Cada especialidad aporta una herramienta (Tool) que se renderiza en el tab
 * "Plan" de la ficha del paciente. La interfaz está congelada desde Fase B
 * para que las herramientas de cardiología/psicología (Fase D) se construyan
 * contra el mismo contrato sin tocar el slot.
 *
 * `toolData` es opaco para el slot: cada especialidad lo valida con su schema
 * zod (ver lib/especialidades/meta.ts) y lo persiste cifrado app-side en
 * `sesion.tool_data_cifrado` (M50).
 */

/** Una entrada del historial clínico para la herramienta (sesión pasada). */
export interface ToolHistorialEntry {
  /** Fecha de la sesión (YYYY-MM-DD, derivada de sesion.created_at). */
  fecha: string;
  /** Payload de la herramienta de esa sesión (descifrado o fallback legacy). */
  toolData: unknown;
  /**
   * `sesion.tool_id` persistido (M50) — permite filtrar el historial por la
   * herramienta activa en fichas mixtas (M55, filtrarToolHistorial). Opcional
   * por compat: ausente/null = fila legacy pre-M50 (quiropraxia implícita).
   */
  toolId?: string | null;
}

/** Props que el slot clínico le pasa a la Tool de la especialidad activa. */
export interface SpecialtyToolProps {
  /** toolData actual (borrador de la sesión en curso) o null si no hay. */
  value: unknown;
  /** El Tool avisa cada cambio local con el toolData completo nuevo. */
  onChange(next: unknown): void;
  /** true = sesión bloqueada / sin permisos de edición. */
  readOnly?: boolean;
  /** Sesiones previas, ordenadas DESC por fecha (la más reciente primero). */
  historial: ToolHistorialEntry[];
}
