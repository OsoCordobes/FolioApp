/**
 * Folio · helpers PUROS del portal del paciente relacionados al booking
 * público (F2 · identidad del portal). Sin DB, testeables en aislamiento.
 */

/**
 * Decide si una org linkeada al paciente es RESERVABLE por el link público
 * `/book/{slug}` y devuelve el slug a usar (o null si no hay destino válido).
 *
 * Espeja los filtros de la page pública y de fetchSlotsPublico
 * (app/(public)/book/[slug]/actions.ts): org viva (`deleted_at IS NULL`) y
 * listada (`opt_out_public_listing = false`). Si el portal linkeara a una org
 * deslistada/borrada, el paciente aterrizaría en un 404 — mejor no ofrecer el
 * botón.
 */
export function bookingSlugDeOrg(org: {
  slug: string | null;
  optOutPublicListing: boolean;
  deletedAt: string | null;
}): string | null {
  if (!org.slug) return null;
  if (org.optOutPublicListing) return null;
  if (org.deletedAt != null) return null;
  return org.slug;
}
