/**
 * Folio · normalización de texto para búsqueda de pacientes.
 *
 * En Argentina casi todos los nombres llevan tilde (José, María, Martín):
 * un `toLowerCase().includes()` pelado hace que "jose" NO encuentre a "José".
 * Este helper aplica lowercase + NFD + strip de diacríticos (mismo patrón que
 * `slugify` en lib/onboarding/slug.ts) y se usa en AMBOS lados — query y
 * campos — en el buscador del directorio de /pacientes y en el typeahead del
 * modal de crear turno (client y server action).
 *
 * Puro e idempotente: apto para client components y server actions.
 */

/**
 * Normaliza un string para comparación de búsqueda insensible a tildes,
 * mayúsculas y espacios en los bordes.
 *
 * Ejemplos:
 *   normalizarBusqueda("José")     → "jose"
 *   normalizarBusqueda("  MARÍA ") → "maria"
 *   normalizarBusqueda("Muñoz")    → "munoz"  (ñ → n: "munoz" lo encuentra)
 *   normalizarBusqueda("")         → ""
 */
export function normalizarBusqueda(input: string): string {
  if (!input) return "";
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacríticos (́ ̀ ̈ ̃ …)
    .toLowerCase()
    .trim();
}
