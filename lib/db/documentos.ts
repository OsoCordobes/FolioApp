/**
 * Folio · queries y mutations de Documento Clínico (M08 app layer).
 *
 * Adjuntos del paciente que viven en Supabase Storage:
 *   - RMN, TAC, radiografías, ecografías
 *   - Resultados de laboratorio
 *   - Recetas e informes de otros médicos
 *   - Fotos posturales (require consentimiento FOTOS firmado, validado por
 *     trigger SQL `documento_validate_consentimiento` en M08)
 *
 * Pattern mirrors lib/db/consentimientos.ts:
 *   1. La acción autenticada valida bytes y sube al bucket privado.
 *   2. createDocumentoClinico verifica el objeto y guarda alcance + hash.
 *   3. listDocumentosPaciente devuelve rutas que revalidan acceso en cada GET.
 *   4. deleteDocumentoClinico soft-deletes (deleted_at), preservando blob.
 *      Bucket cleanup queda para pseudonimización cron M25.
 *
 * Ley 26.529 art. 18 — retención mínima 10 años de historial clínico.
 * Por eso el delete es lógico, no físico. La pseudonimización cron es la
 * única que borra blobs (al ejecutar tras 30 días de deletion_requested_at).
 */

import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { capabilitiesFor } from "@/lib/auth/capabilities";
import { readCompleteCollection } from "./complete-collection";
import { CLINICAL_BUCKET, CLINICAL_UPLOAD_MAX_BYTES, CLINICAL_LEGACY_MAX_BYTES, clinicalObjectPath, inspectClinicalFile } from "@/lib/storage/clinical-files";

import { tryDecrypt, encryptColumn } from "@/lib/crypto";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

import { err, ok, type Result } from "./errors";
import { getActiveSession } from "./session";

const BUCKET = CLINICAL_BUCKET;
const MAX_BYTES = CLINICAL_UPLOAD_MAX_BYTES;

const TIPO_DOCUMENTO = [
  "RMN", "TAC", "RADIOGRAFIA", "ECOGRAFIA",
  "LABORATORIO", "RECETA_EXTERNA", "INFORME_EXTERNO",
  "FOTO_POSTURAL", "OTRO",
] as const;
type TipoDocumento = (typeof TIPO_DOCUMENTO)[number];

// ─── Schemas Zod ────────────────────────────────────────────────────────

const createSchema = z.object({
  pacienteId: z.string().uuid(),
  sesionId: z.string().uuid().optional(),
  tipo: z.enum(TIPO_DOCUMENTO),
  storagePath: z
    .string()
    .regex(
      /^documentos-clinicos\/[a-f0-9-]+\/[a-f0-9-]+\/[a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+$/,
      "storage_path no respeta el formato bucket/{org}/{paciente}/{file}.{ext}",
    ),
  mimeType: z.string().min(1).max(120),
  tamanioBytes: z.number().int().positive().max(MAX_BYTES),
  fechaEstudio: z.string().date().optional(),
  descripcion: z.string().max(2000).optional(),
  consentimientoId: z.string().uuid().optional(),   // requerido para FOTO_POSTURAL (trigger valida)
});

export type CreateDocumentoInput = z.infer<typeof createSchema>;

const listSchema = z.object({
  pacienteId: z.string().uuid(),
  tipo: z.enum(TIPO_DOCUMENTO).optional(),
  sesionId: z.string().uuid().optional(),
});

// ─── Types ──────────────────────────────────────────────────────────────

export interface DocumentoClinicoRow {
  id: string;
  paciente_id: string;
  sesion_id: string | null;
  tipo: TipoDocumento;
  storage_path: string;
  mime_type: string;
  tamanio_bytes: number;
  fecha_estudio: string | null;
  descripcion: string | null;                         // descifrado al leer
  subido_por_id: string;
  consentimiento_id: string | null;
  created_at: string;
}

export interface DocumentoConDownloadUrl extends DocumentoClinicoRow {
  /** Same-origin endpoint: every GET rechecks current session and patient access. */
  downloadUrl: string;
}

// ─── Acciones públicas ──────────────────────────────────────────────────

/**
 * Registra un objeto subido por la acción del servidor, después de verificar
 * nuevamente su contenido y el acceso actual al paciente. Cifra la descripción.
 *
 * Para FOTO_POSTURAL, `consentimientoId` debe apuntar a un consentimiento
 * FOTOS vigente del mismo paciente — el trigger documento_validate_consentimiento
 * (M08) valida y rechaza el INSERT si no se cumple.
 */
export async function createDocumentoClinico(input: CreateDocumentoInput): Promise<Result<{ id: string }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return err("validation", "Datos del documento inválidos.");
  if (parsed.data.tipo === "FOTO_POSTURAL" && !parsed.data.consentimientoId) return err("validation", "La foto postural requiere un consentimiento FOTOS vigente.");
  const access = await documentAccess(parsed.data.pacienteId);
  if (!access.ok) return access;
  const { session, client } = access.data;
  const objectPath = clinicalObjectPath(parsed.data.storagePath, session.organizationId, parsed.data.pacienteId);
  if (!objectPath) return err("forbidden", "El archivo no corresponde a este paciente.");
  if (parsed.data.sesionId) {
    const { data, error } = await client.from("sesion").select("id")
      .eq("id", parsed.data.sesionId).eq("organization_id", session.organizationId).eq("paciente_id", parsed.data.pacienteId).maybeSingle();
    if (error) return err("db_error", "No pudimos verificar la sesión.");
    if (!data) return err("forbidden", "La sesión no corresponde al paciente o no está disponible.");
  }
  const service = createSupabaseServiceClient();
  try {
    const { data: blob, error } = await service.storage.from(BUCKET).download(objectPath, {}, { signal: AbortSignal.timeout(15000), cache: "no-store" });
    if (error || !blob) return err("db_error", "No pudimos verificar el archivo subido.");
    if (blob.size !== parsed.data.tamanioBytes || blob.size > MAX_BYTES) return err("validation", "El tamaño real del archivo no coincide o supera 4 MiB.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const inspected = inspectClinicalFile(bytes);
    if (!inspected.ok) return inspected;
    if (inspected.data.mime !== parsed.data.mimeType) return err("validation", "El contenido no coincide con el tipo del archivo.");
    // Upload/download may take time: recheck current Auth/MFA and patient RLS before service write.
    const current = await documentAccess(parsed.data.pacienteId);
    if (!current.ok) return current;
    if (current.data.session.organizationId !== session.organizationId || current.data.session.memberId !== session.memberId) return err("forbidden", "La sesión cambió. Intentá nuevamente.");
    const { data, error: insertError } = await service.from("documento_clinico").insert({
      organization_id: session.organizationId, paciente_id: parsed.data.pacienteId, sesion_id: parsed.data.sesionId ?? null,
      tipo: parsed.data.tipo, storage_path: parsed.data.storagePath, storage_bucket: BUCKET,
      mime_type: inspected.data.mime, tamanio_bytes: bytes.length, content_sha256: createHash("sha256").update(bytes).digest("hex"), validated_at: new Date().toISOString(),
      fecha_estudio: parsed.data.fechaEstudio ?? null, descripcion_cifrado: encryptColumn(parsed.data.descripcion ?? null),
      subido_por_id: session.memberId, consentimiento_id: parsed.data.consentimientoId ?? null,
    }).select("id").single();
    if (insertError || !data) return err("db_error", "No pudimos registrar el documento.");
    return ok({ id: String(data.id) });
  } catch { return err("network", "No pudimos verificar el archivo. Intentá nuevamente."); }
}

async function documentAccess(pacienteId: string) {
  const session = await getActiveSession();
  if (!session.ok) return session;
  if (!capabilitiesFor(session.data.role, session.data.esColegiado).canReadClinical) return err("forbidden", "No tenés acceso a los documentos clínicos.");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.from("paciente").select("id")
    .eq("id", pacienteId).eq("organization_id", session.data.organizationId).is("deleted_at", null).is("pseudonimizado_en", null).maybeSingle();
  if (error) return err("db_error", "No pudimos verificar el acceso al paciente.");
  if (!data) return err("not_found", "Paciente no encontrado.");
  return ok({ session: session.data, client });
}

/**
 * Lista documentos vigentes (no soft-deleted) de un paciente. Devuelve
 * cada uno con una ruta autenticada para enlace o vista previa.
 */
export async function listDocumentosPaciente(input: z.infer<typeof listSchema>): Promise<Result<DocumentoConDownloadUrl[]>> {
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) return err("validation", "Filtros inválidos.");
  const access = await documentAccess(parsed.data.pacienteId);
  if (!access.ok) return access;
  const { client, session } = access.data;
  const read = await readCompleteCollection<{ id: string } & Record<string, unknown>>((from, to) => {
    let query = client.from("documento_clinico").select("*", { count: "exact" })
      .eq("organization_id", session.organizationId).eq("paciente_id", parsed.data.pacienteId).is("deleted_at", null)
      .order("id", { ascending: true }).range(from, to);
    if (parsed.data.tipo) query = query.eq("tipo", parsed.data.tipo);
    if (parsed.data.sesionId) query = query.eq("sesion_id", parsed.data.sesionId);
    return query;
  });
  if (read.error) return err("db_error", "No pudimos cargar todos los documentos.");
  const rows: DocumentoConDownloadUrl[] = [];
  for (const row of read.data) {
    if (!clinicalObjectPath(String(row.storage_path), session.organizationId, parsed.data.pacienteId) || row.storage_bucket !== BUCKET) return err("db_error", "Un documento requiere revisión de su ubicación.");
    rows.push({ id: String(row.id), paciente_id: String(row.paciente_id), sesion_id: row.sesion_id as string | null,
      tipo: row.tipo as TipoDocumento, storage_path: String(row.storage_path), mime_type: String(row.mime_type), tamanio_bytes: Number(row.tamanio_bytes),
      fecha_estudio: row.fecha_estudio as string | null, descripcion: tryDecrypt(row.descripcion_cifrado as Buffer | null, "documento.descripcion"),
      subido_por_id: String(row.subido_por_id), consentimiento_id: row.consentimiento_id as string | null, created_at: String(row.created_at),
      downloadUrl: `/api/documentos/${row.id}/archivo`,
    });
  }
  return ok(rows.sort((a, b) => (b.fecha_estudio ?? b.created_at).localeCompare(a.fecha_estudio ?? a.created_at)));
}

/**
 * Soft-delete: marca deleted_at. El blob en storage queda hasta que el cron
 * de pseudonimización (M25) lo limpie. Solo OWNER y DIRECTOR — coherente con
 * la storage.objects DELETE policy de M27.
 */
export async function deleteDocumentoClinico(
  documentoId: string,
): Promise<Result<void>> {
  if (!z.string().uuid().safeParse(documentoId).success) {
    return err("validation", "ID inválido.");
  }
  const session = await getActiveSession();
  if (!session.ok) return session;
  if (session.data.role !== "OWNER" && session.data.role !== "DIRECTOR") {
    return err("forbidden", "Solo OWNER o DIRECTOR puede borrar documentos clínicos.");
  }

  const access = await authorizedDocument(documentoId);
  if (!access.ok) return access;
  const service = createSupabaseServiceClient();
  const { data, error } = await service.from("documento_clinico")
    .update({ deleted_at: new Date().toISOString() }).eq("id", documentoId)
    .eq("organization_id", session.data.organizationId).is("deleted_at", null).select("id").maybeSingle();
  if (error) return err("db_error", "No pudimos retirar el documento.");
  if (!data) return err("not_found", "Documento no encontrado.");
  return ok(undefined);
}

/**
 * Autoriza el documento y su paciente antes de cualquier acceso privilegiado.
 */
async function authorizedDocument(documentoId: string) {
  if (!z.string().uuid().safeParse(documentoId).success) return err("validation", "ID inválido.");
  const session = await getActiveSession();
  if (!session.ok) return session;
  if (!capabilitiesFor(session.data.role, session.data.esColegiado).canReadClinical) return err("forbidden", "No tenés acceso a los documentos clínicos.");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.from("documento_clinico").select("*")
    .eq("id", documentoId).eq("organization_id", session.data.organizationId).is("deleted_at", null).maybeSingle();
  if (error) return err("db_error", "No pudimos verificar el documento.");
  if (!data) return err("not_found", "Documento no encontrado.");
  const path = clinicalObjectPath(String(data.storage_path), session.data.organizationId, String(data.paciente_id));
  if (!path || data.storage_bucket !== BUCKET) return err("not_found", "Documento no disponible. Solicitá su revisión.");
  const access = await documentAccess(String(data.paciente_id));
  if (!access.ok) return access;
  if (access.data.session.organizationId !== session.data.organizationId) return err("forbidden", "La sesión cambió.");
  return ok({ row: data as Record<string, unknown>, path });
}

export async function getDocumentoDownloadUrl(documentoId: string): Promise<Result<string>> {
  const access = await authorizedDocument(documentoId);
  return access.ok ? ok(`/api/documentos/${documentoId}/archivo`) : access;
}
/** @deprecated Internal compatibility alias. Returns an authenticated route, never a bearer URL. */
export const refreshSignedUrl = getDocumentoDownloadUrl;

export async function readDocumentoDownload(documentoId: string): Promise<Result<{ blob: Blob; mime: string; filename: string }>> {
  const access = await authorizedDocument(documentoId);
  if (!access.ok) return access;
  const { row, path } = access.data;
  const expectedSize = Number(row.tamanio_bytes);
  if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0 || expectedSize > CLINICAL_LEGACY_MAX_BYTES) return err("validation", "El tamaño del documento requiere revisión.");
  try {
    const service = createSupabaseServiceClient();
    const { data: blob, error } = await service.storage.from(BUCKET).download(path, {}, { signal: AbortSignal.timeout(15000), cache: "no-store" });
    if (error || !blob) return err("db_error", "No pudimos recuperar el archivo.");
    if (blob.size !== expectedSize) return err("db_error", "El archivo cambió o está incompleto. Solicitá su revisión.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const inspected = inspectClinicalFile(bytes, CLINICAL_LEGACY_MAX_BYTES);
    if (!inspected.ok) return inspected;
    if (inspected.data.mime !== row.mime_type || (row.content_sha256 && createHash("sha256").update(bytes).digest("hex") !== row.content_sha256)) return err("db_error", "El contenido del archivo requiere revisión.");
    const current = await authorizedDocument(documentoId);
    if (!current.ok) return current;
    if (current.data.path !== path || current.data.row.content_sha256 !== row.content_sha256) return err("db_error", "El documento cambió. Intentá nuevamente.");
    return ok({ blob, mime: inspected.data.mime, filename: `documento-${documentoId}.${inspected.data.extension}` });
  } catch { return err("network", "No pudimos abrir el documento. Intentá nuevamente."); }
}

/**
 * Helper del servidor: genera una ubicación única en el alcance ya autorizado.
 * El llamador pasa una extensión detectada a partir del contenido.
 */
export function buildDocumentoStoragePath(params: {
  organizationId: string;
  pacienteId: string;
  filename: string;
}): string {
  const safeFilename = params.filename
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 80);
  // Usar randomUUID + extensión detectada para evitar colisiones.
  const ext = safeFilename.includes(".") ? safeFilename.split(".").pop() : "bin";
  const uuid = crypto.randomUUID();
  return `documentos-clinicos/${params.organizationId}/${params.pacienteId}/${uuid}.${ext}`;
}

// Pre-export del array de tipos para uso en UI (select options).
export { TIPO_DOCUMENTO };
export type { TipoDocumento };
