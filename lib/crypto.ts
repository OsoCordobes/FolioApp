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
 * ─── Rotación de keys ──────────────────────────────────────────────────────
 *
 * Cada key acepta una variante `_NEXT` opcional:
 *
 *   FOLIO_ENC_KEY_NEXT        FOLIO_ENC_HMAC_KEY_NEXT
 *
 * Mientras `_NEXT` esté seteada:
 *   - se ESCRIBE siempre con `_NEXT` (todo lo nuevo nace con la key nueva);
 *   - se LEE probando `_NEXT` primero y cayendo a la actual (AES-GCM autentica
 *     con el auth tag, así que una key equivocada falla en vez de devolver
 *     basura — la probabilidad de que un tag de 128 bits valide con la key
 *     incorrecta es 2^-128).
 *
 * Por qué la key NUEVA va en `_NEXT` y no al revés. Lo natural sería poner la
 * nueva en `FOLIO_ENC_KEY` y la vieja en un `_PREV`, pero eso exige ESCRIBIR
 * el valor viejo en una variable nueva — y en este deploy la key vieja está
 * cargada en Vercel como `sensitive`, que es write-only: nadie puede leerla
 * para copiarla a ningún lado. Invertir el orden evita el problema: la vieja
 * se queda donde ya está y la nueva —la única que un humano conoce— entra por
 * `_NEXT`. Al terminar la rotación se escribe esa misma key nueva sobre
 * `FOLIO_ENC_KEY` y se borra `_NEXT`.
 *
 * Procedimiento completo en docs/ROTACION-CLAVES.md.
 *
 * Sin `_NEXT` seteada el comportamiento es idéntico al de antes de este
 * cambio: una sola key, para leer y escribir.
 */

// Frontera server/client enforced por bundler: si un Client Component importa
// este módulo (directa o transitivamente), `next build` falla en compile-time.
// Sin esto, la frontera de FOLIO_ENC_KEY era solo convención. Los unit tests
// (node:test) corren con `--conditions react-server` para resolver el stub
// vacío del package (ver package.json `test:unit`).
import "server-only";

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

/**
 * Cache por nombre de variable. `undefined` = todavía no se leyó;
 * `null` = leída y ausente (se cachea el negativo para no re-parsear en cada
 * llamada de un `.map()` sobre un listado).
 */
const keyCache = new Map<string, Buffer | null>();

/** Lee y valida una key base64 de 32 bytes. Devuelve null si la env no está. */
function loadKey(envVar: string): Buffer | null {
  const cached = keyCache.get(envVar);
  if (cached !== undefined) return cached;
  const raw = process.env[envVar];
  if (!raw || raw.trim() === "") {
    keyCache.set(envVar, null);
    return null;
  }
  const key = Buffer.from(raw.trim(), "base64");
  if (key.length !== 32) {
    // No se cachea el error: una env mal seteada se corrige y el proceso
    // siguiente tiene que verla bien.
    throw new Error(
      `${envVar} debe ser 32 bytes (256 bits) en base64. Recibida: ${key.length} bytes.`,
    );
  }
  keyCache.set(envVar, key);
  return key;
}

function requerida(envVar: string): Buffer {
  const key = loadKey(envVar);
  if (!key) {
    throw new Error(
      `${envVar} no definida. Generar con \`openssl rand -base64 32\` y setear en .env.local.`,
    );
  }
  return key;
}

/**
 * Key con la que se ESCRIBE. Durante una rotación es la nueva: todo lo que se
 * cifra o hashea desde que arranca nace ya con la key destino, así que el
 * conjunto de filas viejas sólo puede achicarse.
 */
function getEncKey(): Buffer {
  return loadKey("FOLIO_ENC_KEY_NEXT") ?? requerida("FOLIO_ENC_KEY");
}

function getHmacKey(): Buffer {
  return loadKey("FOLIO_ENC_HMAC_KEY_NEXT") ?? requerida("FOLIO_ENC_HMAC_KEY");
}

/**
 * Keys con las que se LEE, en orden de intento: primero la de escritura.
 * Fuera de una rotación devuelve un solo elemento y el costo es el de antes.
 */
function getEncKeysRead(): Buffer[] {
  const next = loadKey("FOLIO_ENC_KEY_NEXT");
  const actual = requerida("FOLIO_ENC_KEY");
  return next ? [next, actual] : [actual];
}

function getHmacKeysRead(): Buffer[] {
  const next = loadKey("FOLIO_ENC_HMAC_KEY_NEXT");
  const actual = requerida("FOLIO_ENC_HMAC_KEY");
  return next ? [next, actual] : [actual];
}

/** ¿Hay una rotación en curso? (alguna `_NEXT` seteada). */
export function rotacionEnCurso(): { enc: boolean; hmac: boolean } {
  return {
    enc: loadKey("FOLIO_ENC_KEY_NEXT") !== null,
    hmac: loadKey("FOLIO_ENC_HMAC_KEY_NEXT") !== null,
  };
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

  // Durante una rotación conviven filas cifradas con dos keys distintas y el
  // ciphertext NO lleva identificador de key. Se prueba en orden y se confía
  // en el auth tag de GCM: con la key equivocada `final()` tira, no devuelve
  // texto corrupto. Fuera de una rotación esto es un solo intento.
  let ultimoError: unknown;
  for (const key of getEncKeysRead()) {
    try {
      const decipher = createDecipheriv(ALG, key, iv) as DecipherGCM;
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return plaintext.toString("utf8");
    } catch (err) {
      ultimoError = err;
    }
  }
  throw ultimoError;
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
 * Telemetría de fallos silenciosos de desencriptación (PR S3).
 *
 * Cada fallo de `tryDecrypt` es señal de corrupción de datos / key drift /
 * restore parcial — no un caso esperado. Debe quedar en Sentry, no sólo en
 * stdout. Pero `tryDecrypt` se usa en `.map()` sobre listados: sin throttle,
 * un solo restore corrupto dispara N eventos de Sentry por render de pantalla.
 *
 * Solución (espejo del throttle de blind-index-legacy-fallback en
 * `lib/db/pacientes.ts`): dedupe por `label` con una ventana de tiempo. Se
 * emite a lo sumo UN `captureMessage` por label por ventana; los fallos
 * intermedios se cuentan y viajan en el próximo evento (`suppressed`).
 *
 * NUNCA se envía ciphertext ni PHI a Sentry: el payload es un mensaje fijo, el
 * label del campo (arg 2, ej. "paciente.nombre" — nombre de columna, no valor)
 * y una razón categórica derivada de la clase de error. El `err.message` crudo
 * NO se adjunta (contiene sólo metadata de tamaño hoy, pero lo omitimos para
 * que ningún cambio futuro filtre bytes del ciphertext).
 */
const DECRYPT_TELEMETRY_WINDOW_MS = 5 * 60 * 1000; // 5 min por label

type DecryptTelemetryState = { lastSentAt: number; suppressed: number };
const decryptTelemetryByLabel = new Map<string, DecryptTelemetryState>();

/**
 * Clasifica el error de desencriptación en una razón categórica SIN PHI ni
 * detalle de bytes. Sólo distingue causas operativas (corto / auth-tag / otro)
 * para triaje en Sentry; nunca incluye el valor ni el ciphertext.
 */
function decryptFailureReason(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("demasiado corto")) return "too_short";
  // node:crypto GCM auth failure al llamar decipher.final() con tag/ct adulterado.
  if (/auth|tag|unable to authenticate|bad decrypt/i.test(msg)) return "auth_tag_mismatch";
  return "other";
}

/**
 * Decide si un fallo para `label` debe emitirse ahora o suprimirse por la
 * ventana de throttle. Actualiza el estado in-memory. Devuelve `null` si el
 * evento fue suprimido, o `{ suppressed }` (fallos ocultados desde el último
 * emitido) si corresponde emitir. Puro respecto de Sentry — no toca la red, así
 * que es testeable de forma determinística.
 */
function shouldReportDecryptFailure(label: string): { suppressed: number } | null {
  const now = Date.now();
  const prev = decryptTelemetryByLabel.get(label);
  if (prev && now - prev.lastSentAt < DECRYPT_TELEMETRY_WINDOW_MS) {
    prev.suppressed += 1;
    return null;
  }
  const suppressed = prev ? prev.suppressed : 0;
  decryptTelemetryByLabel.set(label, { lastSentAt: now, suppressed: 0 });
  return { suppressed };
}

/**
 * Emite (rate-limited por label) un `captureMessage` de warning a Sentry. Sólo
 * mensaje fijo + tag de campo + razón categórica: cero ciphertext, cero PHI.
 * Fire-and-forget + `.catch`: el capture nunca rompe al caller (y en unit tests
 * sin Sentry inicializado es un no-op silencioso). Devuelve `true` si emitió,
 * `false` si fue suprimido por la ventana (útil para tests).
 */
function reportDecryptFailure(label: string, reason: string): boolean {
  const decision = shouldReportDecryptFailure(label);
  if (!decision) return false;
  const { suppressed } = decision;
  void import("@sentry/nextjs")
    .then(({ captureMessage }) =>
      captureMessage("[crypto] silent decrypt failure", {
        level: "warning",
        tags: { component: "crypto", op: "tryDecrypt", field: label, reason },
        // Sólo metadata operativa. `suppressed` = fallos del mismo label
        // ocultados por el throttle desde el último evento emitido.
        extra: { field: label, reason, suppressed },
      }),
    )
    .catch(() => {});
  return true;
}

/**
 * Superficie SOLO para tests: expone el throttle y el clasificador de razón sin
 * disparar Sentry, más un reset del estado in-memory para empezar limpio. No se
 * usa en producción (el runtime pasa por `tryDecrypt` → `reportDecryptFailure`).
 */
export const __cryptoTelemetryTestHooks = {
  reset(): void {
    decryptTelemetryByLabel.clear();
  },
  /**
   * Olvida las keys cacheadas para que un cambio de `process.env` en el test
   * siguiente se vea. En producción nunca se llama: las keys no cambian sin
   * un redeploy, que arranca un proceso nuevo.
   */
  resetKeyCache(): void {
    keyCache.clear();
  },
  /** true si un fallo para `label` emitiría ahora; false si el throttle lo suprime. */
  wouldReport(label: string): boolean {
    return shouldReportDecryptFailure(label) !== null;
  },
  reason(err: unknown): string {
    return decryptFailureReason(err);
  },
  windowMs: DECRYPT_TELEMETRY_WINDOW_MS,
};

/**
 * Try-decrypt: igual que decryptColumn pero captura excepciones y devuelve
 * null en su lugar (loggeando warning con un label opcional + Sentry con tag,
 * rate-limited por label — ver `reportDecryptFailure`).
 * Útil cuando un solo ciphertext corrupto no debe romper toda la pantalla —
 * defensa operativa post key-rotation o restore parcial.
 *
 * Usar en paths de LISTADO / EXPORT (un .map() de filas no debe morir por una
 * fila corrupta). NO usar donde el fallo debe ser fatal o cambiar semántica
 * (ej. refresh token de Google: null ya significa "reconectar"; doc fiscal
 * de una factura AFIP: mejor abortar que emitir como Consumidor Final).
 */
export function tryDecrypt(
  value: string | Buffer | Uint8Array | null | undefined,
  label = "field",
): string | null {
  if (value === null || value === undefined) return null;
  try {
    return decryptColumn(value);
  } catch (err) {
    // NUNCA logueamos el ciphertext ni el valor: sólo el label del campo y la
    // razón categórica. `err.message` de decryptColumn/node:crypto no contiene
    // plaintext, pero lo omitimos del payload de Sentry por precaución.
    const reason = decryptFailureReason(err);
    console.warn(`[crypto] decrypt failed on ${label} (${reason})`);
    reportDecryptFailure(label, reason);
    return null;
  }
}

/**
 * TODOS los blind indexes posibles para un valor, en orden de preferencia
 * (primero el de la key de escritura).
 *
 * Un hash no se puede "probar y ver si abre" como un ciphertext: es una vía
 * de ida. Así que durante una rotación de la HMAC key, buscar por igualdad
 * exige consultar por los dos hashes a la vez — el de la key nueva, que ya
 * tienen las filas rehasheadas, y el de la vieja, que tienen las que faltan.
 *
 * Fuera de una rotación devuelve un solo elemento y el caller no paga nada.
 * Devuelve `[]` cuando el valor no es hasheable (null, vacío, teléfono corto).
 *
 * Uso típico:
 *   const hs = blindIndexCandidatos(query, orgId);
 *   query.in("nombre_hash", hs)          // en vez de .eq("nombre_hash", h)
 */
export function blindIndexCandidatos(
  plain: string | null | undefined,
  salt?: string,
): string[] {
  if (plain === null || plain === undefined) return [];
  const normalized = plain.trim().toLowerCase();
  if (normalized === "") return [];
  const input = salt ? `${salt}:${normalized}` : normalized;
  return dedupe(getHmacKeysRead().map((k) => createHmac("sha256", k).update(input, "utf8").digest("hex")));
}

/** Igual que `blindIndexCandidatos` pero con la normalización de teléfonos. */
export function blindIndexPhoneCandidatos(
  rawPhone: string | null | undefined,
  salt?: string,
): string[] {
  if (rawPhone === null || rawPhone === undefined) return [];
  const digits = rawPhone.replace(/\D/g, "");
  if (digits.length < 8) return [];
  const last10 = digits.slice(-10);
  const input = salt ? `${salt}:tel:${last10}` : `tel:${last10}`;
  return dedupe(getHmacKeysRead().map((k) => createHmac("sha256", k).update(input, "utf8").digest("hex")));
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
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
