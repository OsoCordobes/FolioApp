import "server-only";

import { err, ok, type Result } from "@/lib/db/errors";
import type { ActiveSession } from "@/lib/db/session";
import { createSupabaseServiceClient, type createSupabaseServerClient } from "@/lib/supabase/server";
import { buildPatientExport } from "./export-builder";
import { revalidateClinicalDelivery } from "./export-authorization";
import { PACKAGE_CHUNK_BYTES, packageFragmentPath, sha256 } from "./export-jobs-chunks";
import { fingerprintExportPackage } from "./export-jobs-fingerprint";
import { claimExportPackageJob, readExportPackageJob } from "./export-jobs";
import { beginVerifiedExportPackage, finishVerifiedExportPackage, stageExportPackageEntry } from "./export-jobs-worker";
import { readPackageSourcePlan, type PackageSource } from "./export-jobs-sources";
import { privateExportBucket } from "./export-jobs-storage-client";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[a-f0-9]{64}$/;
const SOURCE_SIZE = 50 * 1024 * 1024;
const SIGNATURE_SIZE = 10 * 1024 * 1024;
const JSON_SIZE = 4 * 1024 * 1024;

export type PackageOperation = {
  job_id: string; organization_id: string; paciente_id: string;
  actor_user_id: string; actor_member_id: string; source_fingerprint: string;
  state: "pending" | "leased" | "ready" | "failed" | "expired";
  revision: number; expected_entries: number; expires_at: string;
  lease_until: string | null;
};
export type PackageDeliveryEntry = {
  entry_id: string; kind: "json" | "document" | "signature" | "withdrawn_document";
  source_id: string; source_index: number; expected_fragments: number;
  total_bytes: number; source_hash_kind: "recorded" | "not_recorded" | "not_applicable";
  source_sha256: string | null; computed_sha256: string | null;
  registered_at: string;
};
type PageRow = PackageDeliveryEntry & { expected_entries: number; expires_at: string;
  prepared_at: string;
  actual_fragments: number };
type FragmentRow = Pick<PackageDeliveryEntry, "entry_id" | "kind" | "source_id" |
  "source_index" | "expected_fragments" | "source_hash_kind" | "source_sha256" |
  "computed_sha256"> & { fragment_bytes: number; fragment_sha256: string;
  expires_at: string };
type CurrentPlan = { fingerprint: string; sources: PackageSource[] };
type Bound = { patientId: string; operationId: string; jobId: string };

function dateInFuture(value: string, now = Date.now()) {
  const date = Date.parse(value);
  return Number.isFinite(date) && date > now;
}
function sourceKey(source: { kind: string; sourceId: string; sourceIndex: number }) {
  return `${source.kind}:${source.sourceId}:${source.sourceIndex}`;
}
function fromEntry(row: { kind: string; source_id: string; source_index: number }) {
  return `${row.kind}:${row.source_id}:${row.source_index}`;
}
function validOperation(row: PackageOperation, session: ActiveSession, patientId: string, jobId?: string) {
  return UUID.test(row.job_id) && row.job_id === (jobId ?? row.job_id) &&
    row.actor_user_id === session.userId && row.actor_member_id === session.memberId &&
    row.organization_id === session.organizationId && row.paciente_id === patientId &&
    SHA.test(row.source_fingerprint) && Number.isSafeInteger(row.revision) && row.revision >= 0 &&
    Number.isSafeInteger(row.expected_entries) && row.expected_entries >= 1 && row.expected_entries <= 10000 &&
    ["pending", "leased", "ready", "failed", "expired"].includes(row.state) &&
    Number.isFinite(Date.parse(row.expires_at)) &&
    (row.lease_until === null || Number.isFinite(Date.parse(row.lease_until)));
}

/** An operation lookup recovers an uncertain begin without recomputing a
 * possibly changed inventory or inventing another idempotency key. */
export async function readPackageOperation(client: Client, session: ActiveSession,
  patientId: string, operationId: string, expectedJobId?: string): Promise<Result<PackageOperation>> {
  if (!UUID.test(patientId) || !UUID.test(operationId) ||
      expectedJobId !== undefined && !UUID.test(expectedJobId)) {
    return err("validation", "La operación de entrega es inválida.");
  }
  const current = await revalidateClinicalDelivery(client, session, patientId);
  if (!current.ok) return current;
  try {
    const { data, error } = await createSupabaseServiceClient().rpc("export_package_operation_read", {
      p_actor: session.userId, p_org: session.organizationId,
      p_patient: patientId, p_operation: operationId,
    });
    if (error || !Array.isArray(data)) {
      return err("db_error", "No se pudo confirmar la operación. Consultá antes de reintentar.");
    }
    if (data.length === 0) return err("not_found", "No se encontró esa operación para tu acceso actual.");
    const row = data.length === 1 ? data[0] as PackageOperation : null;
    if (!row || !validOperation(row, session, patientId, expectedJobId)) {
      return err("db_error", "La respuesta de la operación no fue verificable. Consultá antes de reintentar.");
    }
    return ok(row);
  } catch {
    return err("network", "No se pudo confirmar la operación. Consultá su estado antes de reintentar.");
  }
}

async function readBound(client: Client, session: ActiveSession, bound: Bound) {
  const operation = await readPackageOperation(client, session, bound.patientId,
    bound.operationId, bound.jobId);
  if (!operation.ok) return operation;
  const job = await readExportPackageJob(client, session, bound.jobId);
  if (!job.ok) return job;
  if (job.data.revision !== operation.data.revision || job.data.state !== operation.data.state ||
      job.data.source_fingerprint !== operation.data.source_fingerprint) {
    return err("conflict", "El trabajo cambió. Consultá su estado antes de continuar.");
  }
  return operation;
}

async function currentPlan(client: Client, session: ActiveSession, patientId: string): Promise<Result<CurrentPlan>> {
  try {
    const org = await client.from("organization").select("nombre")
      .eq("id", session.organizationId).maybeSingle();
    if (org.error || typeof org.data?.nombre !== "string") throw new Error("org_unreadable");
    const built = await buildPatientExport({ clinicalHistory: "professional-reviewed",
      supabase: client, organizationId: session.organizationId,
      organizationNombre: org.data.nombre, pacienteId: patientId });
    if (!built.ok) return built;
    const exported = built.data as unknown as Record<string, unknown>;
    const sources = await readPackageSourcePlan(client, session.organizationId, patientId, exported);
    if (!sources.ok) return sources;
    return ok({ sources: sources.data, fingerprint: fingerprintExportPackage(exported, sources.data) });
  } catch {
    return err("db_error", "No se pudo verificar el inventario actual. Prepará otra entrega si cambió.");
  }
}

async function samePlan(client: Client, session: ActiveSession, operation: PackageOperation) {
  const plan = await currentPlan(client, session, operation.paciente_id);
  if (!plan.ok || plan.data.fingerprint !== operation.source_fingerprint ||
      plan.data.sources.length + 1 !== operation.expected_entries) {
    return err("conflict", "Las fuentes cambiaron. Prepará una nueva entrega explícitamente.");
  }
  return plan;
}

export async function startPackageOperation(client: Client, session: ActiveSession,
  patientId: string, operationId: string): Promise<Result<PackageOperation>> {
  if (!UUID.test(patientId) || !UUID.test(operationId)) {
    return err("validation", "La operación de entrega es inválida.");
  }
  const begun = await beginVerifiedExportPackage(client, session, patientId, operationId);
  if (!begun.ok) return begun;
  return readPackageOperation(client, session, patientId, operationId, begun.data);
}

export async function claimPackageOperation(client: Client, session: ActiveSession,
  bound: Bound, expectedRevision: number): Promise<Result<{ leaseToken: string; revision: number }>> {
  const job = await readBound(client, session, bound);
  if (!job.ok) return job;
  if (job.data.revision !== expectedRevision ||
      !(job.data.state === "pending" || job.data.state === "leased" &&
        job.data.lease_until !== null && Date.parse(job.data.lease_until) <= Date.now())) {
    return err("conflict", "El lease sigue vigente o cambió. Consultá el estado antes de reclamarlo.");
  }
  return claimExportPackageJob(client, session, bound.jobId, expectedRevision);
}

/** Caller chooses only an ordinal, never a path, fingerprint or expected count.
 * Each request stages at most one fragment of the selected source. */
export async function progressPackageOperation(client: Client, session: ActiveSession,
  bound: Bound, leaseToken: string, revision: number, sourceOrdinal: number) {
  const job = await readBound(client, session, bound);
  if (!job.ok) return job;
  if (job.data.state !== "leased" || job.data.revision !== revision ||
      !UUID.test(leaseToken) || !Number.isSafeInteger(sourceOrdinal) || sourceOrdinal < 0 ||
      sourceOrdinal >= job.data.expected_entries) {
    return err("conflict", "El avance no coincide con el trabajo vigente.");
  }
  const plan = await samePlan(client, session, job.data);
  if (!plan.ok) return plan;
  const source = sourceOrdinal === 0 ? null : plan.data.sources[sourceOrdinal - 1];
  return stageExportPackageEntry(client, session, bound.jobId, leaseToken, revision,
    source ? { kind: source.kind, sourceId: source.sourceId, sourceIndex: source.sourceIndex }
      : { kind: "json", sourceId: job.data.paciente_id, sourceIndex: 0 });
}

export async function finishPackageOperation(client: Client, session: ActiveSession,
  bound: Bound, leaseToken: string, revision: number): Promise<Result<void>> {
  const job = await readBound(client, session, bound);
  if (!job.ok) return job;
  if (job.data.state !== "leased" || job.data.revision !== revision || !UUID.test(leaseToken)) {
    return err("conflict", "El trabajo cambió. Consultá su estado antes de finalizar.");
  }
  return finishVerifiedExportPackage(client, session, bound.jobId, leaseToken, revision);
}

function validPageRow(row: PageRow, operation: PackageOperation, sources: Map<string, PackageSource>) {
  const source = sources.get(fromEntry(row));
  const withdrawn = row.kind === "withdrawn_document";
  const json = row.kind === "json";
  const max = json ? JSON_SIZE : row.kind === "signature" ? SIGNATURE_SIZE : SOURCE_SIZE;
  return UUID.test(row.entry_id) && UUID.test(row.source_id) &&
    row.expected_entries === operation.expected_entries && row.expires_at === operation.expires_at &&
    Number.isSafeInteger(row.source_index) && row.source_index >= 0 && row.source_index <= 1 &&
    Number.isSafeInteger(row.expected_fragments) && row.expected_fragments >= 0 &&
    Number.isSafeInteger(row.actual_fragments) && row.actual_fragments === row.expected_fragments &&
    Number.isSafeInteger(row.total_bytes) && row.total_bytes >= 0 && row.total_bytes <= max &&
    dateInFuture(row.expires_at) && Number.isFinite(Date.parse(row.registered_at)) &&
    Number.isFinite(Date.parse(row.prepared_at)) &&
    (json ? row.source_id === operation.paciente_id && row.source_index === 0 &&
      row.source_hash_kind === "not_applicable" && row.source_sha256 === null :
      Boolean(source) && row.source_hash_kind === (source!.recordedSha256 ? "recorded" : "not_recorded") &&
      row.source_sha256 === source!.recordedSha256 &&
      (row.kind !== "document" || row.total_bytes === source!.sizeBytes)) &&
    (row.source_hash_kind !== "recorded" || withdrawn ||
      row.source_sha256 === row.computed_sha256) &&
    (withdrawn ? row.expected_fragments === 0 && row.total_bytes === 0 &&
      row.computed_sha256 === null : row.expected_fragments >= 1 &&
      row.total_bytes >= 1 && row.expected_fragments === Math.ceil(row.total_bytes / PACKAGE_CHUNK_BYTES) &&
      SHA.test(row.computed_sha256 ?? ""));
}

export async function readPackageManifestPage(client: Client, session: ActiveSession,
  bound: Bound, offset: number, limit: number): Promise<Result<{
    expectedEntries: number; expiresAt: string; preparedAt: string;
    entries: PackageDeliveryEntry[];
  }>> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 9999 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    return err("validation", "La página de entrega es inválida.");
  }
  const job = await readBound(client, session, bound);
  if (!job.ok) return job;
  if (job.data.state !== "ready" || !dateInFuture(job.data.expires_at) ||
      offset >= job.data.expected_entries) {
    return err("forbidden", "La entrega no está lista o ya venció.");
  }
  const before = await samePlan(client, session, job.data);
  if (!before.ok) return before;
  try {
    const { data, error } = await createSupabaseServiceClient().rpc("export_package_delivery_page", {
      p_id: bound.jobId, p_actor: session.userId, p_offset: offset, p_limit: limit,
    });
    const rows = Array.isArray(data) ? data as PageRow[] : null;
    const sources = new Map(before.data.sources.map(source => [sourceKey(source), source]));
    const wanted = Math.min(limit, job.data.expected_entries - offset);
    if (error || !rows || rows.length !== wanted ||
        rows.some(row => !validPageRow(row, job.data, sources)) ||
        new Set(rows.map(fromEntry)).size !== rows.length) {
      return err("db_error", "El inventario listo ya no coincide. No se entregó una página parcial.");
    }
    const after = await samePlan(client, session, job.data);
    if (!after.ok) return after;
    const fresh = await readBound(client, session, bound);
    if (!fresh.ok || fresh.data.state !== "ready" || fresh.data.revision !== job.data.revision ||
        !dateInFuture(fresh.data.expires_at)) {
      return err("forbidden", "La entrega perdió autorización antes de mostrar el inventario.");
    }
    return ok({ expectedEntries: job.data.expected_entries, expiresAt: job.data.expires_at,
      preparedAt: rows[0].prepared_at, entries: rows.map(({ actual_fragments: _actual,
        expected_entries: _expected, expires_at: _expires, prepared_at: _prepared, ...entry }) => entry) });
  } catch {
    return err("db_error", "No se pudo verificar la página de entrega.");
  }
}

export async function readPackageFragment(client: Client, session: ActiveSession,
  bound: Bound, entryId: string, ordinal: number,
  beforeFinalValidation: () => Promise<void> = async () => {},
): Promise<Result<{
    bytes: Uint8Array; sha256: string; fileSha256: string; totalFragments: number;
  }>> {
  if (!UUID.test(entryId) || !Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= 10000) {
    return err("validation", "El fragmento solicitado es inválido.");
  }
  const job = await readBound(client, session, bound);
  if (!job.ok) return job;
  if (job.data.state !== "ready" || !dateInFuture(job.data.expires_at)) {
    return err("forbidden", "La entrega no está lista o ya venció.");
  }
  const before = await samePlan(client, session, job.data);
  if (!before.ok) return before;
  try {
    const { data, error } = await createSupabaseServiceClient().rpc("export_package_delivery_fragment", {
      p_id: bound.jobId, p_actor: session.userId, p_entry: entryId, p_ordinal: ordinal,
    });
    const row = Array.isArray(data) && data.length === 1 ? data[0] as FragmentRow : null;
    const source = row && before.data.sources.find(item => sourceKey(item) === fromEntry(row));
    if (error || !row || row.entry_id !== entryId || row.kind === "withdrawn_document" ||
        !["json", "document", "signature"].includes(row.kind) ||
        !UUID.test(row.source_id) || row.source_index < 0 || row.source_index > 1 ||
        (row.kind === "json" ? row.source_id !== job.data.paciente_id || row.source_index !== 0 ||
          row.source_hash_kind !== "not_applicable" || row.source_sha256 !== null :
          !source || row.source_hash_kind !== (source.recordedSha256 ? "recorded" : "not_recorded") ||
          row.source_sha256 !== source.recordedSha256) ||
        (row.source_hash_kind === "recorded" && row.source_sha256 !== row.computed_sha256) ||
        !Number.isSafeInteger(row.expected_fragments) || ordinal >= row.expected_fragments ||
        !Number.isSafeInteger(row.fragment_bytes) || row.fragment_bytes < 1 ||
        row.fragment_bytes > PACKAGE_CHUNK_BYTES || !SHA.test(row.fragment_sha256) ||
        !SHA.test(row.computed_sha256 ?? "") || row.expires_at !== job.data.expires_at ||
        !dateInFuture(row.expires_at)) {
      return err("forbidden", "La fuente ya no permite entregar ese fragmento.");
    }
    const path = packageFragmentPath(bound.jobId, entryId, ordinal);
    const { data: blob, error: storageError } = await privateExportBucket().download(path, {},
      { signal: AbortSignal.timeout(15000), cache: "no-store" });
    if (storageError || !blob || blob.size !== row.fragment_bytes ||
        blob.size > PACKAGE_CHUNK_BYTES) {
      return err("db_error", "No se pudo verificar el fragmento privado.");
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (sha256(bytes) !== row.fragment_sha256) {
      return err("db_error", "El fragmento privado no coincide con el inventario.");
    }
    const fileSha256 = row.computed_sha256;
    if (fileSha256 === null) return err("db_error", "El archivo no tiene verificación completa.");
    await beforeFinalValidation();
    const after = await samePlan(client, session, job.data);
    if (!after.ok) return after;
    const fresh = await readBound(client, session, bound);
    if (!fresh.ok || fresh.data.state !== "ready" || fresh.data.revision !== job.data.revision ||
        !dateInFuture(fresh.data.expires_at)) {
      return err("forbidden", "La entrega perdió autorización durante la lectura.");
    }
    return ok({ bytes, sha256: row.fragment_sha256,
      fileSha256, totalFragments: row.expected_fragments });
  } catch {
    return err("db_error", "No se pudo verificar el fragmento privado.");
  }
}
