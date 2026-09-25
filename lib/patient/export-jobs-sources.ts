import "server-only";

import { err, ok, type Result } from "@/lib/db/errors";
import { firmaPathMatchesFicha } from "@/lib/db/portal-consentimientos";
import { CLINICAL_BUCKET, CLINICAL_LEGACY_MAX_BYTES, clinicalObjectPath } from "@/lib/storage/clinical-files";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { readVerifiedClinicalCollection } from "./verified-collection";
import type { PackageSourceFingerprint } from "./export-jobs-fingerprint";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type Row = { id: string } & Record<string, unknown>;
const SHA = /^[a-f0-9]{64}$/;
const SIGNATURE_BUCKET = "consentimientos-firmados";
const SIGNATURE_PATH = /^consentimientos-firmados\/[0-9a-f-]+\/[0-9a-f-]+\/[a-zA-Z0-9_.-]+$/;

/** Contains private paths. This type may only flow through server-side worker
 * code, never a route response, audit payload or persisted job JSON. */
export interface PackageSource extends PackageSourceFingerprint {
  mimeType: string | null;
}

type PublicDocument = {
  id: string; deleted_at: string | null; content_sha256: string | null;
  tamanio_bytes: number; mime_type: string; bytes_incluidos: boolean;
  download_url: string | null; disponibilidad: string;
};
type PublicConsent = {
  id: string; revocado_en: string | null;
  firmas: { rol: string | null; persona_ref?: string | null; registrado_en?: string | null;
    registrado_por?: string | null; content_sha256: string | null;
    bytes_incluidos: boolean; download_url: string }[];
};

function evidenceFromExport(value: unknown): { documents: PublicDocument[]; consents: PublicConsent[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_export");
  const history = (value as Record<string, unknown>).historia_clinica;
  if (!history || typeof history !== "object" || Array.isArray(history)) throw new Error("missing_clinical_history");
  const documents = (history as Record<string, unknown>).documentos;
  const consents = (history as Record<string, unknown>).consentimientos_evidencia;
  if (!Array.isArray(documents) || !Array.isArray(consents)) throw new Error("missing_evidence_inventory");
  return { documents: documents as PublicDocument[], consents: consents as PublicConsent[] };
}

function uniqueById<T extends { id: string }>(rows: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    if (typeof row?.id !== "string" || map.has(row.id)) throw new Error("duplicate_source");
    map.set(row.id, row);
  }
  return map;
}

function assertScope(row: Row, organizationId: string, pacienteId: string) {
  if (row.organization_id !== organizationId || row.paciente_id !== pacienteId) throw new Error("invalid_scope");
}

/** Both raw collections are read twice under the caller's authenticated RLS
 * client. Counts and exact public inventory correspondence are required; a
 * changed or unreadable later page rejects the entire plan. */
export async function readPackageSourcePlan(
  client: Client, organizationId: string, pacienteId: string, clinicalExport: unknown,
): Promise<Result<PackageSource[]>> {
  const read = (table: string, columns: string) => readVerifiedClinicalCollection<Row>(async (from, to) => {
    const page = await client.from(table).select(columns, { count: "exact" })
      .eq("organization_id", organizationId).eq("paciente_id", pacienteId)
      .order("id", { ascending: true }).range(from, to);
    return { data: page.data as unknown as Row[] | null, count: page.count, error: page.error };
  });
  try {
    const publicEvidence = evidenceFromExport(clinicalExport);
    const documents = await read("documento_clinico",
      "id,organization_id,paciente_id,storage_bucket,storage_path,deleted_at,tamanio_bytes,content_sha256,mime_type");
    if (documents.error || !documents.data) throw new Error("document_read_failed");
    const consents = await read("consentimiento",
      "id,organization_id,paciente_id,firma_storage_path,participantes,revocado_en");
    if (consents.error || !consents.data) throw new Error("consent_read_failed");
    const publicDocuments = uniqueById(publicEvidence.documents);
    const publicConsents = uniqueById(publicEvidence.consents);
    if (documents.data.length !== publicDocuments.size || consents.data.length !== publicConsents.size) {
      throw new Error("incomplete_inventory");
    }
    const sources: PackageSource[] = [];
    for (const row of documents.data) {
      assertScope(row, organizationId, pacienteId);
      const item = publicDocuments.get(row.id);
      const storagePath = row.storage_path;
      const recorded = row.content_sha256 ?? null;
      const size = row.tamanio_bytes;
      const deletedAt = row.deleted_at ?? null;
      if (!item || row.storage_bucket !== CLINICAL_BUCKET || typeof storagePath !== "string" ||
          !clinicalObjectPath(storagePath, organizationId, pacienteId) ||
          !Number.isSafeInteger(size) || (size as number) < 1 || (size as number) > CLINICAL_LEGACY_MAX_BYTES ||
          (deletedAt !== null && typeof deletedAt !== "string") ||
          (recorded !== null && (typeof recorded !== "string" || !SHA.test(recorded))) ||
          typeof row.mime_type !== "string" || !row.mime_type ||
          item.deleted_at !== deletedAt || item.content_sha256 !== recorded ||
          item.tamanio_bytes !== size || item.mime_type !== row.mime_type || item.bytes_incluidos !== false ||
          item.download_url !== (deletedAt === null ? `/api/documentos/${row.id}/archivo` : null) ||
          item.disponibilidad !== (deletedAt === null ? "requiere_descarga_autorizada" : "retirado_sin_descarga")) {
        throw new Error("document_inventory_mismatch");
      }
      sources.push({ kind: deletedAt === null ? "document" : "withdrawn_document",
        sourceId: row.id, sourceIndex: 0, storageBucket: CLINICAL_BUCKET,
        storagePath, deletedAt, sizeBytes: size as number, recordedSha256: recorded as string | null,
        mimeType: row.mime_type });
    }
    for (const row of consents.data) {
      assertScope(row, organizationId, pacienteId);
      const item = publicConsents.get(row.id);
      if (!item || !Array.isArray(item.firmas) ||
          (row.revocado_en != null && typeof row.revocado_en !== "string") ||
          item.revocado_en !== (row.revocado_en ?? null)) {
        throw new Error("consent_inventory_mismatch");
      }
      const participants = row.participantes == null ? [] : row.participantes;
      if (!Array.isArray(participants) || participants.length > 2) throw new Error("invalid_participants");
      const signatureRows = participants.length ? participants :
        row.firma_storage_path == null ? [] : [{ path: row.firma_storage_path, sha256: null }];
      if (signatureRows.length !== item.firmas.length) throw new Error("signature_count_mismatch");
      for (const [index, evidence] of signatureRows.entries()) {
        const publicSignature = item.firmas[index];
        const source = evidence as Record<string, unknown>;
        const storagePath = source.path;
        const recorded = source.sha256 ?? null;
        if (typeof storagePath !== "string" || !firmaPathMatchesFicha(storagePath, organizationId, pacienteId) ||
            !SIGNATURE_PATH.test(storagePath) || storagePath.includes("..") ||
            (participants.length > 0 && (typeof recorded !== "string" || !SHA.test(recorded))) ||
            (participants.length === 0 && recorded !== null) ||
            publicSignature?.content_sha256 !== recorded || publicSignature?.bytes_incluidos !== false ||
            publicSignature?.rol !== (participants.length ? (source.rol ?? null) : "NO_ACREDITADO_LEGADO") ||
            (participants.length > 0 && (publicSignature?.persona_ref !== (source.persona_ref ?? null) ||
              publicSignature?.registrado_en !== (source.registrado_en ?? null) ||
              publicSignature?.registrado_por !== (source.registrado_por ?? null))) ||
            publicSignature?.download_url !== `/api/consentimientos/${row.id}/firma${participants.length ? `?participante=${index}` : ""}`) {
          throw new Error("signature_inventory_mismatch");
        }
        sources.push({ kind: "signature", sourceId: row.id, sourceIndex: index,
          storageBucket: SIGNATURE_BUCKET, storagePath, deletedAt: null,
          sizeBytes: null, recordedSha256: recorded as string | null, mimeType: null });
      }
    }
    if (sources.length + 1 > 10000) throw new Error("too_many_sources");
    return ok(sources.sort((a, b) => a.kind.localeCompare(b.kind) ||
      a.sourceId.localeCompare(b.sourceId) || a.sourceIndex - b.sourceIndex));
  } catch {
    return err("db_error", "No se pudo verificar todo el inventario clínico. No se preparó una entrega parcial.");
  }
}
