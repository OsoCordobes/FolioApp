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
