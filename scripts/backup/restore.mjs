import path from "node:path";
import { createHash } from "node:crypto";
import { openArtifact, MAX_RESTORE_BYTES } from "./envelope.mjs";
import { validateReceipt } from "./retention.mjs";
import {
  parseConnection,
  pgConnection,
  pgProcess,
  assertEmptyRestoreTarget,
  toolVersion,
  closePgClient,
} from "./postgres.mjs";
export async function verifyBackup(
  directory,
  privateKey,
  { passphrase, maxBytes = MAX_RESTORE_BYTES } = {},
) {
  const receipt = await validateReceipt(directory);
  const manifestBuffer = await openArtifact(
    path.join(directory, "manifest.sealed"),
    privateKey,
    { backupId: receipt.id, artifact: "manifest.sealed" },
    { passphrase, maxBytes },
  );
  let manifest;
  try {
    manifest = JSON.parse(manifestBuffer.toString("utf8"));
  } finally {
    manifestBuffer.fill(0);
  }
  if (
    manifest.id !== receipt.id ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.artifacts)
  )
    throw new Error("backup_manifest_invalid");
  const expected = new Set([
    "manifest.sealed",
    ...manifest.artifacts.map((a) => a.file),
  ]);
  if (
    expected.size !== receipt.files.length ||
    receipt.files.some((f) => !expected.has(f.file))
  )
    throw new Error("backup_artifacts_mismatch");
  for (const artifact of manifest.artifacts) {
    if (!/^artifact_\d+\.sealed$/.test(artifact.file))
      throw new Error("backup_artifact_path_invalid");
    const body = await openArtifact(
      path.join(directory, artifact.file),
      privateKey,
      { backupId: receipt.id, artifact: artifact.file },
      { passphrase, maxBytes },
    );
    try {
      if (
        body.length !== artifact.bytes ||
        createHash("sha256").update(body).digest("hex") !== artifact.sha256
      )
        throw new Error("backup_manifest_integrity_failed");
    } finally {
      body.fill(0);
    }
  }
  return manifest;
}
/** Local rehearsal only. Global roles are inspected, never executed/altered. */
export async function restoreDatabase({
  directory,
  privateKey,
  passphrase,
  databaseUrl,
  confirmDatabase,
  tools = {},
  maxBytes = MAX_RESTORE_BYTES,
}) {
  const connection = parseConnection(databaseUrl, {
    restore: true,
    confirmDatabase,
  });
  const manifest = await verifyBackup(directory, privateKey, {
    passphrase,
    maxBytes,
  });
  const client = pgConnection(connection);
  await client.connect();
  try {
    await assertEmptyRestoreTarget(client);
    const {
      rows: [version],
    } = await client.query("show server_version_num");
    const serverMajor = Math.floor(Number(version.server_version_num) / 10000);
    const restoreMajor = await toolVersion("pg_restore", tools);
    if (
      serverMajor < manifest.source.serverMajor ||
      restoreMajor !== manifest.source.pgDumpMajor
    )
      throw new Error("restore_postgres_version_incompatible");
    const available = (
      await client.query("select name from pg_available_extensions")
    ).rows.map((x) => x.name);
    if (manifest.source.extensions.some((e) => !available.includes(e.name)))
      throw new Error("restore_managed_extensions_missing");
    const roles = new Set(
      (await client.query("select rolname from pg_roles")).rows.map(
        (x) => x.rolname,
      ),
    );
    if (manifest.source.roles.some((r) => !roles.has(r.rolname)))
      throw new Error(
        "restore_requires_prepared_roles_no_global_changes_permitted",
      );
    // Advisory lock serializes these restore tools; an operator must keep this
    // NEW dedicated target unavailable to other writers during the rehearsal.
    const {
      rows: [lock],
    } = await client.query(
      "select pg_try_advisory_lock(hashtext('folio_restore')) as locked",
    );
    if (!lock.locked) throw new Error("restore_overlap");
    await assertEmptyRestoreTarget(client);
    const artifact = manifest.artifacts.find(
      (a) => a.kind === "postgres-database",
    );
    if (!artifact) throw new Error("database_archive_missing");
    const body = await openArtifact(
      path.join(directory, artifact.file),
      privateKey,
      { backupId: manifest.id, artifact: artifact.file },
      { passphrase, maxBytes },
    );
    try {
      // The file is reopened after the full-package check. Rebind this exact
      // plaintext to that verified manifest before pg_restore can consume it.
      if (body.length !== artifact.bytes ||
          createHash("sha256").update(body).digest("hex") !== artifact.sha256)
        throw new Error("backup_manifest_integrity_failed");
      const { child, completion } = pgProcess(
        "pg_restore",
        ["--single-transaction", "--exit-on-error"],
        connection,
        tools,
      );
      child.stdout.resume();
      child.stdin.on("error", () => undefined);
      child.stdin.end(body);
      await completion;
    } finally {
      body.fill(0);
    }
    return {
      databaseRestored: true,
      authLoginVerified: false,
      storageFilesRestored: false,
      configurationApplied: false,
      rolesApplied: false,
      sourceServerMajor: manifest.source.serverMajor,
    };
  } finally {
    await closePgClient(client);
  }
}
