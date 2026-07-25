/**
 * Folio · helpers puros de formato para el PDF de ficha (C10).
 *
 * Extraídos de `ficha-pdf.tsx` para poder testearlos con `node:test` SIN
 * importar `@react-pdf/renderer` (bundle pesado + APIs de Node del renderer).
 * Puro: sin React, sin DB, sin PHI-como-secreto — sólo transforma strings ya en
 * claro que la route arma. R3 (PDF de receta) puede reusar estos helpers.
 */

/** Un valor vacío/nulo se muestra como "—" para no dejar el bloque en blanco. */
export function orDash(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  return v.length > 0 ? v : "—";
}

/**
 * Formatea el timestamp ISO de generación a es-AR (fecha larga + hora), en la tz
 * de Argentina. Un ISO inválido se devuelve tal cual (defensivo, sin romper el
 * pie del PDF).
 */
export function formatGeneradoTs(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("es-AR", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "America/Argentina/Buenos_Aires",
    }).format(d);
  } catch {
    return iso;
  }
}

/**
 * Arma la línea de metadata del membrete (profesional · matrícula · especialidad)
 * a partir de las partes opcionales. La matrícula SÓLO llega non-null cuando el
 * member optó por mostrarla (M62 mostrar_matricula) — este helper no decide el
 * opt-in, sólo formatea lo que la route ya filtró. Devuelve [] si no hay nada.
 */
export function buildMembreteMeta(parts: {
  profesional?: string | null;
  matricula?: string | null;
  especialidad?: string | null;
}): string[] {
  const meta: string[] = [];
  const prof = (parts.profesional ?? "").trim();
  if (prof) meta.push(prof);
  const mat = (parts.matricula ?? "").trim();
  if (mat) meta.push(`Mat. ${mat}`);
  const esp = (parts.especialidad ?? "").trim();
  if (esp) meta.push(esp);
  return meta;
}

/** ¿Hay algún campo SOAP con contenido? (decide si se pinta el bloque SOAP). */
export function tieneSoap(soap: { s: string; o: string; a: string; p: string }): boolean {
  return Boolean(soap.s.trim() || soap.o.trim() || soap.a.trim() || soap.p.trim());
}

// ─── Evolución (D2 · últimas N sesiones en el PDF) ───────────────────────────

/**
 * Input estructural de una sesión del historial de la ficha (subset de
 * SesionPlan, tipado acá para que este módulo siga siendo puro — sin importar
 * lib/db, que arrastra crypto/supabase y rompería los tests de node:test).
 */
export interface EvolucionSesionInput {
  fecha: string;
  servicio: string;
  /** Resumen humano de la herramienta de la especialidad ("cambio"). */
  cambio: string;
  soap: { s: string; o: string; a: string; p: string } | null;
}

/** Una entrada de la sección "Evolución" del PDF (todo ya en claro). */
export interface EvolucionPdfEntrada {
  fecha: string;
  servicio: string;
  resumen: string;
  /** SOAP compacto de esa sesión, o null si no hay nada escrito. */
  soap: { s: string; o: string; a: string; p: string } | null;
}

/** Tope de sesiones que entran a la sección Evolución del PDF. */
export const EVOLUCION_PDF_MAX = 10;

/**
 * Mapea el historial de la ficha (DESC, más reciente primero) a las entradas
 * de la sección "Evolución" del PDF: hasta `max` sesiones con fecha · servicio
 * · resumen, y el SOAP compacto solo cuando tiene contenido (un SOAP vacío se
 * omite en vez de imprimir cuatro "—").
 */
export function evolucionDesdeSesiones(
  sesiones: EvolucionSesionInput[],
  max: number = EVOLUCION_PDF_MAX,
): EvolucionPdfEntrada[] {
  return sesiones.slice(0, Math.max(0, max)).map((s) => ({
    fecha: s.fecha,
    servicio: s.servicio,
    resumen: s.cambio,
    soap: s.soap && tieneSoap(s.soap) ? s.soap : null,
  }));
}
