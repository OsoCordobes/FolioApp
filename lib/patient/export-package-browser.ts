import type { PackageArchiveEntry, PackageArchiveFragment, PackageArchivePage,
  PackageArchiveTransport } from "./export-package-archive";
import { PACKAGE_CAPACITY_MESSAGE } from "./export-package-capacity";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[a-f0-9]{64}$/;
const SESSION_PREFIX = "folio.export-package.v1.";
const MAX_FRAGMENT = 3 * 1024 * 1024;

export type BrowserPackageOperation = {
  job_id: string; paciente_id: string; organization_id: string; actor_user_id: string;
  state: "pending" | "leased" | "ready" | "failed" | "expired";
  revision: number; expected_entries: number; expires_at: string; lease_until: string | null;
};
export type BrowserPackageBinding = { patientId: string; operationId: string; jobId: string };
export type BrowserPackageScope = { userId: string; organizationId: string };
type Lease = { leaseToken: string; revision: number };

export class BrowserPackageFailure extends Error {
  constructor(public readonly code: "auth" | "denied" | "rate" | "changed" |
    "missing" | "unconfirmed" | "invalid" | "capacity", public readonly retryAfter = 0) {
    super(code);
  }
}

function validOperation(value: unknown, patientId: string, scope: BrowserPackageScope): value is BrowserPackageOperation {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return UUID.test(String(row.job_id)) && row.paciente_id === patientId &&
    row.organization_id === scope.organizationId && row.actor_user_id === scope.userId &&
    ["pending", "leased", "ready", "failed", "expired"].includes(String(row.state)) &&
    Number.isSafeInteger(row.revision) && Number(row.revision) >= 0 &&
    Number.isSafeInteger(row.expected_entries) && Number(row.expected_entries) >= 1 &&
    Number(row.expected_entries) <= 10000 &&
    Number.isFinite(Date.parse(String(row.expires_at))) &&
    (row.lease_until === null || Number.isFinite(Date.parse(String(row.lease_until))));
}

async function routeError(response: Response): Promise<BrowserPackageFailure> {
  if (response.type === "opaqueredirect" || response.redirected ||
      response.status >= 300 && response.status < 400 || response.status === 401) {
    return new BrowserPackageFailure("auth");
  }
  if (response.status === 403) return new BrowserPackageFailure("denied");
  if (response.status === 404) return new BrowserPackageFailure("missing");
  if (response.status === 413 &&
      (response.headers.get("content-type") ?? "").startsWith("application/json") &&
      Number(response.headers.get("content-length") ?? "0") <= 1024 && response.body) {
    try {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (length <= 1024) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.byteLength;
        chunks.push(part.value);
      }
      if (length > 1024) await reader.cancel();
      else {
        const bytes = new Uint8Array(length);
        let at = 0;
        for (const part of chunks) { bytes.set(part, at); at += part.byteLength; }
        const body = JSON.parse(new TextDecoder().decode(bytes)) as
          { error?: { code?: unknown; message?: unknown } };
        if (body.error?.code === "capacity" && body.error.message === PACKAGE_CAPACITY_MESSAGE) {
          return new BrowserPackageFailure("capacity");
        }
      }
    } catch { /* An unrelated 413 is unconfirmed. */ }
  }
  if (response.status === 409) return new BrowserPackageFailure("changed");
  if (response.status === 429) {
    const seconds = Number(response.headers.get("retry-after"));
    return new BrowserPackageFailure("rate", Number.isSafeInteger(seconds) ? seconds : 0);
  }
  return new BrowserPackageFailure("unconfirmed");
}

async function request(url: string, body?: Record<string, unknown>, signal?: AbortSignal) {
  if (signal?.aborted) throw new BrowserPackageFailure("auth");
  let response: Response;
  try {
    response = await fetch(url, { method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin", redirect: "manual", cache: "no-store",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(75_000)]) :
        AbortSignal.timeout(75_000) });
  } catch { throw new BrowserPackageFailure("unconfirmed"); }
  if (signal?.aborted) throw new BrowserPackageFailure("auth");
  if (response.type === "opaqueredirect" || response.redirected ||
      response.status >= 300 && response.status < 400 || !response.ok) {
    throw await routeError(response);
  }
  if (!(response.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    throw new BrowserPackageFailure("unconfirmed");
  }
  try {
    const result: unknown = await response.json();
    if (signal?.aborted) throw new BrowserPackageFailure("auth");
    if (!result || typeof result !== "object" || (result as { ok?: unknown }).ok !== true) {
      throw new BrowserPackageFailure("unconfirmed");
    }
    return result as Record<string, unknown>;
  } catch { throw new BrowserPackageFailure("unconfirmed"); }
}

function boundQuery(bound: BrowserPackageBinding) {
  return `patientId=${bound.patientId}&operationId=${bound.operationId}`;
}

function storageKey(scope: BrowserPackageScope, patientId: string) {
  if (!UUID.test(scope.userId) || !UUID.test(scope.organizationId) || !UUID.test(patientId)) {
    throw new BrowserPackageFailure("invalid");
  }
  return `${SESSION_PREFIX}${scope.userId}.${scope.organizationId}.${patientId}`;
}

export function readSavedPackageOperation(scope: BrowserPackageScope, patientId: string) {
  try {
    const value = sessionStorage.getItem(storageKey(scope, patientId));
    return value && UUID.test(value) ? value : null;
  } catch { return null; }
}

export function savePackageOperation(scope: BrowserPackageScope, patientId: string, operationId: string) {
  if (!UUID.test(operationId)) throw new BrowserPackageFailure("invalid");
  try { sessionStorage.setItem(storageKey(scope, patientId), operationId); }
  catch { throw new BrowserPackageFailure("unconfirmed"); }
}

export function discardSavedPackageOperation(scope: BrowserPackageScope, patientId: string) {
  try { sessionStorage.removeItem(storageKey(scope, patientId)); }
  catch { throw new BrowserPackageFailure("unconfirmed"); }
}

export async function readPackageStatus(scope: BrowserPackageScope, patientId: string, operationId: string,
  signal?: AbortSignal) {
  const result = await request(`/api/patient/export-package/operations/${operationId}?patientId=${patientId}`,
    undefined, signal);
  if (!validOperation(result.operation, patientId, scope)) throw new BrowserPackageFailure("unconfirmed");
  return result.operation;
}

export async function beginPackage(scope: BrowserPackageScope, patientId: string, operationId: string,
  signal?: AbortSignal) {
  const result = await request("/api/patient/export-package", { patientId, operationId }, signal);
  if (!validOperation(result.operation, patientId, scope)) throw new BrowserPackageFailure("unconfirmed");
  return result.operation;
}

function binding(patientId: string, operationId: string, operation: BrowserPackageOperation) {
  return { patientId, operationId, jobId: operation.job_id };
}

/** Retains one intent through uncertain responses. An unreadable status never
 * creates another job. A lost lease is reclaimed only after its expiry. */
export async function prepareBrowserPackage(scope: BrowserPackageScope, patientId: string,
  onProgress: (completed: number, total: number) => void = () => {},
  priorLease?: Lease,
  onLease: (lease: Lease) => void = () => {},
  signal?: AbortSignal,
): Promise<{ bound: BrowserPackageBinding; lease?: Lease }> {
  const active = () => { if (signal?.aborted) throw new BrowserPackageFailure("auth"); };
  active();
  let operationId = readSavedPackageOperation(scope, patientId);
  let operation: BrowserPackageOperation;
  if (operationId) {
    try { operation = await readPackageStatus(scope, patientId, operationId, signal); }
    catch (error) {
      if (!(error instanceof BrowserPackageFailure) || error.code !== "missing") throw error;
      // A confirmed absent operation may be submitted again with its original ID.
      active();
      operation = await beginPackage(scope, patientId, operationId, signal);
    }
  }
  else {
    operationId = crypto.randomUUID();
    savePackageOperation(scope, patientId, operationId);
    // The same operationId is retained even if this request's response is lost.
    operation = await beginPackage(scope, patientId, operationId, signal);
  }
  active();
  let bound = binding(patientId, operationId, operation);
  if (operation.state === "failed" || operation.state === "expired" ||
      Date.parse(operation.expires_at) <= Date.now()) throw new BrowserPackageFailure("changed");
  if (operation.state === "ready") return { bound };
  let lease = priorLease && operation.state === "leased" &&
    priorLease.revision === operation.revision &&
    operation.lease_until && Date.parse(operation.lease_until) > Date.now() ? priorLease : undefined;
  if (!lease) {
    if (operation.state === "leased" && operation.lease_until &&
        Date.parse(operation.lease_until) > Date.now()) {
      throw new BrowserPackageFailure("unconfirmed");
    }
    const result = await request(`/api/patient/export-package/${bound.jobId}/claim`,
      { patientId, operationId, revision: operation.revision }, signal);
    const value = result.lease as Record<string, unknown> | undefined;
    if (!value || !UUID.test(String(value.leaseToken)) ||
        !Number.isSafeInteger(value.revision) ||
        Number(value.revision) !== operation.revision + 1) throw new BrowserPackageFailure("unconfirmed");
    lease = { leaseToken: String(value.leaseToken), revision: Number(value.revision) };
  }
  onLease(lease);
  for (let sourceOrdinal = 0; sourceOrdinal < operation.expected_entries; sourceOrdinal++) {
    let complete = false;
    let previousRemaining = 17;
    let sourceEntryId: string | null = null;
    let calls = 0;
    while (!complete) {
      active();
      if (++calls > 17) throw new BrowserPackageFailure("unconfirmed");
      const result = await request(`/api/patient/export-package/${bound.jobId}/progress`,
        { patientId, operationId, leaseToken: lease.leaseToken,
          revision: lease.revision, sourceOrdinal }, signal);
      const progress = result.progress as Record<string, unknown> | undefined;
      if (!progress || !UUID.test(String(progress.entryId)) ||
          typeof progress.complete !== "boolean" ||
          !Number.isSafeInteger(progress.remainingFragments) ||
          Number(progress.remainingFragments) < 0 || Number(progress.remainingFragments) > 17 ||
          progress.complete === (Number(progress.remainingFragments) > 0) ||
          Number(progress.remainingFragments) >= previousRemaining ||
          sourceEntryId !== null && sourceEntryId !== progress.entryId) {
        throw new BrowserPackageFailure("unconfirmed");
      }
      previousRemaining = Number(progress.remainingFragments);
      sourceEntryId = String(progress.entryId);
      complete = progress.complete;
    }
    active();
    onProgress(sourceOrdinal + 1, operation.expected_entries);
  }
  active();
  const finished = await request(`/api/patient/export-package/${bound.jobId}/finish`,
    { patientId, operationId, leaseToken: lease.leaseToken, revision: lease.revision }, signal);
  if (finished.state !== "ready") throw new BrowserPackageFailure("unconfirmed");
  operation = await readPackageStatus(scope, patientId, operationId, signal);
  bound = binding(patientId, operationId, operation);
  if (operation.state !== "ready") throw new BrowserPackageFailure("unconfirmed");
  return { bound, lease };
}

export function packageArchiveTransport(bound: BrowserPackageBinding,
  signal?: AbortSignal): PackageArchiveTransport {
  return {
    async page(offset: number, limit: number): Promise<PackageArchivePage> {
      const result = await request(`/api/patient/export-package/${bound.jobId}/manifest?${boundQuery(bound)}&offset=${offset}&limit=${limit}`,
        undefined, signal);
      const manifest = result.manifest;
      if (!manifest || typeof manifest !== "object" ||
          !Array.isArray((manifest as { entries?: unknown }).entries)) {
        throw new BrowserPackageFailure("unconfirmed");
      }
      return manifest as PackageArchivePage;
    },
    async fragment(entry: PackageArchiveEntry, ordinal: number): Promise<PackageArchiveFragment> {
      if (signal?.aborted) throw new BrowserPackageFailure("auth");
      let response: Response;
      try {
        response = await fetch(`/api/patient/export-package/${bound.jobId}/entries/${entry.entry_id}/fragments/${ordinal}?${boundQuery(bound)}`,
          { credentials: "same-origin", redirect: "manual", cache: "no-store",
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(75_000)]) :
              AbortSignal.timeout(75_000) });
      } catch { throw new BrowserPackageFailure("unconfirmed"); }
      if (signal?.aborted) throw new BrowserPackageFailure("auth");
      if (response.type === "opaqueredirect" || response.redirected ||
          response.status >= 300 && response.status < 400 || !response.ok) throw await routeError(response);
      if (response.headers.get("content-type") !== "application/octet-stream") {
        throw new BrowserPackageFailure("unconfirmed");
      }
      const length = Number(response.headers.get("content-length"));
      const hash = response.headers.get("x-folio-fragment-sha256") ?? "";
      const fileHash = response.headers.get("x-folio-file-sha256") ?? "";
      const count = Number(response.headers.get("x-folio-fragment-count"));
      if (!Number.isSafeInteger(length) || length < 1 || length > MAX_FRAGMENT ||
          !SHA.test(hash) || !SHA.test(fileHash) ||
          !Number.isSafeInteger(count) || count < 1 || count > 17) {
        throw new BrowserPackageFailure("unconfirmed");
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (signal?.aborted) throw new BrowserPackageFailure("auth");
      if (bytes.byteLength !== length) throw new BrowserPackageFailure("unconfirmed");
      return { bytes, sha256: hash, fileSha256: fileHash, totalFragments: count };
    },
  };
}
