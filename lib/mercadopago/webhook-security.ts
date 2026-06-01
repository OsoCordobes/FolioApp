/**
 * Folio · Mercado Pago webhook · validación de firma x-signature.
 *
 * MP firma cada POST al webhook con HMAC-SHA256 sobre una "manifest string"
 * construida desde los headers + body.
 *
 * Headers que llegan:
 *   - x-signature:  "ts=1704908010,v1=<hash_hex>"
 *   - x-request-id: <uuid>
 *
 * Manifest string (separadores exactos, incluyendo `;` final):
 *   id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 *
 * Algoritmo:
 *   HMAC-SHA256(MP_WEBHOOK_SECRET, manifest) en hex → comparar contra v1.
 *
 * Si MP_WEBHOOK_SECRET no está seteado (dev sin MP setup), aceptamos pero
 * logueamos warn. En producción sin secret → 503 (forzamos el alert).
 *
 * Docs:
 *   https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export type MpSignatureCheckResult =
  | { ok: true; mode: "verified" | "skipped-dev" }
  | {
      ok: false;
      reason: "missing-header" | "invalid-format" | "stale" | "mismatch" | "server-misconfigured";
    };

export interface MpSignatureInput {
  signatureHeader: string | null;   // valor de x-signature
  requestIdHeader: string | null;   // valor de x-request-id
  dataId: string | null;            // payload.data.id
}

/** Tolerancia de frescura del `ts` firmado (segundos). MP firma con epoch en segundos. */
const SIGNATURE_MAX_SKEW_SECONDS = 300; // 5 min

/**
 * Fail-closed en producción. MP_WEBHOOK_SECRET ausente debe bloquear tanto en
 * Vercel production como en cualquier entorno con NODE_ENV=production (self-host,
 * preview promovido, etc.). Ver L-BILL.
 */
function isProductionEnv(): boolean {
  return process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
}

export function verifyMpSignature(input: MpSignatureInput): MpSignatureCheckResult {
  const secret = process.env.MP_WEBHOOK_SECRET;

  if (!secret) {
    if (isProductionEnv()) {
      console.error("[mp] MP_WEBHOOK_SECRET no seteado en producción. Bloqueando webhook.");
      return { ok: false, reason: "server-misconfigured" };
    }
    console.warn("[mp] MP_WEBHOOK_SECRET no seteado (dev mode); webhook aceptado sin verificar firma.");
    return { ok: true, mode: "skipped-dev" };
  }

  if (!input.signatureHeader || !input.requestIdHeader || !input.dataId) {
    return { ok: false, reason: "missing-header" };
  }

  const parsed = parseSignatureHeader(input.signatureHeader);
  if (!parsed) return { ok: false, reason: "invalid-format" };

  // CR-2 (replay): el `ts` está dentro del manifest firmado, pero su VALOR nunca
  // se comparaba con el reloj. Rechazamos firmas viejas ANTES del HMAC compare
  // para que un POST capturado no pueda reproducirse pasados 5 min.
  const tsSeconds = Number(parsed.ts);
  const nowSeconds = Date.now() / 1000;
  if (Math.abs(nowSeconds - tsSeconds) > SIGNATURE_MAX_SKEW_SECONDS) {
    return { ok: false, reason: "stale" };
  }

  const manifest = `id:${input.dataId};request-id:${input.requestIdHeader};ts:${parsed.ts};`;
  const computed = createHmac("sha256", secret).update(manifest).digest();
  const expected = Buffer.from(parsed.v1, "hex");

  if (expected.length === 0) return { ok: false, reason: "invalid-format" };
  if (computed.length !== expected.length) return { ok: false, reason: "mismatch" };
  if (!timingSafeEqual(computed, expected)) return { ok: false, reason: "mismatch" };

  return { ok: true, mode: "verified" };
}

/**
 * Parsea el header x-signature de MP: "ts=1704908010,v1=abc123".
 * Tolera espacios y orden distinto. Devuelve null si falta algo o formato inválido.
 */
function parseSignatureHeader(value: string): { ts: string; v1: string } | null {
  const parts = value.split(",").map((p) => p.trim());
  const map: Record<string, string> = {};
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key && val) map[key] = val;
  }
  const ts = map.ts;
  const v1 = map.v1;
  if (!ts || !v1) return null;
  if (!/^\d+$/.test(ts)) return null;
  if (!/^[0-9a-f]+$/i.test(v1)) return null;
  return { ts, v1 };
}
