import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";

import { verifyMpSignature } from "../../lib/mercadopago/webhook-security";

// Helper: corre `fn` con env seteado y restaura al final.
function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    previous[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

const SECRET = "test-secret-abc123";
const DATA_ID = "preapproval-42";
const REQUEST_ID = "req-uuid-1";

// Construye un x-signature válido para el manifest que arma verifyMpSignature.
function signedHeader(tsSeconds: number, secret = SECRET): string {
  const manifest = `id:${DATA_ID};request-id:${REQUEST_ID};ts:${tsSeconds};`;
  const v1 = createHmac("sha256", secret).update(manifest).digest("hex");
  return `ts=${tsSeconds},v1=${v1}`;
}

test("verifyMpSignature: valid fresh signature → verified", () => {
  withEnv({ MP_WEBHOOK_SECRET: SECRET, NODE_ENV: "production" }, () => {
    const ts = Math.floor(Date.now() / 1000);
    const res = verifyMpSignature({
      signatureHeader: signedHeader(ts),
      requestIdHeader: REQUEST_ID,
      dataId: DATA_ID,
    });
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.mode, "verified");
  });
});

test("verifyMpSignature: forged v1 → mismatch", () => {
  withEnv({ MP_WEBHOOK_SECRET: SECRET, NODE_ENV: "production" }, () => {
    const ts = Math.floor(Date.now() / 1000);
    // firma generada con otro secret = forjada respecto al esperado.
    const forged = signedHeader(ts, "wrong-secret");
    const res = verifyMpSignature({
      signatureHeader: forged,
      requestIdHeader: REQUEST_ID,
      dataId: DATA_ID,
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, "mismatch");
  });
});

test("verifyMpSignature: stale ts (>5min) → stale, before HMAC compare", () => {
  withEnv({ MP_WEBHOOK_SECRET: SECRET, NODE_ENV: "production" }, () => {
    const staleTs = Math.floor(Date.now() / 1000) - 600; // 10 min atrás
    // Firma criptográficamente válida para ese ts, pero rancia.
    const res = verifyMpSignature({
      signatureHeader: signedHeader(staleTs),
      requestIdHeader: REQUEST_ID,
      dataId: DATA_ID,
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, "stale");
  });
});

test("verifyMpSignature: ts just inside 5min window → verified", () => {
  withEnv({ MP_WEBHOOK_SECRET: SECRET, NODE_ENV: "production" }, () => {
    const ts = Math.floor(Date.now() / 1000) - 290; // dentro de 300s
    const res = verifyMpSignature({
      signatureHeader: signedHeader(ts),
      requestIdHeader: REQUEST_ID,
      dataId: DATA_ID,
    });
    assert.equal(res.ok, true);
  });
});

test("verifyMpSignature: missing secret in production → server-misconfigured (fail-closed)", () => {
  withEnv({ MP_WEBHOOK_SECRET: undefined, NODE_ENV: "production", VERCEL_ENV: undefined }, () => {
    const res = verifyMpSignature({
      signatureHeader: signedHeader(Math.floor(Date.now() / 1000)),
      requestIdHeader: REQUEST_ID,
      dataId: DATA_ID,
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, "server-misconfigured");
  });
});

test("verifyMpSignature: missing secret in dev → skipped-dev", () => {
  withEnv({ MP_WEBHOOK_SECRET: undefined, NODE_ENV: "development", VERCEL_ENV: undefined }, () => {
    const res = verifyMpSignature({
      signatureHeader: null,
      requestIdHeader: null,
      dataId: null,
    });
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.mode, "skipped-dev");
  });
});

test("verifyMpSignature: missing headers with secret set → missing-header", () => {
  withEnv({ MP_WEBHOOK_SECRET: SECRET }, () => {
    const res = verifyMpSignature({
      signatureHeader: null,
      requestIdHeader: REQUEST_ID,
      dataId: DATA_ID,
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, "missing-header");
  });
});
