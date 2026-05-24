/**
 * Folio · encriptación columnar de PII/PHI · app-side AES-256-GCM.
 *
 * Decisión arquitectónica (2026-05-18): NO usamos pgsodium TCE. Encriptamos
 * en Node.js antes de INSERT y desencriptamos al leer. Ver
 * memory/decision_supabase_free_pgcrypto.md para el razonamiento.
 *
 * Keys (Vercel env vars encrypted at rest):
 *   - FOLIO_ENC_KEY       — AES-256-GCM, 32 bytes base64
 *   - FOLIO_ENC_HMAC_KEY  — HMAC-SHA256, 32 bytes base64
 *
 * Generación inicial (UNA SOLA VEZ por instancia, antes del primer deploy):
 *   openssl rand -base64 32   → FOLIO_ENC_KEY
 *   openssl rand -base64 32   → FOLIO_ENC_HMAC_KEY
 *
 * Rotation (en F11 con script dedicado):
 *   - Setear FOLIO_ENC_KEY_NEXT con la nueva key.
 *   - Correr `scripts/rotate-enc-key.ts` que decrypta con la vieja y
 *     re-encripta con la nueva, columna por columna.
 *   - Mover FOLIO_ENC_KEY_NEXT → FOLIO_ENC_KEY.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from "node:crypto";

// ─── Carga de keys ──────────────────────────────────────────────────────────

const ALG = "aes-256-gcm";
const IV_LEN = 12;     // 96 bits — recomendado para AES-GCM
const TAG_LEN = 16;    // 128 bits — siempre 16 para GCM

let cachedEncKey: Buffer | null = null;
let cachedHmacKey: Buffer | null = null;

function getEncKey(): Buffer {
  if (cachedEncKey) return cachedEncKey;
  const raw = process.env.FOLIO_ENC_KEY;
  if (!raw) {
    throw new Error(
      "FOLIO_ENC_KEY no definida. Generar con `openssl rand -base64 32` y setear en .env.local.",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `FOLIO_ENC_KEY debe ser 32 bytes (256 bits) en base64. Recibida: ${key.length} bytes.`,
    );
  }
  cachedEncKey = key;
  return key;
}

function getHmacKey(): Buffer {
  if (cachedHmacKey) return cachedHmacKey;
  const raw = process.env.FOLIO_ENC_HMAC_KEY;
  if (!raw) {
    throw new Error(
      "FOLIO_ENC_HMAC_KEY no definida. Generar con `openssl rand -base64 32` y setear en .env.local.",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `FOLIO_ENC_HMAC_KEY debe ser 32 bytes (256 bits) en base64. Recibida: ${key.length} bytes.`,
    );
  }
  cachedHmacKey = key;
  return key;
}

// ─── API pública ────────────────────────────────────────────────────────────

/**
 * Encripta un string y devuelve el literal Postgres `\x<hex>` listo para
 * INSERT en una columna `bytea` vía supabase-js / PostgREST.
 *
 * Formato binario interno: `iv(12) || authTag(16) || ciphertext(N)`.
 * Formato wire (esta función): `'\\x' + hex(iv||tag||ct)`.
 *
 * Por qué retornamos string y NO Buffer:
 *   supabase-js serializa el body de cada request con `JSON.stringify`.
 *   `JSON.stringify(Buffer)` invoca `Buffer.prototype.toJSON()` y produce
 *   `{"type":"Buffer","data":[...]}`. PostgREST recibe ese objeto y lo
 *   almacena como los BYTES ASCII de la cadena JSON, NO como los bytes
 *   binarios originales. Resultado: el bytea queda corrupto.
 *
 *   Diagnosticado en prod 2026-05-18 vía /api/admin/probe-encryption:
 *   `nombre_cifrado` contenía `{"type":"Buffer","data":[82,1,...]}` como
 *   ASCII en vez del ciphertext. El fix es enviar el literal bytea
 *   `\x<hex>` que PostgREST decodifica correctamente a binario.
 *
 * NOTA AES-GCM: con IV random + AAD vacío es semánticamente seguro mientras
 * la key no se reuse para > 2^32 mensajes con el mismo IV (extremadamente
 * improbable con IV random de 96 bits).
 */
export function encryptColumn(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined) return null;
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, getEncKey(), iv) as CipherGCM;
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const wire = Buffer.concat([iv, authTag, ciphertext]);
  return "\\x" + wire.toString("hex");
}

/**
 * Inversa de `encryptColumn`. Acepta varios formatos de wire para tolerar
 * cómo PostgREST y supabase-js serializan bytea en distintos paths:
 *   - `'\\x<hex>'` — formato canónico PostgREST GET response.
 *   - `Buffer` — bindings nativos pg.
 *   - `Uint8Array` — algunos clients.
 *   - base64 plano — fallback.
 */
export function decryptColumn(value: string | Buffer | Uint8Array | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const buf = toBufferForDecrypt(value);
  if (!buf || buf.length === 0) return null;
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error(
      `decryptColumn: ciphertext demasiado corto (${buf.length} bytes, esperado >= ${IV_LEN + TAG_LEN})`,
    );
  }
  const iv = buf.subarray(0, IV_LEN);
  const authTag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALG, getEncKey(), iv) as DecipherGCM;
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

function toBufferForDecrypt(value: string | Buffer | Uint8Array): Buffer | null {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") {
    if (value.length === 0) return null;
    if (value.startsWith("\\x")) return Buffer.from(value.slice(2), "hex");
    if (/^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0) {
      return Buffer.from(value, "hex");
    }
    return Buffer.from(value, "base64");
  }
  return null;
}

/**
 * HMAC-SHA256 determinístico para blind indexes sobre columnas cifradas.
 *
 * Normaliza el input con `lower(trim(plain))` para que "Lorenzo Martínez"
 * y "  lorenzo martínez " produzcan el mismo hash (búsqueda
 * case/space-insensitive).
 *
 * Output: hex string de 64 chars (256 bits), compatible con la función
 * SQL `public.hmac_blind(text)` declarada en M01.
 *
 * ─── Per-tenant salt (audit finding A2 · Sprint 1 T1.5) ────────────────
 *
 * El argumento opcional `salt` (típicamente `organization_id`) se prepend
 * al input antes del HMAC: `HMAC(key, salt + ":" + normalized)`. Esto
 * limita el blast radius si la HMAC key se filtra: el atacante debe
 * precomputar el universo de plaintexts × N orgs en vez de × 1.
 *
 * Backward compatible: si `salt` es undefined, comportamiento idéntico al
 * pre-Sprint 1 (sin prefijo). Los call sites se migran gradualmente con
 * un fallback de lectura legacy durante la transición (Task 1.5.3).
 */
export function blindIndex(
  plain: string | null | undefined,
  salt?: string,
): string | null {
  if (plain === null || plain === undefined) return null;
  const normalized = plain.trim().toLowerCase();
  if (normalized === "") return null;
  const input = salt ? `${salt}:${normalized}` : normalized;
  return createHmac("sha256", getHmacKey()).update(input, "utf8").digest("hex");
}

/**
 * Blind index para teléfonos. Normaliza extrayendo SOLO dígitos y tomando
 * los últimos 10 (drop código de país, paréntesis, espacios, guiones). Así
 * "+54 9 351 555 1234", "(351) 555-1234" y "3515551234" producen el mismo
 * hash y se consideran duplicados en M30 partial UNIQUE.
 *
 * Devuelve null si la entrada no tiene al menos 8 dígitos (no es un
 * teléfono válido para dedup — no queremos colisionar dos "rojo" + "verde"
 * solo porque la normalización los reduce a cadena vacía).
 *
 * Output: hex string de 64 chars (256 bits) o null.
 *
 * Se computa con el mismo HMAC key que blindIndex() — single key rotation.
 *
 * Per-tenant salt: ver `blindIndex` arriba. Si `salt` definido:
 * `HMAC(key, salt + ":tel:" + last10)`. Backward-compatible.
 */
export function blindIndexPhone(
  rawPhone: string | null | undefined,
  salt?: string,
): string | null {
  if (rawPhone === null || rawPhone === undefined) return null;
  const digits = rawPhone.replace(/\D/g, "");
  if (digits.length < 8) return null;
  const last10 = digits.slice(-10);
  const input = salt ? `${salt}:tel:${last10}` : `tel:${last10}`;
  return createHmac("sha256", getHmacKey()).update(input, "utf8").digest("hex");
}

/**
 * Try-decrypt: igual que decryptColumn pero captura excepciones y devuelve
 * null en su lugar (loggeando warning con un label opcional). Útil cuando un
 * solo ciphertext corrupto no debe romper toda la pantalla — defensa
 * operativa post key-rotation o restore parcial.
 */
export function tryDecrypt(
  value: string | Buffer | Uint8Array | null | undefined,
  label = "field",
): string | null {
  if (value === null || value === undefined) return null;
  try {
    return decryptColumn(value);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[crypto] decrypt failed on ${label}:`, msg);
    return null;
  }
}

/**
 * Genera una key aleatoria base64 (32 bytes / 256 bits) para usar como
 * valor de `FOLIO_ENC_KEY` o `FOLIO_ENC_HMAC_KEY`. Helper para setup
 * inicial; NO se invoca en producción.
 */
export function generateKeyBase64(): string {
  return randomBytes(32).toString("base64");
}

/**
 * Versión "object form" para insertar en queries Prisma o supabase-js
 * sin tener que llamar a encryptColumn() en cada campo. Recibe un objeto
 * con strings y devuelve uno con Buffers (los campos a NULL se pasan así).
 *
 * Ejemplo:
 *   const cifrados = encryptFields({ nombre: "Carlos", apellido: "Vega" });
 *   // → { nombre: Buffer, apellido: Buffer }
 */
export function encryptFields<T extends Record<string, string | null | undefined>>(
  fields: T,
): { [K in keyof T]: string | null } {
  const out = {} as { [K in keyof T]: string | null };
  for (const key in fields) {
    out[key] = encryptColumn(fields[key]);
  }
  return out;
}

/** Inversa de encryptFields. */
export function decryptFields<T extends Record<string, string | Buffer | Uint8Array | null | undefined>>(
  fields: T,
): { [K in keyof T]: string | null } {
  const out = {} as { [K in keyof T]: string | null };
  for (const key in fields) {
    out[key] = decryptColumn(fields[key] as string | Buffer | Uint8Array | null | undefined);
  }
  return out;
}
