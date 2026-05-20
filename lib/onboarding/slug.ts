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
  if (slug.length < 3) return "Mínimo 3 caracteres.";
  if (slug.length > 50) return "Máximo 50 caracteres.";
  if (!/^[a-z0-9-]+$/.test(slug)) return "Solo minúsculas, números y guiones.";
  if (slug.startsWith("-") || slug.endsWith("-")) return "No puede empezar ni terminar con guión.";
  if (slug.includes("--")) return "Sin guiones consecutivos.";
  return null;
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
