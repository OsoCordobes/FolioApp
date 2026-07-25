/**
 * Folio · ficha del paciente · lógica PURA del borrador clínico (D1).
 *
 * El tab Plan de la ficha mantiene un borrador local (SOAP + toolData de la
 * herramienta de especialidad). Estas funciones deciden, sin I/O ni React:
 *
 *   - `esBorradorSucio`: ¿el borrador difiere de lo último guardado/hidratado?
 *     (gatea el guard de beforeunload y el autosave).
 *   - `decidirAutosave`: ¿corresponde programar un autoguardado ahora?
 *     (solo con turno ancla EN CURSO, tras una interacción REAL del
 *     profesional, borrador sucio, sin guardado en vuelo y sin un error
 *     pendiente — tras un fallo, el autosave se re-arma recién cuando el
 *     profesional vuelve a editar).
 *   - `anioDeFecha`: año display de una fecha YYYY-MM-DD (reemplaza el "2026"
 *     hardcodeado del tab Sesiones).
 *
 * Puras a propósito: se testean con node:test (tests/unit/ficha-borrador) sin
 * montar React ni tocar la DB. PHI: acá solo se COMPARA contenido clínico, no
 * se loguea ni persiste nada.
 */

export interface BorradorFicha {
  soap: { subjetivo: string; objetivo: string; analisis: string; plan: string };
  toolValue: unknown;
}

/**
 * ¿El borrador actual difiere del baseline (lo último guardado o lo hidratado
 * del server)? SOAP se compara campo a campo; toolValue por JSON.stringify —
 * suficiente porque ambos lados salen del MISMO productor (la Tool emite el
 * objeto completo con orden de claves estable), no de fuentes heterogéneas.
 */
export function esBorradorSucio(actual: BorradorFicha, baseline: BorradorFicha): boolean {
  const a = actual.soap;
  const b = baseline.soap;
  if (
    a.subjetivo !== b.subjetivo ||
    a.objetivo !== b.objetivo ||
    a.analisis !== b.analisis ||
    a.plan !== b.plan
  ) {
    return true;
  }
  // Short-circuit por IDENTIDAD antes de serializar: la MISMA referencia nunca
  // está sucia. Sin esto, un toolValue no serializable (circular) caería en el
  // fallback `no-serializable:${Math.random()}` de stringifyTool y quedaría
  // "siempre distinto" — autosave infinito cada 10 s sin ningún cambio real.
  if (actual.toolValue === baseline.toolValue) return false;
  return stringifyTool(actual.toolValue) !== stringifyTool(baseline.toolValue);
}

/** JSON estable-suficiente del toolValue (null/undefined colapsan a "null"). */
function stringifyTool(value: unknown): string {
  if (value == null) return "null";
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    // Valor no serializable (no debería pasar: el toolData es JSON por
    // contrato) — lo tratamos como "siempre distinto" para no perder cambios.
    return `no-serializable:${Math.random()}`;
  }
}

/**
 * Modo del turno ancla — espejo de TurnoAnclaModo (lib/db/paciente-ficha.ts),
 * duplicado acá para que este módulo siga siendo puro y sin dependencias.
 */
export type ModoTurnoAncla = "en_curso" | "por_iniciar" | "retroactivo";

export interface DecisionAutosaveInput {
  /** ¿Hay diferencias contra lo último guardado? */
  sucio: boolean;
  /** ¿Hay un guardado en vuelo? (no encimar requests) */
  guardando: boolean;
  /** ¿Existe un turno ancla contra el cual guardar? */
  hayTurno: boolean;
  /**
   * ¿Quedó un error de guardado sin resolver? Tras un fallo el autosave NO
   * reintenta en loop: se re-arma cuando el usuario vuelve a editar (la UI
   * limpia el error en el próximo cambio).
   */
  hayError: boolean;
  /**
   * Modo del turno ancla (null = sin turno). El autosave SOLO corre con la
   * atención en curso ("en_curso"): en "por_iniciar" auto-guardaría horas antes
   * del turno (y la action manual transiciona a ATENDIENDO — atendiendo_desde
   * falso); en "retroactivo" persistiría cada typo sobre la sesión HISTÓRICA de
   * una visita cerrada a los 10 s. En esos modos, guardar es una decisión
   * explícita del profesional (botón "Guardar sesión").
   */
  modoTurno: ModoTurnoAncla | null;
  /**
   * ¿El profesional editó DE VERDAD (tecla/click en SOAP o herramienta)? El
   * seed programático del carry-forward NO cuenta: abrir la ficha jamás debe
   * escribir la HC sola.
   */
  huboInteraccion: boolean;
}

/** ¿Corresponde programar un autoguardado del borrador ahora? */
export function decidirAutosave(input: DecisionAutosaveInput): boolean {
  return (
    input.hayTurno &&
    input.modoTurno === "en_curso" &&
    input.huboInteraccion &&
    input.sucio &&
    !input.guardando &&
    !input.hayError
  );
}

/** Debounce del autosave: ~10 s después de la última tecla (D1). */
export const AUTOSAVE_DEBOUNCE_MS = 10_000;

/**
 * Año display de una fecha YYYY-MM-DD (o ISO más largo). Inválida/vacía → ""
 * (la UI no muestra nada en vez de mentir un año).
 */
export function anioDeFecha(fecha: string): string {
  if (!fecha) return "";
  const d = new Date(fecha + (fecha.length === 10 ? "T00:00:00" : ""));
  if (isNaN(d.getTime())) return "";
  return String(d.getFullYear());
}
