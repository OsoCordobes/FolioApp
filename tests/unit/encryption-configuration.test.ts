import assert from "node:assert/strict";
import test from "node:test";
import { encryptionConfigurationStatus } from "../../lib/security/encryption-configuration";

const key = Buffer.alloc(32, 7).toString("base64");
const current = { FOLIO_ENC_KEY: key, FOLIO_ENC_HMAC_KEY: key };

test("boot and health reject missing HMAC and malformed optional rotation keys", () => {
  assert.deepEqual(encryptionConfigurationStatus(current), { ok: true, missing: [], invalid: [], rotation: { enc: false, hmac: false } });
  assert.deepEqual(encryptionConfigurationStatus({ FOLIO_ENC_KEY: key }).missing, ["FOLIO_ENC_HMAC_KEY"]);
  for (const name of ["FOLIO_ENC_KEY", "FOLIO_ENC_HMAC_KEY", "FOLIO_ENC_KEY_NEXT", "FOLIO_ENC_HMAC_KEY_NEXT"]) {
    for (const bad of ["short", Buffer.alloc(31).toString("base64"), `${key}!`, key.slice(0, 20) + "\n" + key.slice(20)]) {
      const status = encryptionConfigurationStatus({ ...current, [name]: bad });
      assert.equal(status.ok, false);
      assert.deepEqual(status.invalid, [name]);
      assert.ok(!JSON.stringify(status).includes(bad));
    }
  }
});

test("optional empty key is absent; outer whitespace is harmless; status exposes names only", () => {
  const status = encryptionConfigurationStatus({ ...current, FOLIO_ENC_KEY: ` ${key}\n`, FOLIO_ENC_KEY_NEXT: key, FOLIO_ENC_HMAC_KEY_NEXT: "  " });
  assert.equal(status.ok, true);
  assert.deepEqual(status.rotation, { enc: true, hmac: false });
  assert.ok(!JSON.stringify(status).includes(key));
});
