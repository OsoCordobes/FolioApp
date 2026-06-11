/**
 * Folio · verificación timing-safe del header `Authorization: Bearer <secret>`.
 *
 * Los endpoints operativos (`/api/cron/*`, `/api/admin/*`,
 * `/api/analytics/refresh`) comparaban el header con `!==`, que corta en el
 * primer byte distinto y filtra información de timing sobre el prefijo
 * correcto del secret. Con HTTP remoto el ruido hace el ataque poco práctico,
 * pero la comparación constante es gratis y elimina la clase de bug.
 *
 * Patrón estándar: hashear ambos lados con SHA-256 y comparar los digests con
 * `crypto.timingSafeEqual`. El hash normaliza las longitudes (timingSafeEqual
 * exige buffers del mismo tamaño y, si no, throwea — además de que comparar
 * longitudes directamente ya filtraría la longitud del secret).
 */

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Compara dos strings en tiempo constante respecto de su contenido.
 * No filtra ni el contenido ni la longitud (ambos lados pasan por SHA-256,
 * que produce digests de 32 bytes siempre).
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(digestA, digestB);
}

/**
 * Valida `Authorization: Bearer <expectedSecret>` en tiempo constante.
 *
 * Fail-closed:
 *   - `expectedSecret` ausente/vacío → false (endpoint mal configurado; el
 *     caller decide si responde 500 — patrón existente — o 401).
 *   - header ausente/vacío → false.
 *
 * @param authorizationHeader valor crudo de `req.headers.get("authorization")`.
 * @param expectedSecret      secret esperado SIN el prefijo "Bearer ".
 */
export function verifyBearer(
  authorizationHeader: string | null | undefined,
  expectedSecret: string | null | undefined,
): boolean {
  if (!expectedSecret) return false;
  if (!authorizationHeader) return false;
  return timingSafeEqualStrings(authorizationHeader, `Bearer ${expectedSecret}`);
}
