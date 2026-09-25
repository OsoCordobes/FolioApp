import { createHash } from "node:crypto";

/** Private source metadata contributes to the digest but never appears in the
 * public package manifest or ledger. Source rows are already RLS scoped. */
export interface PackageSourceFingerprint {
  kind: "document" | "withdrawn_document" | "signature";
  sourceId: string;
  sourceIndex: number;
  storageBucket: string | null;
  storagePath: string | null;
  deletedAt: string | null;
  sizeBytes: number | null;
  recordedSha256: string | null;
}

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => compare(a, b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

const sourceKey = (s: PackageSourceFingerprint) => `${s.kind}:${s.sourceId}:${s.sourceIndex}`;

/** Only three builder-generated timestamps are excluded. Clinical timestamps,
 * source paths and recorded hashes remain part of the fingerprint. */
export function fingerprintExportPackage(
  clinicalExport: Record<string, unknown>, sources: PackageSourceFingerprint[],
): string {
  const normalized = JSON.parse(JSON.stringify(clinicalExport)) as Record<string, unknown>;
  delete normalized.exported_at;
  if (normalized.manifest && typeof normalized.manifest === "object" &&
      !Array.isArray(normalized.manifest)) {
    const manifest = normalized.manifest as Record<string, unknown>;
    delete manifest.lectura_iniciada_en;
    delete manifest.lectura_finalizada_en;
  }
  const sorted = [...sources].sort((a, b) => compare(sourceKey(a), sourceKey(b)));
  for (let i = 1; i < sorted.length; i++) {
    if (sourceKey(sorted[i]) === sourceKey(sorted[i - 1])) throw new Error("duplicate_package_source");
  }
  return createHash("sha256").update("folio.export-package.fingerprint.v1\0")
    .update(canonical({ clinicalExport: normalized, sources: sorted })).digest("hex");
}
