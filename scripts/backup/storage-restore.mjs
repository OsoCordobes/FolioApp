import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile } from "node:fs/promises";
import { verifyBackup } from "./restore.mjs";
import { openArtifact, fileDigest, MAX_RESTORE_BYTES } from "./envelope.mjs";
import { createStorageReader } from "./storage.mjs";
import { writeAtomicJson } from "./retention.mjs";
import { resolveOutsideRepository } from "./paths.mjs";
import { acquireBackupLock } from "./lock.mjs";

const repository = fileURLToPath(new URL("../../", import.meta.url));

export function localStorageOrigin(value, confirmation) {
  const url = new URL(value);
  // Literal IPs prevent a hostname or DNS change from redirecting local restore.
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    confirmation !== url.origin
  )
    throw new Error("storage_restore_target_not_confirmed_loopback");
  return url.origin;
}

function objectPath(object) {
  if (
    typeof object?.bucket !== "string" ||
    !object.bucket ||
    [".", ".."].includes(object.bucket) ||
    /[/\\\x00-\x1f]/.test(object.bucket) ||
    typeof object.name !== "string" ||
    /[\\\x00-\x1f]/.test(object.name) ||
    object.name
      .split("/")
      .some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("storage_restore_object_path_invalid");
  }
  return `object/${encodeURIComponent(object.bucket)}/${object.name.split("/").map(encodeURIComponent).join("/")}`;
}

function identity(rows) {
  return JSON.stringify(
    rows
      .map((o) => ({ bucket: o.bucket, name: o.name, id: o.id }))
      .sort((a, b) =>
        `${a.bucket}/${a.name}`.localeCompare(`${b.bucket}/${b.name}`),
      ),
  );
}

/** DB metadata must already be restored to an isolated, manually prepared local service.
 * API upsert keeps paths/row IDs but creates a new backend version; never replay the
 * old storage metadata after uploading or delete clinical rows to work around it.
 */
export async function restoreStorageLocal({
  directory,
  privateKey,
  passphrase,
  storageUrl,
  confirmStorageOrigin,
  metadataRestored,
  serviceKey,
  journalDirectory,
  maxBytes = MAX_RESTORE_BYTES,
  pageSize = 100,
}) {
  const origin = localStorageOrigin(storageUrl, confirmStorageOrigin);
  if (metadataRestored !== true || !serviceKey)
    throw new Error("storage_restore_prepared_target_required");
  // Authenticate the COMPLETE package before a journal or any external write.
  const manifest = await verifyBackup(directory, privateKey, {
    passphrase,
    maxBytes,
  });
  const artifacts = manifest.artifacts.filter(
    (a) => a.kind === "storage-object",
  );
  const objects = artifacts.map((a) => a.object);
  for (const artifact of artifacts) {
    objectPath(artifact.object);
    if (artifact.bytes !== artifact.object.size)
      throw new Error("storage_restore_object_size_invalid");
  }
  if (
    new Set(objects.map((o) => `${o.bucket}/${o.name}`)).size !==
      objects.length ||
    identity(objects) !== identity(manifest.source.objects)
  )
    throw new Error("storage_restore_manifest_inventory_invalid");

  const headers = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };
  const request = (endpoint, options = {}) =>
    fetch(`${origin}/storage/v1/${endpoint}`, {
      ...options,
      headers: { ...headers, ...options.headers },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
  const reader = createStorageReader({ url: origin, serviceKey, pageSize });
  const checkInventory = async () => {
    const bucketsResponse = await request("bucket");
    if (!bucketsResponse.ok)
      throw new Error("storage_restore_inventory_unavailable");
    const buckets = await bucketsResponse.json();
    for (const expected of manifest.source.buckets) {
      const actual = buckets.find((b) => b.id === expected.id);
      if (
        !actual ||
        (typeof expected.public === "boolean" &&
          actual.public !== expected.public)
      ) {
        throw new Error(
          "storage_restore_inventory_bucket_configuration_mismatch",
        );
      }
    }
    const actual = await reader.inventory(manifest.source.buckets);
    if (identity(actual) !== identity(objects))
      throw new Error("storage_restore_inventory_not_restored_metadata");
  };
  await checkInventory();

  const journalRoot = await resolveOutsideRepository(
    journalDirectory,
    repository,
  );
  await mkdir(journalRoot, { recursive: true, mode: 0o700 });
  const target = createHash("sha256").update(origin).digest("hex");
  const journalPath = path.join(journalRoot, `storage_${target}.json`);
  const legacyLock = path.join(journalRoot, `.storage_${target}.lock`);
  // Old directory locks may belong to a still-running older tool. Preserve them
  // for operator review; new restores use a per-target OS lease that dies with
  // the process, leaving the authenticated journal available for resumption.
  try { await lstat(legacyLock); throw new Error("storage_restore_legacy_lock_review_required"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const leaseDirectory = path.join(journalRoot, `storage_${target}_lease`);
  await mkdir(leaseDirectory, {recursive:true, mode:0o700});
  const leaseState = await lstat(leaseDirectory);
  if (!leaseState.isDirectory() || leaseState.isSymbolicLink()) throw new Error("storage_restore_lease_path_invalid");
  const lease = await acquireBackupLock(leaseDirectory,{targetScope:`storage-restore:${target}`});
  try {
    const manifestHash = await fileDigest(
      path.join(directory, "manifest.sealed"),
    );
    let journal;
    try {
      journal = JSON.parse(await readFile(journalPath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new Error("storage_restore_journal_invalid");
    }
    if (journal) {
      if (
        journal.version !== 1 ||
        journal.backupId !== manifest.id ||
        journal.manifestHash !== manifestHash ||
        journal.target !== target ||
        !Array.isArray(journal.items) ||
        journal.items.length !== artifacts.length ||
        journal.items.some(
          (item, i) =>
            item.file !== artifacts[i].file ||
            !["unstarted", "attempting", "verified"].includes(item.state),
        )
      ) {
        throw new Error("storage_restore_journal_mismatch");
      }
    } else {
      journal = {
        version: 1,
        runId: randomUUID(),
        backupId: manifest.id,
        manifestHash,
        target,
        phase: "metadata_checked",
        items: artifacts.map((a) => ({ file: a.file, state: "unstarted" })),
      };
    }
    const save = async () => {
      journal.updatedAt = new Date().toISOString();
      await writeAtomicJson(journalPath, journal);
    };
    await save();

    const inspect = async (artifact) => {
      const response = await request(objectPath(artifact.object), {
        headers: { "Cache-Control": "no-cache" },
      });
      if (response.status === 404) {
        await response.body?.cancel();
        return "missing";
      }
      // Supabase can encode a missing backend key as HTTP 400 + statusCode 404.
      if (response.status === 400) {
        const error = await response.json().catch(() => null);
        if (String(error?.statusCode) === "404") return "missing";
      }
      if (!response.ok || !response.body)
        throw new Error("storage_restore_download_failed");
      let size = 0;
      const hash = createHash("sha256");
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > artifact.bytes) return "different";
        hash.update(chunk);
      }
      return size === artifact.bytes && hash.digest("hex") === artifact.sha256
        ? "verified"
        : "different";
    };
    try {
      journal.phase = "copying";
      await save();
      for (let i = 0; i < artifacts.length; i++) {
        const artifact = artifacts[i];
        const item = journal.items[i];
        const current = await inspect(artifact);
        if (current === "different")
          throw new Error("storage_restore_foreign_bytes");
        if (current !== "verified") {
          // Persist intent before sending. After a lost response, GET+hash decides
          // whether to skip. An intent does not prove who wrote different bytes:
          // preserve them for operator review, even after a failed own upload.
          item.state = "attempting";
          await save();
          const body = await openArtifact(
            path.join(directory, artifact.file),
            privateKey,
            { backupId: manifest.id, artifact: artifact.file },
            { passphrase, maxBytes },
          );
          try {
            if (
              body.length !== artifact.bytes ||
              createHash("sha256").update(body).digest("hex") !==
                artifact.sha256
            )
              throw new Error("storage_restore_artifact_changed");
            const response = await request(objectPath(artifact.object), {
              method: "POST",
              headers: {
                "x-upsert": "true",
                "Content-Type":
                  artifact.object.metadata?.mimetype ||
                  "application/octet-stream",
                "Cache-Control":
                  artifact.object.metadata?.cacheControl || "max-age=3600",
              },
              body,
            });
            await response.body?.cancel();
            if (!response.ok) throw new Error("storage_restore_upload_failed");
          } finally {
            body.fill(0);
          }
          if ((await inspect(artifact)) !== "verified")
            throw new Error("storage_restore_uploaded_bytes_mismatch");
        }
        item.state = "verified";
        await save();
      }
      await checkInventory();
      // Recheck all bytes at completion, including objects skipped on resume.
      for (const artifact of artifacts)
        if ((await inspect(artifact)) !== "verified")
          throw new Error("storage_restore_final_verification_failed");
      journal.phase = "verified";
      await save();
      return {
        storageFilesRestored: true,
        storageObjects: artifacts.length,
        runId: journal.runId,
        configurationApplied: false,
        rolesApplied: false,
        authLoginVerified: false,
        storageOwnershipVerified: false,
      };
    } catch {
      journal.phase = "pending";
      await save();
      // No cross-service rollback exists. Retain verified objects and journal;
      // never delete metadata, previous histories or clinical rows after failure.
      throw new Error(
        "storage_restore_pending: verified files preserved; resume the same package and target",
      );
    }
  } finally {
    await lease.release();
  }
}
