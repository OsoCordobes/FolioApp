/** M134 expires jobs after 24 hours; progress permits 1200 requests per
 * one-hour fixed window (limitByKey). That window begins with a prior call,
 * possibly before this job exists, so a 24-hour job can touch 25 windows.
 * This generous ceiling avoids rejecting a theoretically possible job; it
 * never guarantees quota or sufficient time. */
export const PACKAGE_MAX_PROGRESS_CALLS = 1200 * 25;
export const PACKAGE_CAPACITY_MESSAGE =
  "Este inventario supera el volumen que puede prepararse antes del vencimiento. No se creó una entrega parcial.";

export function minimumPackageProgressCalls(sources: Array<{
  kind: "document" | "signature" | "withdrawn_document"; sizeBytes: number | null;
}>, chunkBytes: number): number | null {
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1) return null;
  let minimum = 1; // The JSON entry needs at least one progress request.
  for (const source of sources) {
    if (source.kind === "document") {
      if (!Number.isSafeInteger(source.sizeBytes) || source.sizeBytes === null ||
          source.sizeBytes < 1) return null;
      minimum += Math.ceil(source.sizeBytes / chunkBytes);
    } else if (source.kind === "signature" || source.kind === "withdrawn_document") {
      minimum += 1; // Signatures have no recorded size; withdrawn entries still register.
    } else return null;
  }
  return Number.isSafeInteger(minimum) ? minimum : null;
}
