import { createHash } from "node:crypto";
import { readCompleteCollection } from "@/lib/db/complete-collection";

export const CLINICAL_EXPORT_MAX_BYTES = 4 * 1024 * 1024;
type Page<T> = { data: T[] | null; count: number | null; error: { message: string } | null };
/** Two bounded reads detect observable edits, including equal-count changes.
 * This is not a cross-table transaction or an attachment snapshot. */
export async function readVerifiedClinicalCollection<T extends { id: string }>(fetchPage: (from: number, to: number) => PromiseLike<Page<T>>) {
  const read = async () => {
    let bytes = 0;
    return readCompleteCollection<T>(async (from, to) => {
      const result = await fetchPage(from, to);
      if (!Number.isSafeInteger(result.count) || result.count === null || result.count < 0 || result.count > 10000 || (result.data?.length ?? 0) > 500) throw new Error("clinical_export_limit");
      bytes += Buffer.byteLength(JSON.stringify(result.data));
      if (bytes > CLINICAL_EXPORT_MAX_BYTES) throw new Error("clinical_export_limit");
      return result;
    });
  };
  const first = await read();
  if (first.error) return first;
  const fingerprint = (rows: T[]) => createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  const second = await read();
  if (second.error || fingerprint(first.data) !== fingerprint(second.data)) return { data: null, error: { message: "La historia cambió o no se pudo verificar completa. Reintentá." } } as const;
  return first;
}
