/**
 * Folio · tests del token HMAC de confirmación 1-click (F7b · M90).
 *
 * Cargamos .env.local ANTES de importar el módulo (mismo patrón que
 * crypto-roundtrip.test.ts). Si la key no está (CI sin secrets), seteamos una
 * key de test determinística — el módulo solo exige 32 bytes base64.
 */
import { readFileSync } from "node:fs";

if (!process.env.FOLIO_ENC_HMAC_KEY) {
  try {
    const raw = readFileSync(".env.local", "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^([A-Z_]+)="?([^"\r\n]+)"?$/.exec(line.trim());
      if (!m) continue;
      const [, k, v] = m;
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    // .env.local ausente — cae al fallback de abajo.
  }
}
if (!process.env.FOLIO_ENC_HMAC_KEY) {
  // 32 bytes deterministas para CI (el módulo solo valida largo, no origen).
  process.env.FOLIO_ENC_HMAC_KEY = Buffer.alloc(32, 7).toString("base64");
}

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  buildConfirmToken,
  verifyConfirmToken,
} from "../../lib/booking/confirm-token";

const TURNO_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const FUTURO = Date.now() + 24 * 60 * 60 * 1000;

/** Réplica del formato v1 (documentado como ESTABLE en el módulo) para poder
 *  firmar payloads adversariales con la key real. */
function signLocal(payload: string): string {
  const key = Buffer.from(process.env.FOLIO_ENC_HMAC_KEY!, "base64");
  return createHmac("sha256", key)
    .update(`folio:confirm-turno:v1:${payload}`, "utf8")
    .digest("base64url");
}

function craftToken(payload: string): string {
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${signLocal(payload)}`;
}

// ─── Roundtrip feliz ────────────────────────────────────────────────────────

test("roundtrip: confirmar → ok con mismo turnoId y accion", () => {
  const token = buildConfirmToken({ turnoId: TURNO_ID, accion: "confirmar", expMs: FUTURO });
  const v = verifyConfirmToken(token);
  assert.deepEqual(v, { ok: true, turnoId: TURNO_ID, accion: "confirmar" });
});

test("roundtrip: cancelar → ok con mismo turnoId y accion", () => {
  const token = buildConfirmToken({ turnoId: TURNO_ID, accion: "cancelar", expMs: FUTURO });
  const v = verifyConfirmToken(token);
  assert.deepEqual(v, { ok: true, turnoId: TURNO_ID, accion: "cancelar" });
});

test("el token es URL-safe (base64url + un punto, sin +/=)", () => {
  const token = buildConfirmToken({ turnoId: TURNO_ID, accion: "confirmar", expMs: FUTURO });
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  // Apto para path segment sin encoding adicional.
  assert.equal(encodeURIComponent(token), token);
});

test("turnoId uppercase se normaliza a lowercase en la verificación", () => {
  const token = buildConfirmToken({
    turnoId: TURNO_ID.toUpperCase(),
    accion: "confirmar",
    expMs: FUTURO,
  });
  const v = verifyConfirmToken(token);
  assert.ok(v.ok);
  assert.equal(v.ok && v.turnoId, TURNO_ID);
});

// ─── Expiración ─────────────────────────────────────────────────────────────

test("exp vencida → reason 'expirado'", () => {
  const token = buildConfirmToken({ turnoId: TURNO_ID, accion: "confirmar", expMs: 1000 });
  assert.deepEqual(verifyConfirmToken(token), { ok: false, reason: "expirado" });
});

test("borde: nowMs === expMs (inicio del turno) → expirado", () => {
  const exp = 1_700_000_000_000;
  const token = buildConfirmToken({ turnoId: TURNO_ID, accion: "confirmar", expMs: exp });
  assert.deepEqual(verifyConfirmToken(token, exp), { ok: false, reason: "expirado" });
});

test("borde: nowMs = expMs - 1 → todavía válido", () => {
  const exp = 1_700_000_000_000;
  const token = buildConfirmToken({ turnoId: TURNO_ID, accion: "cancelar", expMs: exp });
  const v = verifyConfirmToken(token, exp - 1);
  assert.ok(v.ok);
});

// ─── Firma / adulteración ───────────────────────────────────────────────────

test("firma alterada (último char de la sig flipeado) → invalido", () => {
  const token = buildConfirmToken({ turnoId: TURNO_ID, accion: "confirmar", expMs: FUTURO });
  const last = token[token.length - 1];
  const flipped = token.slice(0, -1) + (last === "A" ? "B" : "A");
  assert.deepEqual(verifyConfirmToken(flipped), { ok: false, reason: "invalido" });
});

test("payload adulterado (confirmar→cancelar) con la sig original → invalido", () => {
  const token = buildConfirmToken({ turnoId: TURNO_ID, accion: "confirmar", expMs: FUTURO });
  const [data64, sig64] = token.split(".");
  const payload = Buffer.from(data64, "base64url").toString("utf8");
  const tampered = Buffer.from(payload.replace(".confirmar.", ".cancelar."), "utf8").toString("base64url");
  assert.deepEqual(verifyConfirmToken(`${tampered}.${sig64}`), { ok: false, reason: "invalido" });
});

test("exp adulterada (extender vigencia) con la sig original → invalido", () => {
  const exp = 1000; // ya vencido
  const token = buildConfirmToken({ turnoId: TURNO_ID, accion: "confirmar", expMs: exp });
  const [data64, sig64] = token.split(".");
  const payload = Buffer.from(data64, "base64url").toString("utf8");
  const extendido = Buffer.from(payload.replace(`.${exp}`, `.${FUTURO}`), "utf8").toString("base64url");
  // Sin la adulteración sería "expirado"; adulterado tiene que ser "invalido".
  assert.deepEqual(verifyConfirmToken(`${extendido}.${sig64}`), { ok: false, reason: "invalido" });
});

test("sig truncada a la mitad → invalido, sin throw (compare timing-safe)", () => {
  const token = buildConfirmToken({ turnoId: TURNO_ID, accion: "confirmar", expMs: FUTURO });
  const [data64, sig64] = token.split(".");
  assert.deepEqual(
    verifyConfirmToken(`${data64}.${sig64.slice(0, Math.floor(sig64.length / 2))}`),
    { ok: false, reason: "invalido" },
  );
});

// ─── Payloads firmados con contenido inválido ───────────────────────────────

test("acción desconocida FIRMADA con la key real → invalido", () => {
  const token = craftToken(`${TURNO_ID}.borrar.${FUTURO}`);
  assert.deepEqual(verifyConfirmToken(token), { ok: false, reason: "invalido" });
});

test("turnoId no-UUID firmado → invalido", () => {
  const token = craftToken(`no-soy-un-uuid.confirmar.${FUTURO}`);
  assert.deepEqual(verifyConfirmToken(token), { ok: false, reason: "invalido" });
});

test("exp no numérica firmada → invalido", () => {
  const token = craftToken(`${TURNO_ID}.confirmar.abc`);
  assert.deepEqual(verifyConfirmToken(token), { ok: false, reason: "invalido" });
});

test("payload con partes de más firmado → invalido", () => {
  const token = craftToken(`${TURNO_ID}.confirmar.${FUTURO}.extra`);
  assert.deepEqual(verifyConfirmToken(token), { ok: false, reason: "invalido" });
});

// ─── Input hostil / malformado: nunca lanza ─────────────────────────────────

test("inputs malformados → invalido sin throw", () => {
  const casos = [
    "",
    ".",
    "..",
    "abc",
    "a.b.c",
    ".soloSig",
    "soloData.",
    "$$$.$$$",
    "áéí.óúñ",
    `${"A".repeat(300)}.${"B".repeat(300)}`, // supera MAX_TOKEN_LEN
    Buffer.from("basura", "utf8").toString("base64url"), // sin punto
  ];
  for (const c of casos) {
    assert.deepEqual(verifyConfirmToken(c), { ok: false, reason: "invalido" }, `caso: ${JSON.stringify(c)}`);
  }
});

// ─── Validación del builder (errores de programación) ───────────────────────

test("buildConfirmToken lanza con turnoId no-UUID", () => {
  assert.throws(() => buildConfirmToken({ turnoId: "nope", accion: "confirmar", expMs: FUTURO }));
});

test("buildConfirmToken lanza con acción desconocida", () => {
  assert.throws(() =>
    buildConfirmToken({
      turnoId: TURNO_ID,
      // @ts-expect-error — se testea el guard runtime
      accion: "borrar",
      expMs: FUTURO,
    }),
  );
});

test("buildConfirmToken lanza con expMs inválido (0, negativo, float, NaN)", () => {
  for (const expMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => buildConfirmToken({ turnoId: TURNO_ID, accion: "confirmar", expMs }),
      /expMs/,
      `expMs: ${expMs}`,
    );
  }
});
