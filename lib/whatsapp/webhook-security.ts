/**
 * Folio · WhatsApp webhook · validación de firma X-Hub-Signature-256.
 *
 * Meta firma cada POST al webhook con HMAC-SHA256 del body usando el
 * `META_APP_SECRET` que se setea al crear la Meta App. El header viene en
 * formato `sha256=<hex>`.
 *
 * Si la env var no está seteada (modo dev local sin Meta setup todavía),
 * la validación falla en `warn-and-accept` para no bloquear el desarrollo.
 * En producción la env var DEBE estar seteada — si no, devolvemos 503
 * para que Meta reintente y un alert salte.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export type SignatureCheckResult =
  | { ok: true; mode: "verified" | "skipped-dev" }
  | { ok: false; reason: "missing-header" | "invalid-format" | "mismatch" | "server-misconfigured" };

export function verifyMetaSignature(headerValue: string | null, rawBody: string | Buffer): SignatureCheckResult {
  const appSecret = process.env.META_APP_SECRET;

  // Modo dev: sin secret, aceptamos pero logueamos. Producción debería
  // siempre tener META_APP_SECRET seteado.
  if (!appSecret) {
    if (process.env.VERCEL_ENV === "production") {
      console.error("[whatsapp] META_APP_SECRET no seteado en producción. Bloqueando webhook.");
      return { ok: false, reason: "server-misconfigured" };
    }
    console.warn("[whatsapp] META_APP_SECRET no seteado (dev mode); webhook aceptado sin verificar firma.");
    return { ok: true, mode: "skipped-dev" };
  }

  if (!headerValue) return { ok: false, reason: "missing-header" };
  if (!headerValue.startsWith("sha256=")) return { ok: false, reason: "invalid-format" };

  const expectedHex = headerValue.slice("sha256=".length);
  if (!/^[0-9a-f]+$/i.test(expectedHex)) return { ok: false, reason: "invalid-format" };

  const computed = createHmac("sha256", appSecret)
    .update(typeof rawBody === "string" ? Buffer.from(rawBody) : rawBody)
    .digest();
  const expected = Buffer.from(expectedHex, "hex");

  if (computed.length !== expected.length) return { ok: false, reason: "mismatch" };
  if (!timingSafeEqual(computed, expected)) return { ok: false, reason: "mismatch" };

  return { ok: true, mode: "verified" };
}
