import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createBackup, readBackupStatus } from "../../scripts/backup/core.mjs";
import { verifyBackup } from "../../scripts/backup/restore.mjs";
import { requireStorageMatch } from "../../scripts/backup/storage.mjs";
import { verifyEmptyPgsodiumKey } from "../../scripts/backup/source.mjs";
const keys = generateKeyPairSync("rsa", {
  modulusLength: 3072,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const object = {
  bucket: "private",
  name: "synthetic-record",
  id: "test-id",
  size: 11,
  etag: "test",
  updatedAt: "2026-09-08T00:00:00.000Z",
};
const platformConfig = {
  auth: { fixture: true },
  storage: { fixture: true },
  database: { fixture: true },
  application: { fixture: true },
  custody: { fixture: true },
};
function ports(fail) {
  return {
    source: {
      compareStorage: requireStorageMatch,
      async begin() {
        if (fail === "extension_not_empty") {
          await verifyEmptyPgsodiumKey({
            query: async () => ({
              rows: [
                {
                  rows: 1,
                  extension_configuration_table: true,
                  self_foreign_key: true,
                },
              ],
            }),
          });
        }
        return {
          metadata: {
            objects: [object],
            buckets: [{ id: "private" }],
            serverMajor: 16,
            pgDumpMajor: 16,
            roles: [],
            extensions: [],
          },
          database: async () => ({
            async *[Symbol.asyncIterator]() {
              yield Buffer.from("PRIVATE_DATABASE");
              if (fail === "db") throw new Error("failure including PHI");
            },
          }),
          roles: async () => [Buffer.from("synthetic roles")],
          verifyUnchanged: async () => {},
          close: async () => {},
        };
      },
    },
    storage: {
      inventory: async () => [object],
      download: async () => {
        if (fail === "storage") throw new Error("private-storage-error");
        return { stream: [Buffer.from("PRIVATEFILE")] };
      },
    },
  };
}
test("only a complete DB+Storage capture publishes success; failures preserve previous valid backup", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "folio-backup-pipeline-"));
  try {
    const first = await createBackup({
      destination: dir,
      publicKey: keys.publicKey,
      platformConfig,
      ...ports(),
    });
    const original = (await readBackupStatus(dir)).last;
    const manifest = await verifyBackup(
      path.join(dir, first.id),
      keys.privateKey,
    );
    assert.equal(manifest.artifacts.length, 4);
    for (const failure of ["db", "storage", "extension_not_empty"]) {
      await assert.rejects(
        createBackup({
          destination: dir,
          publicKey: keys.publicKey,
          platformConfig,
          ...ports(failure),
        }),
        /backup_failed_no_valid_snapshot_published/,
      );
      assert.deepEqual((await readBackupStatus(dir)).last, original);
    }
    assert.equal(
      (await readdir(dir)).filter((n) => n.startsWith("backup_")).length,
      1,
    );
    for (const name of await readdir(path.join(dir, first.id))) {
      const bytes = await readFile(path.join(dir, first.id, name));
      assert.ok(!bytes.includes(Buffer.from("PRIVATE_DATABASE")));
      assert.ok(!bytes.includes(Buffer.from("PRIVATEFILE")));
    }
    await rm(path.join(dir, first.id, "manifest.sealed"));
    assert.equal((await readBackupStatus(dir)).stale, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("restore guard refuses remote and unconfirmed targets before any connection", async () => {
  const { parseConnection } = await import("../../scripts/backup/postgres.mjs");
  assert.throws(() =>
    parseConnection(
      "postgres://user:password@db.grkpayhxndztlfwxobnt.supabase.co/postgres",
      { restore: true, confirmDatabase: "postgres" },
    ),
  );
  assert.throws(() =>
    parseConnection(
      "postgres://user:password@127.0.0.1:55439/folio_restore_fixture",
      { restore: true, confirmDatabase: "different" },
    ),
  );
  assert.equal(
    parseConnection(
      "postgres://user:password@127.0.0.1:55439/folio_restore_fixture",
      { restore: true, confirmDatabase: "folio_restore_fixture" },
    ).database,
    "folio_restore_fixture",
  );
});

test("overlapping backup cannot start another source snapshot or overwrite active lock", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "folio-backup-overlap-"));
  let unblock, entered;
  const entry = new Promise((resolve) => (entered = resolve)),
    waiting = new Promise((resolve) => (unblock = resolve));
  const firstPorts = ports();
  const begin = firstPorts.source.begin;
  firstPorts.source.begin = async () => {
    entered();
    await waiting;
    return begin();
  };
  try {
    const first = createBackup({
      destination: dir,
      publicKey: keys.publicKey,
      platformConfig,
      ...firstPorts,
    });
    await entry;
    const second = ports();
    let secondStarted = false;
    second.source.begin = async () => {
      secondStarted = true;
      return begin();
    };
    await assert.rejects(
      createBackup({
        destination: dir,
        publicKey: keys.publicKey,
        platformConfig,
        ...second,
      }),
    );
    assert.equal(secondStarted, false, "overlap began a source transaction");
    unblock();
    await first;
    assert.equal(
      (await readdir(dir)).filter((n) => n.startsWith("backup_")).length,
      1,
    );
  } finally {
    unblock();
    await rm(dir, { recursive: true, force: true });
  }
});
