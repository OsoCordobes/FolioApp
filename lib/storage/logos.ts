/**
 * Folio · org-logos storage helpers.
 *
 * Pure path/URL builders + a client-side file validator. The actual upload
 * runs server-side from the onboarding action (so we keep service-role out
 * of the browser). This module imports nothing from @supabase/* — keeping it
 * dependency-free lets it be reused on edge / server / browser without bundling
 * concerns.
 *
 * Spec: docs/specs/2026-05-21-public-card-and-onboarding-redesign-plan.md §3 (F3).
 */

export const LOGO_BUCKET = "org-logos" as const;

/**
 * Client-side cap. The bucket itself caps at 512 KB; we cap at 500 KB to
 * leave ~12 KB headroom for header/metadata overhead in the upload pipeline.
 */
export const LOGO_MAX_BYTES = 500 * 1024;

export const LOGO_ALLOWED_MIME = ["image/png"] as const;

export const LOGO_OBJECT_NAME = "logo.png" as const;

/**
 * Storage object key for a given org's logo. Re-upload overwrites at this path.
 */
export function buildLogoPath(orgId: string): string {
  return `${orgId}/${LOGO_OBJECT_NAME}`;
}

/**
 * Public URL for an org's logo, against a Supabase project URL.
 * Trailing slashes on the supabaseUrl input are stripped so callers can
 * pass either form without worrying.
 */
export function buildLogoPublicUrl(args: { supabaseUrl: string; orgId: string }): string {
  const trimmed = args.supabaseUrl.replace(/\/+$/, "");
  return `${trimmed}/storage/v1/object/public/${LOGO_BUCKET}/${buildLogoPath(args.orgId)}`;
}

/**
 * Discriminated union: lets the call-site narrow on `code` for typed error
 * handling without parsing the human-readable Spanish error string.
 */
export type ValidateResult =
  | { ok: true }
  | { ok: false; error: string; code: "empty" | "wrong-mime" | "too-big" };

export function validateLogoFile(file: File): ValidateResult {
  if (file.size === 0) {
    return { ok: false, error: "El archivo está vacío.", code: "empty" };
  }
  if (!(LOGO_ALLOWED_MIME as readonly string[]).includes(file.type)) {
    return { ok: false, error: "Solo aceptamos PNG.", code: "wrong-mime" };
  }
  if (file.size > LOGO_MAX_BYTES) {
    return {
      ok: false,
      error: "El logo supera los 500 KB. Reducí el tamaño y volvé a intentar.",
      code: "too-big",
    };
  }
  return { ok: true };
}
