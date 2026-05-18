/**
 * Folio · encriptación columnar de PII/PHI · app-side AES-256-GCM.
 *
 * Decisión arquitectónica (2026-05-18): NO usamos pgsodium TCE.
 * Encriptamos en Node.js antes de INSERT y desencriptamos al leer.
 * Ver memory/decision_supabase_free_pgcrypto.md para el razonamiento.
 *
 * Esta es la INTERFAZ. La implementación real se completa en F4
 * (Data Layer + Server Actions) cuando se conecten las primeras
 * queries con Supabase. Hasta entonces, las funciones lanzan para
 * señalizar que no están listas — F1 no las invoca.
 *
 * Las keys viven en:
 *   - `process.env.FOLIO_ENC_KEY`       — AES-256-GCM, 32 bytes base64
 *   - `process.env.FOLIO_ENC_HMAC_KEY`  — HMAC-SHA256, 32 bytes base64
 *
 * Ambas se generan una sola vez por organización con:
 *   `openssl rand -base64 32`
 *
 * Rotation: cuando rotemos las keys, vamos a tener que correr una
 * migración offline que decrypta con la key vieja y re-encripta con
 * la nueva. F11 incluye script `scripts/rotate-enc-key.ts` para esto.
 */

const NOT_IMPLEMENTED_MSG =
  "lib/crypto.ts está declarado pero aún no implementado (la implementación entra en F4 con la integración real de Supabase).";

/**
 * Encripta un string a un `Buffer` listo para insertar en una columna `bytea`.
 *
 * Formato del ciphertext: `iv(12) || authTag(16) || ciphertext(N)` concatenados.
 * Decisión: NO prefijar versión de key (`keyId`) — usamos una key por org
 * por vida del producto v1; cuando rotemos en v2 introducimos `keyId`.
 */
export function encryptColumn(plaintext: string | null): Buffer | null {
  if (plaintext === null || plaintext === undefined) return null;
  throw new Error(NOT_IMPLEMENTED_MSG);
}

/** Inversa de `encryptColumn`. */
export function decryptColumn(ciphertext: Buffer | null): string | null {
  if (!ciphertext) return null;
  throw new Error(NOT_IMPLEMENTED_MSG);
}

/**
 * HMAC-SHA256 determinístico para blind indexes sobre columnas cifradas.
 *
 * Normaliza el input con `lower(trim(plain))` antes de hashear para que
 * "Lorenzo Martínez" y "  lorenzo martínez " produzcan el mismo hash y
 * la búsqueda case/space-insensitive funcione.
 *
 * Output: hex string de 64 chars (256 bits hex-encoded), match con la
 * función SQL `public.hmac_blind(text)` declarada en M01.
 */
export function blindIndex(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined || plain.trim() === "") return null;
  throw new Error(NOT_IMPLEMENTED_MSG);
}

/**
 * Genera una key aleatoria base64 (32 bytes / 256 bits) para usar como
 * valor de `FOLIO_ENC_KEY` o `FOLIO_ENC_HMAC_KEY`. Util como helper de
 * setup; NO debe correr en producción.
 *
 * Equivalente CLI: `openssl rand -base64 32`
 */
export function generateKeyBase64(): string {
  throw new Error(NOT_IMPLEMENTED_MSG);
}
