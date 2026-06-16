/**
 * Folio · professional-photos storage helpers (M62).
 *
 * Pure path/URL builders + a client-side file validator para la foto pública
 * del profesional. El upload real corre server-side (perfil-publico-actions);
 * este módulo no importa nada de @supabase/* (reusable en server/cliente).
 *
 * Path convention: professional-photos/<org_id>/<member_id>.<ext>
 *   — keyeado por member_id (no por nombre fijo como org-logos) porque hay un
 *     objeto por profesional dentro de la carpeta de la org.
 *   — la ext sale del MIME; al re-subir con otra ext, la action borra las
 *     siblings primero (evita huérfanos), ver uploadProfessionalPhoto.
 */

export const PHOTO_BUCKET = "professional-photos" as const;

/** Cliente caps a 500 KB; el bucket caps a 512 KB (12 KB de headroom). */
export const PHOTO_MAX_BYTES = 500 * 1024;

export const PHOTO_ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp"] as const;

/** MIME → extensión del objeto. El allowlist del bucket espeja estas 3. */
export const PHOTO_EXT_BY_MIME: Record<string, "png" | "jpg" | "webp"> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Todas las exts posibles — para borrar siblings al re-subir / quitar. */
export const PHOTO_ALL_EXTS = ["png", "jpg", "webp"] as const;

/** Object key para una ext dada: <org_id>/<member_id>.<ext>. */
export function buildPhotoPath(orgId: string, memberId: string, ext: string): string {
  return `${orgId}/${memberId}.${ext}`;
}

/** Las 3 keys posibles de un profesional (para remove idempotente). */
export function allPhotoPaths(orgId: string, memberId: string): string[] {
  return PHOTO_ALL_EXTS.map((ext) => buildPhotoPath(orgId, memberId, ext));
}

/** URL pública contra la project URL de Supabase (trailing slashes stripped). */
export function buildPhotoPublicUrl(args: {
  supabaseUrl: string;
  orgId: string;
  memberId: string;
  ext: string;
}): string {
  const trimmed = args.supabaseUrl.replace(/\/+$/, "");
  return `${trimmed}/storage/v1/object/public/${PHOTO_BUCKET}/${buildPhotoPath(args.orgId, args.memberId, args.ext)}`;
}

export type ValidateResult =
  | { ok: true }
  | { ok: false; error: string; code: "empty" | "wrong-mime" | "too-big" };

export function validatePhotoFile(file: File): ValidateResult {
  if (file.size === 0) {
    return { ok: false, error: "El archivo está vacío.", code: "empty" };
  }
  if (!(PHOTO_ALLOWED_MIME as readonly string[]).includes(file.type)) {
    return { ok: false, error: "Aceptamos JPG, PNG o WebP.", code: "wrong-mime" };
  }
  if (file.size > PHOTO_MAX_BYTES) {
    return {
      ok: false,
      error: "La foto supera los 500 KB. Reducí el tamaño y volvé a intentar.",
      code: "too-big",
    };
  }
  return { ok: true };
}
