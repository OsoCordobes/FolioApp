import { PACKAGE_CHUNK_BYTES, packageFragmentPath, sha256 } from "./export-jobs-chunks";

export interface PrivateFragmentStore {
  /** Upload must use upsert=false and must never accept a caller-supplied path. */
  upload(path: string, bytes: Uint8Array): Promise<boolean>;
  download(path: string): Promise<Uint8Array | null>;
}

/** A lost upload response is recoverable only when the object readback is
 * byte-identical. A conflicting object is never overwritten or registered. */
export async function putVerifiedFragment(
  store: PrivateFragmentStore, jobId: string, entryId: string,
  ordinal: number, bytes: Uint8Array,
): Promise<{ path: string; bytes: number; sha256: string }> {
  if (!bytes.byteLength || bytes.byteLength > PACKAGE_CHUNK_BYTES) throw new Error("invalid_package_fragment_size");
  const path = packageFragmentPath(jobId, entryId, ordinal);
  const expectedSha = sha256(bytes);
  try { await store.upload(path, bytes); } catch { /* Readback resolves an uncertain upload. */ }
  const readback = await store.download(path);
  if (!readback || readback.byteLength !== bytes.byteLength || sha256(readback) !== expectedSha) {
    throw new Error("package_fragment_readback_failed");
  }
  return { path, bytes: bytes.byteLength, sha256: expectedSha };
}
