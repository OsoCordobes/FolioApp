import "server-only";

import { err, ok, type Result } from "@/lib/db/errors";
import type { ActiveSession } from "@/lib/db/session";
import { CLINICAL_LEGACY_MAX_BYTES, clinicalObjectPath, inspectClinicalFile } from "@/lib/storage/clinical-files";
import { createSupabaseServiceClient, type createSupabaseServerClient } from "@/lib/supabase/server";
import { buildPatientExport } from "./export-builder";
import { revalidateClinicalDelivery } from "./export-authorization";
import { minimumPackageProgressCalls, PACKAGE_CAPACITY_MESSAGE,
  PACKAGE_MAX_PROGRESS_CALLS } from "./export-package-capacity";
import { PACKAGE_CHUNK_BYTES, frozenPackageJson, packageChunks, sha256 } from "./export-jobs-chunks";
import { fingerprintExportPackage } from "./export-jobs-fingerprint";
import { beginExportPackageJob, readExportPackageJob } from "./export-jobs";
import { readPackageSourcePlan, type PackageSource } from "./export-jobs-sources";
import { putVerifiedFragment, type PrivateFragmentStore } from "./export-jobs-storage";
import { privateExportBucket } from "./export-jobs-storage-client";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNATURE_MAX_BYTES = 10 * 1024 * 1024;
const FROZEN_PLACEHOLDER = "2000-01-01T00:00:00.000Z";
type SourceKey = { kind: PackageSource["kind"] | "json"; sourceId: string; sourceIndex: number };
type LedgerEntry = { entry_id: string; kind: SourceKey["kind"]; source_id: string;
  source_index: number; expected_fragments: number; source_hash_kind: string;
  source_sha256: string | null; computed_sha256: string | null;
  verified_at: string | null; registered_at: string };
const sourceKey = (item: SourceKey) => `${item.kind}:${item.sourceId}:${item.sourceIndex}`;

async function currentPlan(client: Client, session: ActiveSession, pacienteId: string): Promise<Result<{
  exported: Record<string, unknown>; sources: PackageSource[]; fingerprint: string;
}>> {
  try {
  const org = await client.from("organization").select("nombre")
    .eq("id", session.organizationId).maybeSingle();
  if (org.error || !org.data || typeof org.data.nombre !== "string") {
    return err("db_error", "No se pudo verificar la organización para la entrega.");
  }
  const built = await buildPatientExport({ clinicalHistory: "professional-reviewed",
    supabase: client, organizationId: session.organizationId,
    organizationNombre: org.data.nombre, pacienteId });
  if (!built.ok) return built;
  const exported = built.data as unknown as Record<string, unknown>;
  const plan = await readPackageSourcePlan(client, session.organizationId, pacienteId, exported);
  if (!plan.ok) return plan;
    const fingerprint = fingerprintExportPackage(exported, plan.data);
    frozenPackageJson(exported, FROZEN_PLACEHOLDER);
    return ok({ exported, sources: plan.data, fingerprint });
  } catch {
    return err("db_error", "No se pudo verificar toda la entrega clínica.");
  }
}

/** Called only by a server route after resolving the current session. No HTTP
 * field may supply a fingerprint, source count or private Storage path. */
export async function beginVerifiedExportPackage(
  client: Client, session: ActiveSession, pacienteId: string, idempotencyKey: string,
): Promise<Result<string>> {
  const plan = await currentPlan(client, session, pacienteId);
  if (!plan.ok) return plan;
  const minimum = minimumPackageProgressCalls(plan.data.sources, PACKAGE_CHUNK_BYTES);
  if (minimum === null) return err("db_error", "No se pudo verificar el tamaño del inventario.");
  if (minimum > PACKAGE_MAX_PROGRESS_CALLS) return err("validation", PACKAGE_CAPACITY_MESSAGE);
  return beginExportPackageJob(client, session, { pacienteId, idempotencyKey,
    verifiedInventoryFingerprint: plan.data.fingerprint,
    expectedEntries: plan.data.sources.length + 1 });
}

function sourceStorageKey(source: PackageSource, organizationId: string, pacienteId: string): string {
  if (!source.storageBucket || !source.storagePath) throw new Error("invalid_private_source");
  if (source.kind === "document") {
    const key = clinicalObjectPath(source.storagePath, organizationId, pacienteId);
    if (!key) throw new Error("invalid_private_source");
    return key;
  }
  const prefix = `${source.storageBucket}/`;
  if (source.kind !== "signature" || !source.storagePath.startsWith(prefix)) {
    throw new Error("invalid_private_source");
  }
  return source.storagePath.slice(prefix.length);
}

async function readSourceBytes(
  source: PackageSource, organizationId: string, pacienteId: string,
): Promise<Uint8Array> {
  const service = createSupabaseServiceClient();
  const key = sourceStorageKey(source, organizationId, pacienteId);
  const maximum = source.kind === "signature" ? SIGNATURE_MAX_BYTES : CLINICAL_LEGACY_MAX_BYTES;
  const { data, error } = await service.storage.from(source.storageBucket!).download(key, {},
    { signal: AbortSignal.timeout(20000), cache: "no-store" });
  if (error || !data || !data.size || data.size > maximum ||
      (source.sizeBytes !== null && data.size !== source.sizeBytes)) {
    throw new Error("source_unavailable");
  }
  const bytes = new Uint8Array(await data.arrayBuffer());
  const inspected = inspectClinicalFile(bytes, maximum);
  if (!inspected.ok || (source.kind === "document" && inspected.data.mime !== source.mimeType) ||
      (source.kind === "signature" && !["image/png", "application/pdf"].includes(inspected.data.mime)) ||
      (source.recordedSha256 !== null && sha256(bytes) !== source.recordedSha256)) {
    throw new Error("source_verification_failed");
  }
  return bytes;
}

function fragmentStore(): PrivateFragmentStore {
  const bucket = privateExportBucket();
  return {
    upload: async (path, bytes) => {
      const { error } = await bucket.upload(path, bytes,
        { upsert: false, contentType: "application/octet-stream", cacheControl: "0" });
      return !error;
    },
    download: async path => {
      const { data, error } = await bucket.download(path, {},
        { signal: AbortSignal.timeout(15000), cache: "no-store" });
      if (error || !data || !data.size || data.size > PACKAGE_CHUNK_BYTES) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}

async function renewLease(jobId: string, session: ActiveSession, token: string, revision: number): Promise<void> {
  const { data, error } = await createSupabaseServiceClient().rpc("export_package_renew", {
    p_id: jobId, p_actor: session.userId, p_token: token, p_revision: revision,
  });
  if (error || data !== true) throw new Error("lease_not_confirmed");
}

/** One fragment per invocation: at most one 50 MiB source and one 3 MiB
 * upload/readback. Registered fragments survive a lost lease or response. */
export async function stageExportPackageEntry(
  client: Client, session: ActiveSession, jobId: string, leaseToken: string,
  revision: number, key: SourceKey,
): Promise<Result<{ entryId: string; complete: boolean; remainingFragments: number }>> {
  if (!UUID.test(jobId) || !UUID.test(leaseToken) || !UUID.test(key.sourceId) ||
      !Number.isSafeInteger(revision) || revision < 0 ||
      !Number.isSafeInteger(key.sourceIndex) || key.sourceIndex < 0 || key.sourceIndex > 1 ||
      (key.kind !== "signature" && key.sourceIndex !== 0)) {
    return err("validation", "La entrada de la entrega es inválida.");
  }
  const job = await readExportPackageJob(client, session, jobId);
  if (!job.ok) return job;
  if (job.data.state !== "leased" || job.data.revision !== revision) {
    return err("conflict", "El trabajo cambió. Consultá su estado antes de reintentar.");
  }
  const plan = await currentPlan(client, session, job.data.paciente_id);
  if (!plan.ok) return plan;
  if (plan.data.fingerprint !== job.data.source_fingerprint ||
      plan.data.sources.length + 1 > 10000) {
    return err("conflict", "Las fuentes cambiaron. No se preparó una entrega parcial.");
  }
  const source = key.kind === "json" && key.sourceId === job.data.paciente_id && key.sourceIndex === 0
    ? null : plan.data.sources.find(item => item.kind === key.kind &&
      item.sourceId === key.sourceId && item.sourceIndex === key.sourceIndex);
  if (key.kind !== "json" && !source || key.kind === "json" && key.sourceId !== job.data.paciente_id) {
    return err("not_found", "No se encontró esa entrada en el inventario autorizado.");
  }
  try {
    await renewLease(jobId, session, leaseToken, revision);
    let bytes: Uint8Array | null = null;
    if (key.kind === "json") bytes = frozenPackageJson(plan.data.exported, FROZEN_PLACEHOLDER);
    else if (source?.kind !== "withdrawn_document") {
      bytes = await readSourceBytes(source!, session.organizationId, job.data.paciente_id);
    }
    await renewLease(jobId, session, leaseToken, revision);
    const current = await revalidateClinicalDelivery(client, session, job.data.paciente_id);
    if (!current.ok) return current;
    const expectedFragments = bytes ? packageChunks(bytes).length : 0;
    const hashKind = key.kind === "json" ? "not_applicable" : source!.recordedSha256 ? "recorded" : "not_recorded";
    const { data: registered, error: registerError } = await createSupabaseServiceClient().rpc("export_package_entry_register", {
      p_id: jobId, p_actor: session.userId, p_token: leaseToken, p_revision: revision,
      p_kind: key.kind, p_source: key.sourceId, p_index: key.sourceIndex,
      p_fragments: expectedFragments, p_hash_kind: hashKind,
      p_source_sha: source?.recordedSha256 ?? null,
    });
    const entry = Array.isArray(registered) && registered.length === 1 ? registered[0] : null;
    if (registerError || !entry || !UUID.test(String(entry.entry_id)) ||
        !Number.isFinite(Date.parse(String(entry.registered_at)))) throw new Error("entry_not_confirmed");
    if (key.kind === "json") {
      bytes = frozenPackageJson(plan.data.exported, entry.registered_at);
      if (packageChunks(bytes).length !== expectedFragments) throw new Error("json_size_changed");
    }
    if (bytes) {
      const chunks = packageChunks(bytes);
      const listed = await createSupabaseServiceClient().rpc("export_package_fragment_read", {
        p_id: jobId, p_actor: session.userId, p_token: leaseToken,
        p_revision: revision, p_entry: entry.entry_id,
      });
      if (listed.error || !Array.isArray(listed.data) || listed.data.length > chunks.length) {
        throw new Error("fragment_progress_unreadable");
      }
      const done = new Set<number>();
      for (const fragment of listed.data) {
        const ordinal = fragment.ordinal;
        if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= chunks.length ||
            done.has(ordinal) || fragment.bytes !== chunks[ordinal].byteLength ||
            fragment.sha256 !== sha256(chunks[ordinal])) {
          throw new Error("fragment_progress_changed");
        }
        done.add(ordinal);
      }
      const nextOrdinal = chunks.findIndex((_, ordinal) => !done.has(ordinal));
      if (nextOrdinal >= 0) {
        await renewLease(jobId, session, leaseToken, revision);
        const authorized = await revalidateClinicalDelivery(client, session, job.data.paciente_id);
        if (!authorized.ok) return authorized;
        const verified = await putVerifiedFragment(fragmentStore(), jobId, entry.entry_id,
          nextOrdinal, chunks[nextOrdinal]);
        const { data, error } = await createSupabaseServiceClient().rpc("export_package_fragment_register", {
          p_id: jobId, p_actor: session.userId, p_token: leaseToken, p_revision: revision,
          p_entry: entry.entry_id, p_ordinal: nextOrdinal, p_bytes: verified.bytes,
          p_sha: verified.sha256,
        });
        if (error || data !== true) throw new Error("fragment_not_confirmed");
        done.add(nextOrdinal);
      }
      if (done.size < chunks.length) return ok({ entryId: entry.entry_id, complete: false,
        remainingFragments: chunks.length - done.size });
      await renewLease(jobId, session, leaseToken, revision);
      const authorized = await revalidateClinicalDelivery(client, session, job.data.paciente_id);
      if (!authorized.ok) return authorized;
      const { data, error } = await createSupabaseServiceClient().rpc("export_package_entry_verify", {
        p_id: jobId, p_actor: session.userId, p_token: leaseToken, p_revision: revision,
        p_entry: entry.entry_id, p_computed_sha: sha256(bytes),
      });
      if (error || data !== true) throw new Error("entry_not_verified");
    }
    return ok({ entryId: entry.entry_id, complete: true, remainingFragments: 0 });
  } catch {
    return err("db_error", "No se pudo confirmar la entrada. Consultá el trabajo antes de reintentar.");
  }
}

/** SQL validates the exact set again under the job row lock. This method does
 * not redownload the entire package: every entry was read back per fragment
 * before it received verified_at, and no app path mutates a staged object. */
export async function finishVerifiedExportPackage(
  client: Client, session: ActiveSession, jobId: string, leaseToken: string,
  revision: number,
): Promise<Result<void>> {
  if (!UUID.test(jobId) || !UUID.test(leaseToken) ||
      !Number.isSafeInteger(revision) || revision < 0) {
    return err("validation", "El trabajo de entrega es inválido.");
  }
  const job = await readExportPackageJob(client, session, jobId);
  if (!job.ok) return job;
  if (job.data.state !== "leased" || job.data.revision !== revision) {
    return err("conflict", "El trabajo cambió. Consultá su estado antes de reintentar.");
  }
  const plan = await currentPlan(client, session, job.data.paciente_id);
  if (!plan.ok) return plan;
  if (plan.data.fingerprint !== job.data.source_fingerprint) {
    return err("conflict", "Las fuentes cambiaron. No se preparó una entrega parcial.");
  }
  try {
    const expected = new Map<string, PackageSource | null>(
      [[sourceKey({ kind: "json", sourceId: job.data.paciente_id, sourceIndex: 0 }), null],
        ...plan.data.sources.map(source => [sourceKey({ kind: source.kind,
          sourceId: source.sourceId, sourceIndex: source.sourceIndex }), source] as const)]);
    const actual = new Map<string, LedgerEntry>();
    for (let offset = 0; offset <= 10000; offset += 500) {
      await renewLease(jobId, session, leaseToken, revision);
      const { data, error } = await createSupabaseServiceClient().rpc("export_package_inventory_read", {
        p_id: jobId, p_actor: session.userId, p_offset: offset, p_limit: 500,
      });
      if (error || !Array.isArray(data) || data.length > 500) throw new Error("inventory_read_failed");
      for (const row of data as LedgerEntry[]) {
        const key = sourceKey({ kind: row.kind, sourceId: row.source_id,
          sourceIndex: row.source_index });
        if (!expected.has(key) || actual.has(key) || !UUID.test(row.entry_id)) {
          throw new Error("unexpected_inventory_entry");
        }
        actual.set(key, row);
      }
      if (data.length < 500) break;
    }
    if (actual.size !== expected.size) throw new Error("incomplete_inventory");
    const contract = [...actual].map(([key, row]) => {
      const source = expected.get(key);
      if (row.kind === "json") {
        const bytes = frozenPackageJson(plan.data.exported, row.registered_at);
        if (row.source_id !== job.data.paciente_id || row.source_index !== 0 ||
            row.expected_fragments !== packageChunks(bytes).length ||
            row.source_hash_kind !== "not_applicable" || row.source_sha256 !== null ||
            row.computed_sha256 !== sha256(bytes)) throw new Error("json_inventory_mismatch");
      } else {
        if (!source || source.kind !== row.kind || source.sourceId !== row.source_id ||
            source.sourceIndex !== row.source_index ||
            row.source_sha256 !== source.recordedSha256 ||
            row.source_hash_kind !== (source.recordedSha256 ? "recorded" : "not_recorded") ||
            (row.kind === "withdrawn_document" &&
              (row.expected_fragments !== 0 || row.verified_at !== null || row.computed_sha256 !== null)) ||
            (row.kind !== "withdrawn_document" &&
              (!Number.isSafeInteger(row.expected_fragments) || row.expected_fragments < 1 ||
                row.verified_at === null || !/^[a-f0-9]{64}$/.test(row.computed_sha256 ?? ""))) ||
            (row.kind === "document" && row.expected_fragments !==
              Math.ceil(source.sizeBytes! / PACKAGE_CHUNK_BYTES))) {
          throw new Error("source_inventory_mismatch");
        }
      }
      return { kind: row.kind, source_id: row.source_id, source_index: row.source_index,
        expected_fragments: row.expected_fragments, source_hash_kind: row.source_hash_kind,
        source_sha256: row.source_sha256 };
    });
    contract.sort((a, b) => a.kind < b.kind ? -1 : a.kind > b.kind ? 1 :
      a.source_id < b.source_id ? -1 : a.source_id > b.source_id ? 1 :
        a.source_index - b.source_index);
    const finalPlan = await currentPlan(client, session, job.data.paciente_id);
    if (!finalPlan.ok || finalPlan.data.fingerprint !== plan.data.fingerprint ||
        finalPlan.data.sources.length + 1 !== contract.length) {
      throw new Error("source_changed_during_finalization");
    }
    await renewLease(jobId, session, leaseToken, revision);
    const authorized = await revalidateClinicalDelivery(client, session, job.data.paciente_id);
    if (!authorized.ok) return authorized;
    const { data, error } = await createSupabaseServiceClient().rpc("export_package_finish", {
      p_id: jobId, p_actor: session.userId, p_token: leaseToken, p_revision: revision,
      p_fingerprint: plan.data.fingerprint, p_expected: contract,
    });
    if (error || data !== true) throw new Error("finish_not_confirmed");
    const final = await readExportPackageJob(client, session, jobId);
    if (!final.ok || final.data.state !== "ready") throw new Error("ready_not_confirmed");
    return ok(undefined);
  } catch {
    return err("db_error", "No se pudo confirmar la entrega. Consultá su estado antes de reintentar.");
  }
}
