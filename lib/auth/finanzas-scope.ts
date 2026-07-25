/**
 * Folio · scoping de /finanzas por profesional (fix del leak E1.2).
 *
 * La matriz de permisos de Configuración promete "Ver finanzas propias —
 * Solo los ingresos generados por uno mismo" para PROFESIONAL, pero
 * getFinanzasDelMes filtraba únicamente por organización: un médico de una
 * clínica veía las finanzas de TODOS sus colegas.
 *
 * Esta función pura decide qué member.id pasarle al fetcher como filtro:
 *   - canSeeFinanzasAll (OWNER/DIRECTOR)      → null (ve toda la org).
 *   - canSeeFinanzasOwn sin All (PROFESIONAL) → su propio member.id.
 *   - sin finanzas (recepción/coordinación)   → null — irrelevante: la page
 *     ya cortó antes con notFound() por !canSeeFinanzas.
 *
 * Testeada contra capabilitiesFor en tests/unit/finanzas-scope.test.ts.
 */

import type { Capabilities } from "./capabilities";

export function finanzasScopeMemberId(
  caps: Pick<Capabilities, "canSeeFinanzasAll" | "canSeeFinanzasOwn">,
  sessionMemberId: string,
): string | null {
  if (caps.canSeeFinanzasAll) return null;
  if (caps.canSeeFinanzasOwn) return sessionMemberId;
  return null;
}
