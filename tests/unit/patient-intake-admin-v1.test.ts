import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { __cryptoTelemetryTestHooks, decryptColumn, encryptColumn } from "../../lib/crypto";
import {
  ADMIN_VERSION, canonicalAdminV1, contributionFingerprint,
  newInvitationFingerprintKeyCipher, prepareAdminContribution, tokenHash,
} from "../../lib/patient-intake/admin-v1";

const invitation = "11111111-1111-4111-8111-111111111111";
const operation = "22222222-2222-4222-8222-222222222222";

test("admin.v1 canonicalizes NFC and fixed order without treating omission as no", () => {
  const first = canonicalAdminV1({ cobertura: { plan: " Plan A " }, apellido: "Pe\u0301rez", nombre: " Ana " }, "2026-09-25");
  const second = canonicalAdminV1({ nombre: "Ana", apellido: "Pérez", cobertura: { plan: "Plan A" } }, "2026-09-25");
  assert.equal(first, second);
  assert.equal(first, '{"nombre":"Ana","apellido":"Pérez","cobertura":{"plan":"Plan A"}}');
  assert.equal(ADMIN_VERSION, "admin.v1");
});

test("admin.v1 rejects clinical fields, empty answers, null and impossible/future dates", () => {
  for (const value of [{ motivo: "dolor" }, {}, { nombre: null }, { fechaNacimiento: "2026-02-29" },
    { fechaNacimiento: "2026-09-26" }, { cobertura: {} }, { telefono: "---" }]) {
    assert.throws(() => canonicalAdminV1(value, "2026-09-25"));
  }
  assert.equal(canonicalAdminV1({ fechaNacimiento: "2000-02-29" }, "2026-09-25"),
    '{"fechaNacimiento":"2000-02-29"}');
});

test("randomized encryption and stable invitation HMAC survive old, NEXT and promoted keys", () => {
  const names = ["FOLIO_ENC_KEY", "FOLIO_ENC_KEY_NEXT", "FOLIO_ENC_HMAC_KEY", "FOLIO_ENC_HMAC_KEY_NEXT"] as const;
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const oldEnc = randomBytes(32).toString("base64");
  const newEnc = randomBytes(32).toString("base64");
  const oldHmac = randomBytes(32).toString("base64");
  const newHmac = randomBytes(32).toString("base64");
  try {
    process.env.FOLIO_ENC_KEY = oldEnc;
    process.env.FOLIO_ENC_HMAC_KEY = oldHmac;
    delete process.env.FOLIO_ENC_KEY_NEXT;
    delete process.env.FOLIO_ENC_HMAC_KEY_NEXT;
    __cryptoTelemetryTestHooks.resetKeyCache();
    const canonical = canonicalAdminV1({ nombre: "Ana" }, "2026-09-25");
    const keyCipher = newInvitationFingerprintKeyCipher();
    const a = prepareAdminContribution({ nombre: "Ana" }, keyCipher, invitation, operation);
    const b = prepareAdminContribution({ nombre: "Ana" }, keyCipher, invitation, operation);
    assert.notEqual(a.answersCipher, b.answersCipher);
    assert.equal(decryptColumn(a.answersCipher), canonical);
    assert.equal(a.fingerprint, b.fingerprint);
    const fingerprint = contributionFingerprint(keyCipher, invitation, operation, canonical);
    assert.equal(fingerprint, contributionFingerprint(keyCipher, invitation, operation, canonical));
    assert.notEqual(fingerprint, contributionFingerprint(keyCipher, invitation, operation,
      canonicalAdminV1({ nombre: "Bea" }, "2026-09-25")));
    assert.notEqual(fingerprint, contributionFingerprint(keyCipher, invitation,
      "33333333-3333-4333-8333-333333333333", canonical));
    process.env.FOLIO_ENC_KEY_NEXT = newEnc;
    process.env.FOLIO_ENC_HMAC_KEY_NEXT = newHmac;
    __cryptoTelemetryTestHooks.resetKeyCache();
    assert.equal(fingerprint, contributionFingerprint(keyCipher, invitation, operation, canonical));
    const reencryptedKey = encryptColumn(decryptColumn(keyCipher));
    assert.notEqual(reencryptedKey, keyCipher);
    assert.equal(fingerprint, contributionFingerprint(reencryptedKey!, invitation, operation, canonical));
    process.env.FOLIO_ENC_KEY = newEnc;
    process.env.FOLIO_ENC_HMAC_KEY = newHmac;
    delete process.env.FOLIO_ENC_KEY_NEXT;
    delete process.env.FOLIO_ENC_HMAC_KEY_NEXT;
    __cryptoTelemetryTestHooks.resetKeyCache();
    assert.equal(fingerprint, contributionFingerprint(reencryptedKey!, invitation, operation, canonical));
    assert.throws(() => contributionFingerprint(keyCipher, invitation, operation, canonical));
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    __cryptoTelemetryTestHooks.resetKeyCache();
  }
  assert.equal(tokenHash("ab".repeat(32)).length, 64);
});
