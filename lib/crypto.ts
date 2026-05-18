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
 * Encripta un string a un `Buffer` listo para insertar en una columna `bytea`.
 *
 * Formato del ciphertext: `iv(12) || authTag(16) || ciphertext(N)` concatenados.
 *
 * NOTA: AES-GCM con IV random + AAD vacío es semánticamente seguro mientras
 * la key no se reuse para encriptar > 2^32 mensajes con el mismo IV
 * (extremadamente improbable con IV random de 96 bits). Para 20 médicos
 * × 50 turnos/mes durante 4 años = 4800 encryptions/mes = ~230k total,
 * estamos a 14 órdenes de magnitud del límite teórico.
 */
export function encryptColumn(plaintext: string | null | undefined): Buffer | null {
  if (plaintext === null || plaintext === undefined) return null;
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, getEncKey(), iv) as CipherGCM;
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

/** Inversa de `encryptColumn`. */
export function decryptColumn(buf: Buffer | null | undefined): string | null {
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

/**
 * HMAC-SHA256 determinístico para blind indexes sobre columnas cifradas.
 *
 * Normaliza el input con `lower(trim(plain))` para que "Lorenzo Martínez"
 * y "  lorenzo martínez " produzcan el mismo hash (búsqueda
 * case/space-insensitive).
 *
 * Output: hex string de 64 chars (256 bits), compatible con la función
 * SQL `public.hmac_blind(text)` declarada en M01.
 */
export function blindIndex(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined) return null;
  const normalized = plain.trim().toLowerCase();
  if (normalized === "") return null;
  return createHmac("sha256", getHmacKey()).update(normalized, "utf8").digest("hex");
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
): { [K in keyof T]: Buffer | null } {
  const out = {} as { [K in keyof T]: Buffer | null };
  for (const key in fields) {
    out[key] = encryptColumn(fields[key]);
  }
  return out;
}

/** Inversa de encryptFields. */
export function decryptFields<T extends Record<string, Buffer | null | undefined>>(
  fields: T,
): { [K in keyof T]: string | null } {
  const out = {} as { [K in keyof T]: string | null };
  for (const key in fields) {
    out[key] = decryptColumn(fields[key]);
  }
  return out;
}
