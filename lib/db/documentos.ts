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
 *   1. UI sube archivo a bucket privado `documentos-clinicos` con upload signed.
 *   2. createDocumentoClinico guarda fila con storage_path + metadata.
 *   3. listDocumentosPaciente devuelve metadata + signed URLs (5 min TTL).
 *   4. deleteDocumentoClinico soft-deletes (deleted_at), preservando blob.
 *      Bucket cleanup queda para pseudonimización cron M25.
 *
 * Ley 26.529 art. 18 — retención mínima 10 años de historial clínico.
 * Por eso el delete es lógico, no físico. La pseudonimización cron es la
 * única que borra blobs (al ejecutar tras 30 días de deletion_requested_at).
 */

import { z } from "zod";

import { tryDecrypt, encryptColumn } from "@/lib/crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, mapSupabaseError, ok, type Result } from "./errors";
import { getActiveSession } from "./session";

const BUCKET = "documentos-clinicos";
const MAX_BYTES = 50 * 1024 * 1024;                  // M08 CHECK documento_tamanio_limite
const SIGNED_URL_TTL_SEC = 300;                      // 5 min

const TIPO_DOCUMENTO = [
  "RMN", "TAC", "RADIOGRAFIA", "ECOGRAFIA",
  "LABORATORIO", "RECETA_EXTERNA", "INFORME_EXTERNO",
  "FOTO_POSTURAL", "OTRO",
] as const;
type TipoDocumento = (typeof TIPO_DOCUMENTO)[number];

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg", "image/png", "image/webp", "image/heic",
  "image/tiff", "application/dicom",
]);

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

export interface DocumentoConSignedUrl extends DocumentoClinicoRow {
  /** Signed URL temporal (5 min TTL). Re-fetch al expirar. */
  signedUrl: string;
}

// ─── Acciones públicas ──────────────────────────────────────────────────

/**
 * Registra un documento ya subido al bucket. La UI debe haber llamado
 * supabase.storage.from("documentos-clinicos").upload(path, blob) antes y
 * pasar el `storagePath` resultante. Cifra `descripcion` si viene.
 *
 * Para FOTO_POSTURAL, `consentimientoId` debe apuntar a un consentimiento
 * FOTOS vigente del mismo paciente — el trigger documento_validate_consentimiento
 * (M08) valida y rechaza el INSERT si no se cumple.
 */
export async function createDocumentoClinico(
  input: CreateDocumentoInput,
): Promise<Result<{ id: string }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos del documento inválidos.", parsed.error.message);
  }
  if (!ALLOWED_MIME.has(parsed.data.mimeType)) {
    return err("validation", `Tipo de archivo no permitido: ${parsed.data.mimeType}.`);
  }
  if (parsed.data.tipo === "FOTO_POSTURAL" && !parsed.data.consentimientoId) {
    return err(
      "validation",
      "Para subir fotos posturales necesitás un consentimiento FOTOS firmado del paciente.",
    );
  }

  const session = await getActiveSession();
  if (!session.ok) return session;

  // Validación defensiva: el primer segmento del storagePath debe matchear la org.
  // Aunque el trigger M27 (storage.objects clinical write policy) lo verifica,
  // detectarlo acá da mejor error UX que un 403 opaco.
  const orgFromPath = parsed.data.storagePath.split("/")[1];
  if (orgFromPath !== session.data.organizationId) {
    return err(
      "forbidden",
      "El path del archivo no corresponde a tu organización.",
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("documento_clinico")
    .insert({
      organization_id: session.data.organizationId,
      paciente_id: parsed.data.pacienteId,
      sesion_id: parsed.data.sesionId ?? null,
      tipo: parsed.data.tipo,
      storage_path: parsed.data.storagePath,
      storage_bucket: BUCKET,
      mime_type: parsed.data.mimeType,
      tamanio_bytes: parsed.data.tamanioBytes,
      fecha_estudio: parsed.data.fechaEstudio ?? null,
      descripcion_cifrado: encryptColumn(parsed.data.descripcion ?? null),
      subido_por_id: session.data.memberId,
      consentimiento_id: parsed.data.consentimientoId ?? null,
    })
    .select("id")
    .single();

  if (error) {
    // Rollback opcional: el blob queda huérfano en storage si el INSERT falla.
    // Lo dejamos así porque la pseudonimización cron eventualmente limpia
    // archivos sin DB row (M25). El alternativa sería remove() acá; preferimos
    // no fallar dos veces.
    return err(mapSupabaseError(error).code, mapSupabaseError(error).message, error.message);
  }
  if (!data) return err("db_error", "No se creó el registro del documento.");
  return ok({ id: data.id });
}

/**
 * Lista documentos vigentes (no soft-deleted) de un paciente. Devuelve
 * cada uno con un signed URL listo para usar en `<a href>` o preview.
 * Los signed URLs duran 5 minutos; la UI debe re-fetch al hover/click si
 * pasó tiempo.
 */
export async function listDocumentosPaciente(
  input: z.infer<typeof listSchema>,
): Promise<Result<DocumentoConSignedUrl[]>> {
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Filtros inválidos.", parsed.error.message);
  }
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("documento_clinico")
    .select(
      "id, paciente_id, sesion_id, tipo, storage_path, mime_type, tamanio_bytes, fecha_estudio, descripcion_cifrado, subido_por_id, consentimiento_id, created_at",
    )
    .eq("organization_id", session.data.organizationId)
    .eq("paciente_id", parsed.data.pacienteId)
    .is("deleted_at", null)
    .order("fecha_estudio", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (parsed.data.tipo)     query = query.eq("tipo", parsed.data.tipo);
  if (parsed.data.sesionId) query = query.eq("sesion_id", parsed.data.sesionId);

  const { data, error } = await query;
  if (error) return err(mapSupabaseError(error).code, mapSupabaseError(error).message, error.message);

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const enriched: DocumentoConSignedUrl[] = await Promise.all(
    rows.map(async (row) => {
      const storagePath = String(row.storage_path);
      const pathInBucket = storagePath.replace(/^documentos-clinicos\//, "");
      let signedUrl = "";
      try {
        const { data: signed } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(pathInBucket, SIGNED_URL_TTL_SEC);
        signedUrl = signed?.signedUrl ?? "";
      } catch (e) {
        console.warn("[documentos] signed URL failed for", pathInBucket, e);
      }
      return {
        id: String(row.id),
        paciente_id: String(row.paciente_id),
        sesion_id: (row.sesion_id as string | null) ?? null,
        tipo: row.tipo as TipoDocumento,
        storage_path: storagePath,
        mime_type: String(row.mime_type),
        tamanio_bytes: Number(row.tamanio_bytes),
        fecha_estudio: (row.fecha_estudio as string | null) ?? null,
        descripcion: tryDecrypt(row.descripcion_cifrado as Buffer | null, "documento.descripcion"),
        subido_por_id: String(row.subido_por_id),
        consentimiento_id: (row.consentimiento_id as string | null) ?? null,
        created_at: String(row.created_at),
        signedUrl,
      };
    }),
  );

  return ok(enriched);
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

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("documento_clinico")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", documentoId)
    .eq("organization_id", session.data.organizationId)
    .is("deleted_at", null);

  if (error) return err(mapSupabaseError(error).code, mapSupabaseError(error).message, error.message);
  return ok(undefined);
}

/**
 * Helper para la UI: genera un fresh signed URL para un documento ya conocido.
 * Útil cuando el listado se cacheó hace > 5min y el link expiró.
 */
export async function refreshSignedUrl(
  documentoId: string,
): Promise<Result<string>> {
  if (!z.string().uuid().safeParse(documentoId).success) {
    return err("validation", "ID inválido.");
  }
  const session = await getActiveSession();
  if (!session.ok) return session;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("documento_clinico")
    .select("storage_path")
    .eq("id", documentoId)
    .eq("organization_id", session.data.organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data) {
    return err("not_found", "Documento no encontrado.");
  }
  const pathInBucket = String(data.storage_path).replace(/^documentos-clinicos\//, "");
  const { data: signed, error: urlErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(pathInBucket, SIGNED_URL_TTL_SEC);
  if (urlErr || !signed) {
    return err("db_error", "No pude generar el link.", urlErr?.message);
  }
  return ok(signed.signedUrl);
}

/**
 * Helper UI-side: dado paciente y archivo, devuelve el storage_path canónico
 * que la UI debe usar al hacer supabase.storage.upload(). Centraliza la
 * convención para que no haya drift entre llamadores.
 */
export function buildDocumentoStoragePath(params: {
  organizationId: string;
  pacienteId: string;
  filename: string;
}): string {
  const safeFilename = params.filename
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 80);
  // Usar randomUUID + extensión del filename original para evitar colisiones.
  const ext = safeFilename.includes(".") ? safeFilename.split(".").pop() : "bin";
  const uuid = crypto.randomUUID();
  return `documentos-clinicos/${params.organizationId}/${params.pacienteId}/${uuid}.${ext}`;
}

// Pre-export del array de tipos para uso en UI (select options).
export { TIPO_DOCUMENTO };
export type { TipoDocumento };
