import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { sealArtifact, openArtifact } from "../../scripts/backup/envelope.mjs";
const keys = generateKeyPairSync("rsa", {
  modulusLength: 3072,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
test("encrypted artifact authenticates full payload and rejects corruption,truncation,wrong context before returning plaintext", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "folio-backup-crypto-"));
  const file = path.join(dir, "encrypted");
  const context = { backupId: "synthetic", artifact: "database" };
  try {
    await sealArtifact(
      [Buffer.from("synthetic private record")],
      file,
      keys.publicKey,
      context,
    );
    assert.ok(
      !(await readFile(file)).includes(Buffer.from("synthetic private record")),
    );
    assert.equal(
      (await openArtifact(file, keys.privateKey, context)).toString(),
      "synthetic private record",
    );
    await assert.rejects(
      openArtifact(file, keys.privateKey, { ...context, artifact: "other" }),
    );
    const original = await readFile(file);
    await writeFile(file, original.subarray(0, -1));
    await assert.rejects(openArtifact(file, keys.privateKey, context));
    const corrupt = Buffer.from(original);
    corrupt[corrupt.length - 20] ^= 1;
    await writeFile(file, corrupt);
    await assert.rejects(openArtifact(file, keys.privateKey, context));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
