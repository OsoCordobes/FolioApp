import { createHash } from "node:crypto";

export const PACKAGE_CHUNK_BYTES = 3 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function packageFragmentPath(jobId: string, entryId: string, ordinal: number): string {
  if (!UUID.test(jobId) || !UUID.test(entryId) || !Number.isSafeInteger(ordinal) ||
      ordinal < 0 || ordinal >= 10000) throw new Error("invalid_package_fragment_identity");
  return `${jobId}/${entryId}/${String(ordinal).padStart(5, "0")}.bin`;
}

export function packageChunks(bytes: Uint8Array): Uint8Array[] {
  if (!bytes.byteLength || bytes.byteLength > 50 * 1024 * 1024) throw new Error("invalid_package_source_size");
  const chunks: Uint8Array[] = [];
  for (let at = 0; at < bytes.byteLength; at += PACKAGE_CHUNK_BYTES) {
    chunks.push(bytes.subarray(at, Math.min(at + PACKAGE_CHUNK_BYTES, bytes.byteLength)));
  }
  return chunks;
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A persisted entry time freezes only builder-generated timestamps. It makes
 * the JSON bytes identical after an uncertain upload; clinical dates remain. */
export function frozenPackageJson(exportValue: Record<string, unknown>, registeredAt: string): Uint8Array {
  const at = new Date(registeredAt);
  if (!Number.isFinite(at.getTime())) throw new Error("invalid_package_capture_time");
  const value = JSON.parse(JSON.stringify(exportValue)) as Record<string, unknown>;
  value.exported_at = at.toISOString();
  if (!value.manifest || typeof value.manifest !== "object" || Array.isArray(value.manifest)) {
    throw new Error("missing_package_manifest");
  }
  const manifest = value.manifest as Record<string, unknown>;
  manifest.lectura_iniciada_en = at.toISOString();
  manifest.lectura_finalizada_en = at.toISOString();
  const bytes = Buffer.from(JSON.stringify(value, null, 2));
  if (!bytes.byteLength || bytes.byteLength > 4 * 1024 * 1024) throw new Error("invalid_package_json_size");
  return bytes;
}
