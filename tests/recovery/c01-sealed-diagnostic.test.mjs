import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { recipientFingerprint, openArtifact } from "../../scripts/backup/envelope.mjs";
import { c01DiagnosticContext, sealBoundedDiagnostic, captureC01PgRestoreFailure } from "../../scripts/backup/c01-sealed-diagnostic.mjs";

const safeEnv = {
  CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted",
  RUNNER_OS: "Linux", FOLIO_C01_SEAL_PG_RESTORE_ERROR: "1",
  C01_CHECKED_OUT_SHA: "a".repeat(40), GITHUB_RUN_ID: "123456",
  GITHUB_RUN_ATTEMPT: "2", RUNNER_TEMP: path.resolve(os.tmpdir()),
};

test("C01 diagnostic activates only for the exact hosted Linux opt-in and checked out SHA", async () => {
  const context = c01DiagnosticContext(safeEnv);
  if (process.platform === "linux")
    assert.deepEqual(context, { checkedOutSha: "a".repeat(40), runId: "123456", runAttempt: "2", stage: "pg_restore" });
  else assert.equal(context, null);
  for (const [key, value] of Object.entries({
    CI: "false", GITHUB_ACTIONS: "false", RUNNER_ENVIRONMENT: "self-hosted",
    RUNNER_OS: "Windows", FOLIO_C01_SEAL_PG_RESTORE_ERROR: "0",
    C01_CHECKED_OUT_SHA: "not-a-sha", GITHUB_RUN_ID: "x", GITHUB_RUN_ATTEMPT: "0",
    RUNNER_TEMP: "relative",
  })) assert.equal(c01DiagnosticContext({ ...safeEnv, [key]: value }), null, key);
  assert.equal(await captureC01PgRestoreFailure(Buffer.from("sensitive"), { stage: "tool_version", exitCode: 1 }, safeEnv), false);
  assert.equal(await captureC01PgRestoreFailure(Buffer.alloc(0), { stage: null, exitCode: 1 }, safeEnv), false);
});

test("pinned C01 recipient is a dedicated public key with the reviewed fingerprint", async () => {
  const pem = await readFile(new URL("../../scripts/recovery/c01-diagnostic-public.pem", import.meta.url), "utf8");
  assert.equal(recipientFingerprint(pem), "609ccec0c317088256a01f259c11e333823318759a0b7ca54123211c3c080230");
  assert.equal(pem.includes("PRIVATE KEY"), false);
});

test("bounded synthetic stderr is encrypted, context-bound, and rejects tampering", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "folio-c01-diag-"));
  const file = path.join(dir, "c01-pg-restore-error.sealed");
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 3072,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const context = { checkedOutSha: "a".repeat(40), runId: "123456", runAttempt: "2", stage: "pg_restore" };
  const secret = "postgresql://postgres:synthetic-secret/clinical-ciphertext";
  const stderr = Buffer.from(secret + "X".repeat(70000));
  try {
    const result = await sealBoundedDiagnostic(stderr, file, keys.publicKey, context);
    assert.equal(result.bytes, 65536);
    const sealed = await readFile(file);
    assert.equal(sealed.includes(Buffer.from(secret)), false);
    assert.equal((await stat(file)).size, result.encryptedBytes);
    const plain = await openArtifact(file, keys.privateKey, context, { maxBytes: 65536 });
    assert.deepEqual(plain, stderr.subarray(0, 65536));
    plain.fill(0);
    await assert.rejects(openArtifact(file, keys.privateKey, { ...context, checkedOutSha: "b".repeat(40) }, { maxBytes: 65536 }));
    sealed[sealed.length - 20] ^= 1;
    await writeFile(file, sealed);
    await assert.rejects(openArtifact(file, keys.privateKey, context, { maxBytes: 65536 }));
  } finally {
    stderr.fill(0);
    await rm(dir, { recursive: true, force: true });
  }
});

test("exclusive sealing preserves an existing artifact on EEXIST", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "folio-c01-existing-"));
  const file = path.join(dir, "c01-pg-restore-error.sealed");
  const existing = Buffer.from("preexisting synthetic evidence");
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 3072,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  try {
    await writeFile(file, existing, { flag: "wx" });
    await assert.rejects(sealBoundedDiagnostic(Buffer.from("new sensitive stderr"), file, keys.publicKey,
      { checkedOutSha: "a".repeat(40), runId: "123456", runAttempt: "2", stage: "pg_restore" }),
      { code: "EEXIST" });
    assert.deepEqual(await readFile(file), existing);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
