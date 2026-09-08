import { decryptClinicalExportField } from "./export-decrypt";
import { err, ok, type Result } from "@/lib/db/errors";
import { clinicalObjectPath, CLINICAL_BUCKET } from "@/lib/storage/clinical-files";
import { firmaPathMatchesFicha } from "@/lib/db/portal-consentimientos";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { readVerifiedClinicalCollection } from "./verified-collection";

type Supa = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type Row = { id: string } & Record<string, unknown>;
export interface ClinicalEvidenceInventory {
  documentos: Record<string, unknown>[];
  consentimientos_evidencia: Record<string, unknown>[];
  evaluaciones_consentimiento: Record<string, unknown>[];
}
const nullable = (value: unknown) => value ?? null;
/** Decrypt only known encrypted snapshot fields; never pass unknown ciphertext through. */
function identitySnapshot(value: unknown, role: "patient" | "representative"): unknown {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_snapshot");
  const out: Record<string, unknown> = {};
  const allowed = new Set(role === "patient"
    ? ["id", "nombre_cifrado", "apellido_cifrado", "fecha_nacimiento"]
    : ["id", "nombre_cifrado", "numero_doc_cifrado", "vinculo", "restricciones_cifrado", "alcances", "verificado_por", "verificado_en"]);
  for (const [key, item] of Object.entries(value)) {
    if (!allowed.has(key)) throw new Error("unknown_snapshot_schema");
    if (key.endsWith("_cifrado")) out[key.slice(0, -8)] = decryptClinicalExportField(item);
    else {
      if (item != null && (key === "alcances" ? !Array.isArray(item) || item.some(scope => typeof scope !== "string") : typeof item !== "string")) throw new Error("invalid_snapshot_field");
      out[key] = item;
    }
  }
  return out;
}
/** All collections use the caller's authenticated RLS client; no Storage IO. */
export async function readClinicalEvidence(client: Supa, organizationId: string, pacienteId: string): Promise<Result<ClinicalEvidenceInventory>> {
  const read = (table: string) => readVerifiedClinicalCollection<Row>((from, to) => client.from(table).select("*", { count: "exact" })
    .eq("organization_id", organizationId).eq("paciente_id", pacienteId).order("id", { ascending: true }).range(from, to));
  const [documents, consents, assessments] = await Promise.all([read("documento_clinico"), read("consentimiento"), read("consentimiento_evaluacion")]);
  if (documents.error || consents.error || assessments.error) return err("db_error", "No se pudo verificar todo el inventario de documentos y consentimientos.");
  try {
    for (const row of [...documents.data, ...consents.data, ...assessments.data]) {
      if (row.organization_id !== organizationId || row.paciente_id !== pacienteId) throw new Error("invalid_evidence_scope");
    }
    const documentos = documents.data.map(r => {
      if (r.storage_bucket !== CLINICAL_BUCKET || !clinicalObjectPath(String(r.storage_path), organizationId, pacienteId)) throw new Error("invalid_document_scope");
      return { id: r.id, sesion_id: nullable(r.sesion_id), tipo: nullable(r.tipo), mime_type: nullable(r.mime_type),
        tamanio_bytes: nullable(r.tamanio_bytes), content_sha256: nullable(r.content_sha256), fecha_estudio: nullable(r.fecha_estudio),
        descripcion: decryptClinicalExportField(r.descripcion_cifrado), subido_por_id: nullable(r.subido_por_id),
        consentimiento_id: nullable(r.consentimiento_id), created_at: nullable(r.created_at), deleted_at: nullable(r.deleted_at),
        bytes_incluidos: false, bytes_verificados: false,
        download_url: r.deleted_at == null ? `/api/documentos/${r.id}/archivo` : null,
        disponibilidad: r.deleted_at == null ? "requiere_descarga_autorizada" : "retirado_sin_descarga" };
    });
    const assessmentIds = new Set(assessments.data.map(r => r.id));
    const consentimientos_evidencia = consents.data.map(r => {
      if (r.evaluacion_id != null && !assessmentIds.has(String(r.evaluacion_id))) throw new Error("missing_assessment");
      const participants = r.participantes == null ? [] : r.participantes;
      if (!Array.isArray(participants) || participants.length > 2) throw new Error("invalid_participants");
      if (r.evidencia_estado === "REGISTRADA" && (!r.evaluacion_id || !participants.length ||
        typeof r.texto_snapshot !== "string" || !Number.isSafeInteger(r.version_snapshot))) throw new Error("incomplete_recorded_evidence");
      const firmas = participants.length ? participants.map((p: Record<string, unknown>, index: number) => {
        if (!p || !firmaPathMatchesFicha(String(p.path), organizationId, pacienteId) || !/^[a-f0-9]{64}$/.test(String(p.sha256))) throw new Error("invalid_signature_scope");
        return { rol: nullable(p.rol), persona_ref: nullable(p.persona_ref), registrado_en: nullable(p.registrado_en), registrado_por: nullable(p.registrado_por),
          content_sha256: p.sha256, download_url: `/api/consentimientos/${r.id}/firma?participante=${index}`, bytes_incluidos: false, bytes_verificados: false };
      }) : r.firma_storage_path == null ? [] : (() => {
        if (!firmaPathMatchesFicha(String(r.firma_storage_path), organizationId, pacienteId)) throw new Error("invalid_signature_scope");
        return [{ rol: "NO_ACREDITADO_LEGADO", content_sha256: null, download_url: `/api/consentimientos/${r.id}/firma`, bytes_incluidos: false, bytes_verificados: false }];
      })();
      return { id: r.id, tipo: nullable(r.tipo), plantilla_id: nullable(r.plantilla_id), evaluacion_id: nullable(r.evaluacion_id),
        firmado_en: nullable(r.firmado_en), revocado_en: nullable(r.revocado_en), revocado_motivo: nullable(r.revocado_motivo),
        firmado_por_tutor_id: nullable(r.firmado_por_tutor_id), registrado_por_auth_uid: nullable(r.registrado_por_auth_uid), evidencia_estado: r.evidencia_estado ?? "LEGADO_PENDIENTE",
        texto_snapshot: nullable(r.texto_snapshot), version_snapshot: nullable(r.version_snapshot), firmas };
    });
    const evaluaciones_consentimiento = assessments.data.map(r => ({
      id: r.id, tipo: nullable(r.tipo), plantilla_id: nullable(r.plantilla_id), modo: nullable(r.modo), riesgo: nullable(r.riesgo),
      fundamento: decryptClinicalExportField(r.fundamento_cifrado), participacion: decryptClinicalExportField(r.participacion_cifrado),
      representante_id: nullable(r.representante_id), texto_snapshot: nullable(r.texto_snapshot), version_snapshot: nullable(r.version_snapshot),
      paciente_identidad_snapshot: identitySnapshot(r.paciente_identidad_snapshot, "patient"), representante_snapshot: identitySnapshot(r.representante_snapshot, "representative"),
      evaluado_por: nullable(r.evaluado_por), created_at: nullable(r.created_at), vigente_hasta: nullable(r.vigente_hasta), revocado_en: nullable(r.revocado_en),
      revocacion_motivo: decryptClinicalExportField(r.revocacion_motivo_cifrado),
    }));
    return ok({ documentos, consentimientos_evidencia, evaluaciones_consentimiento });
  } catch { return err("db_error", "Un documento o evidencia requiere revisión. No se generó una entrega incompleta."); }
}
