import {
  mkdir,
  readFile,
  readdir,
  rename,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { acquireBackupLock } from "./lock.mjs";
import { sealArtifact, fileDigest, recipientFingerprint } from "./envelope.mjs";
import {
  writeAtomicJson,
  rotateBackups,
  backupStatus,
  validateReceipt,
} from "./retention.mjs";
/** Ports are real streamed producers; tests replace external I/O with synthetic fixtures. */
export async function createBackup({
  destination,
  publicKey,
  platformConfig,
  source,
  storage,
  now = new Date(),
  rotate = true,
}) {
  if (!path.isAbsolute(destination))
    throw new Error("backup_destination_absolute_required");
  for (const section of [
    "auth",
    "storage",
    "database",
    "application",
    "custody",
  ])
    if (!platformConfig?.[section])
      throw new Error("backup_platform_configuration_incomplete");
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const lock = await acquireBackupLock(destination);
  const id = `backup_${now.toISOString().replace(/[^0-9TZ]/g, "")}_${randomUUID()}`;
  const partial = path.join(destination, `.incomplete_${id}`);
  const final = path.join(destination, id);
  let snapshot;
  let backupStage = "snapshot";
  try {
    await mkdir(partial, { mode: 0o700 });
    snapshot = await source.begin();
    const manifest = {
      version: 1,
      id,
      startedAt: now.toISOString(),
      recipient: recipientFingerprint(publicKey),
      source: snapshot.metadata,
      recovery: {
        kind: "postgres-logical-plus-storage",
        storageConsistency:
          "database-snapshot-with-stable-storage-verification",
        roles: "captured-not-automatically-replayed",
        authLoginVerified: false,
      },
      artifacts: [],
    };
    const add = async (kind, stream, metadata = {}) => {
      const file = `artifact_${manifest.artifacts.length}.sealed`;
      const integrity = await sealArtifact(
        stream,
        path.join(partial, file),
        publicKey,
        { backupId: id, artifact: file },
      );
      manifest.artifacts.push({ kind, file, ...metadata, ...integrity });
    };
    backupStage = "configuration";
    await add("platform-config", [Buffer.from(JSON.stringify(platformConfig))]);
    backupStage = "database";
    await add("postgres-database", await snapshot.database());
    backupStage = "roles";
    await add("postgres-roles-no-passwords", await snapshot.roles());
    backupStage = "storage";
    const expected = snapshot.metadata.objects;
    const before = await storage.inventory(snapshot.metadata.buckets);
    source.compareStorage(expected, before);
    for (const object of expected) {
      const downloaded = await storage.download(object);
      await add("storage-object", downloaded.stream, { object });
    }
    const after = await storage.inventory(snapshot.metadata.buckets);
    source.compareStorage(expected, after);
    backupStage = "consistency";
    await snapshot.verifyUnchanged();
    await snapshot.close();
    snapshot = null;
    backupStage = "publish";
    manifest.completedAt = new Date().toISOString();
    await sealArtifact(
      [Buffer.from(JSON.stringify(manifest))],
      path.join(partial, "manifest.sealed"),
      publicKey,
      { backupId: id, artifact: "manifest.sealed" },
    );
    const files = [];
    for (const file of await readdir(partial)) {
      files.push({ file, sha256: await fileDigest(path.join(partial, file)) });
    }
    const receipt = {
      version: 1,
      id,
      complete: true,
      startedAt: manifest.startedAt,
      completedAt: manifest.completedAt,
      files,
    };
    await writeAtomicJson(path.join(partial, "receipt.json"), receipt);
    await rename(partial, final);
    let indexUpdated = true,
      retention = null;
    try {
      await writeAtomicJson(path.join(destination, "last-success.json"), {
        version: 1,
        id,
        completedAt: receipt.completedAt,
      });
    } catch {
      indexUpdated = false;
    }
    if (rotate && indexUpdated) {
      try {
        retention = await rotateBackups(destination);
      } catch {
        retention = { error: "retention_failed_copies_preserved" };
      }
    }
    return {
      id,
      complete: true,
      indexUpdated,
      artifacts: manifest.artifacts.length,
      storageObjects: expected.length,
      retention,
    };
  } catch (error) {
    const failure = new Error("backup_failed_no_valid_snapshot_published");
    failure.backupStage = backupStage;
    failure.category = [
      "permission_denied",
      "tls_certificate",
      "authentication_failed",
      "snapshot_unavailable",
      "timeout",
      "dns_failed",
      "connection_failed",
      "tool_failure_or_warning",
      "circular_foreign_keys",
      "collation_version_mismatch",
      "privilege_warning",
      "tool_unavailable",
      "diagnostic_capture_failed",
    ].includes(error?.category)
      ? error.category
      : "unspecified";
    throw failure;
  } finally {
    await snapshot?.close().catch(() => undefined);
    await lock.release();
  }
}
export async function readBackupStatus(destination, now = new Date()) {
  let last = null;
  try {
    const value = JSON.parse(
      await readFile(path.join(destination, "last-success.json"), "utf8"),
    );
    if (!/^backup_[a-zA-Z0-9_-]+$/.test(value.id)) throw new Error();
    const receipt = await validateReceipt(path.join(destination, value.id));
    last = { version: 1, id: receipt.id, completedAt: receipt.completedAt };
  } catch {}
  return { last, ...backupStatus(last, now) };
}
