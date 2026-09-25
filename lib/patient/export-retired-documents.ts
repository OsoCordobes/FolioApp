import "server-only";

import { err, ok, type Result } from "@/lib/db/errors";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { readVerifiedClinicalCollection } from "./verified-collection";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;
export type RetiredDocumentMetadata = { id: string; organization_id: string; paciente_id: string;
  sesion_id: string | null; tipo: string; mime_type: string; tamanio_bytes: number;
  content_sha256: string | null; fecha_estudio: string | null;
  descripcion_cifrado: string | null; subido_por_id: string | null;
  consentimiento_id: string | null; created_at: string; deleted_at: string };
const keys = new Set(["id", "organization_id", "paciente_id", "sesion_id", "tipo",
  "mime_type", "tamanio_bytes", "content_sha256", "fecha_estudio",
  "descripcion_cifrado", "subido_por_id", "consentimiento_id", "created_at", "deleted_at"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The RPC returns no Storage identity. Two complete passes detect a changed
 * inventory; a count of all documents catches gaps across active and retired
 * RLS sources. The caller must also compare active + retired IDs and totals. */
export async function readRetiredDocumentMetadata(
  client: Client, organizationId: string, pacienteId: string,
): Promise<Result<{ rows: RetiredDocumentMetadata[]; allTotal: number }>> {
  if (!organizationId || !pacienteId) {
    return err("validation", "No se pudo verificar el inventario documental.");
  }
  let allTotal: number | null = null;
  const collection = await readVerifiedClinicalCollection<RetiredDocumentMetadata>(async (from, to) => {
    const { data, error } = await client.rpc("export_retired_document_metadata", {
      p_org: organizationId, p_patient: pacienteId, p_offset: from, p_limit: to - from + 1,
    });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) throw new Error("retired_page_unavailable");
    const page = data as { total?: unknown; all_total?: unknown; rows?: unknown };
    if (!Number.isSafeInteger(page.total) || (page.total as number) < 0 ||
        !Number.isSafeInteger(page.all_total) || (page.all_total as number) < (page.total as number) ||
        (page.all_total as number) > 10000 || !Array.isArray(page.rows) || page.rows.length > 500 ||
        (allTotal !== null && allTotal !== page.all_total)) throw new Error("retired_page_changed");
    allTotal = page.all_total as number;
    for (const raw of page.rows) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
          Object.keys(raw).length !== keys.size || Object.keys(raw).some(key => !keys.has(key))) {
        throw new Error("retired_metadata_shape");
      }
      const row = raw as RetiredDocumentMetadata;
      if (!UUID.test(row.id) || row.organization_id !== organizationId ||
          row.paciente_id !== pacienteId || typeof row.deleted_at !== "string" ||
          !Number.isFinite(Date.parse(row.deleted_at)) ||
          !Number.isSafeInteger(row.tamanio_bytes) || row.tamanio_bytes < 1 ||
          row.tamanio_bytes > 50 * 1024 * 1024 ||
          (row.content_sha256 !== null && !/^[a-f0-9]{64}$/.test(row.content_sha256)) ||
          (row.descripcion_cifrado !== null && !/^\\x[0-9a-f]+$/.test(row.descripcion_cifrado))) {
        throw new Error("retired_metadata_invalid");
      }
    }
    return { data: page.rows as RetiredDocumentMetadata[], count: page.total as number, error: null };
  });
  if (collection.error || allTotal === null) {
    return err("db_error", "No se pudo verificar todo el inventario documental.");
  }
  return ok({ rows: collection.data, allTotal });
}
