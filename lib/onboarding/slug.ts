/**
 * Folio · slug del consultorio.
 *
 * Reglas:
 *   - lowercase, sin diacríticos
 *   - solo [a-z0-9-]
 *   - max 50 chars
 *   - no empieza/termina con guion
 *   - sin doble guion consecutivo
 *
 * Para validar disponibilidad real-time en el onboarding, usar
 * `checkSlugAvailability` (Server Action) — query a DB con index UNIQUE en
 * `organization.slug`.
 */

/**
 * Mínimo real de caracteres del slug. El constraint de DB es
 * `slug ~ '^[a-z0-9][a-z0-9-]{2,62}[a-z0-9]$'`, que exige al menos
 * 1 (start) + 2 (middle, {2,...}) + 1 (end) = 4 caracteres. Los
 * validadores client/zod estaban en 3 (por debajo del mínimo real),
 * por eso un slug de 3 chars pasaba la validación manual pero rompía
 * el INSERT. Alineamos todo a 4 (BL-1).
 */
export const SLUG_MIN_LENGTH = 4;
export const SLUG_MAX_LENGTH = 50;

/**
 * Convierte un string a slug seguro para URL. Puro, idempotente.
 *
 * Ejemplos:
 *   slugify("Lorenzo Martínez")           → "lorenzo-martinez"
 *   slugify("Quiropraxia Córdoba")        → "quiropraxia-cordoba"
 *   slugify("--abc--")                    → "abc"
 *   slugify("123 456")                    → "123-456"
 *   slugify("Café Ñandú")                 → "cafe-nandu"
 *   slugify("")                           → ""
 */
export function slugify(input: string): string {
  if (!input) return "";
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")        // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")            // non-alphanumeric → dash
    .replace(/^-+|-+$/g, "")                // trim leading/trailing dashes
    .replace(/-+/g, "-")                    // collapse multiple dashes
    .slice(0, 50);
}

/**
 * Valida que un slug cumpla las reglas. Devuelve error específico o null si OK.
 * Usado en client antes de hacer query a la DB (defensive).
 */
export function validateSlugFormat(slug: string): string | null {
  if (!slug) return "Elegí un link.";
  if (slug.length < SLUG_MIN_LENGTH) return `Mínimo ${SLUG_MIN_LENGTH} caracteres.`;
  if (slug.length > SLUG_MAX_LENGTH) return `Máximo ${SLUG_MAX_LENGTH} caracteres.`;
  if (!/^[a-z0-9-]+$/.test(slug)) return "Solo minúsculas, números y guiones.";
  if (slug.startsWith("-") || slug.endsWith("-")) return "No puede empezar ni terminar con guión.";
  if (slug.includes("--")) return "Sin guiones consecutivos.";
  return null;
}

/**
 * Deriva un slug provisional SIEMPRE válido contra el constraint de DB a
 * partir de un texto libre (típicamente el local-part del email). Garantiza:
 *   - solo [a-z0-9-], sin diacríticos, sin guiones colgantes
 *   - empieza y termina en alfanumérico
 *   - largo entre SLUG_MIN_LENGTH y SLUG_MAX_LENGTH
 *
 * Si el slugify del input queda vacío o por debajo del mínimo (emails con
 * local-part corto: "dr@", "jo@", iniciales), lo reemplaza/completa con una
 * base segura ("consultorio") más un sufijo random corto. El resultado todavía
 * pasa por `pickFreshSlug` para resolver colisiones (BL-1).
 *
 * Puro/idempotente salvo por el sufijo random (solo se usa en el fallback).
 */
export function deriveProvisionalSlug(input: string): string {
  const base = slugify(input ?? "");
  if (base.length >= SLUG_MIN_LENGTH) {
    return base.slice(0, SLUG_MAX_LENGTH);
  }
  // Demasiado corto o vacío: garantizamos >= SLUG_MIN_LENGTH usando una base
  // segura + sufijo random. "consultorio" ya supera el mínimo; el sufijo evita
  // que dos local-parts cortos colisionen siempre en el mismo slug.
  const safeBase = base || "consultorio";
  // slice(2,7) puede quedar vacío si Math.random() es exactamente 0
  // ("0".toString(36) === "0" → slice(2) === ""), dejando un slug con guion
  // colgante ("consultorio-"). Garantizamos un sufijo no vacío.
  const suffix = Math.random().toString(36).slice(2, 7) || "x0";
  return `${safeBase}-${suffix}`.slice(0, SLUG_MAX_LENGTH);
}

/**
 * Sugiere alternativas cuando un slug está tomado. Devuelve hasta 3 opciones.
 *
 * Estrategias:
 *   1. Sufijo numérico: "lorenzo-martinez" → "lorenzo-martinez-2"
 *   2. Iniciales: "lorenzo-martinez" → "lorenzo-m"
 *   3. Otro orden: "juan-perez" → "perez-juan"
 */
export function suggestSlugAlternatives(takenSlug: string): string[] {
  const out = new Set<string>();
  const parts = takenSlug.split("-").filter(Boolean);

  // Estrategia 1: sufijo numérico
  for (let n = 2; n <= 4; n++) {
    out.add(`${takenSlug}-${n}`);
  }

  // Estrategia 2: iniciales (si tiene 2+ palabras)
  if (parts.length >= 2) {
    const lastInitial = parts[parts.length - 1]?.charAt(0);
    if (lastInitial) {
      out.add(`${parts.slice(0, -1).join("-")}-${lastInitial}`);
    }
  }

  // Estrategia 3: swap nombre-apellido si parecen ambos
  if (parts.length === 2) {
    out.add(`${parts[1]}-${parts[0]}`);
  }

  return Array.from(out).slice(0, 3);
}
