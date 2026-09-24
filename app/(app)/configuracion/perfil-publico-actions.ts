"use server";

import { revalidatePath } from "next/cache";

/**
 * Folio · /configuracion → Perfil público (M62) · server actions.
 *
 * El profesional edita SU PROPIO perfil público (foto + bio + matrícula
 * visible) que la landing /book/[slug] muestra. Todas las actions operan sobre
 * el member de la sesión (getActiveContext → session.memberId): "self" siempre
 * permitido. La RLS del bucket (M62, self-or-director) es la defensa en
 * profundidad; acá el gate real es que el path se keyea con el PROPIO
 * member_id. Cada cambio queda en audit_log (Ley 26.529 art. 18); sin PHI.
 *
 * foto_publica_url y bio_publica son datos PÚBLICOS consentidos (no cifrados).
 * La matrícula vive en profile.matricula; mostrar_matricula solo togglea su
 * visibilidad pública (opt-in).
 */

import { getActiveContext } from "@/lib/db/active-context";
import { verifyMfaSession } from "@/lib/auth/mfa-access";
import { writeAuditEntry } from "@/lib/db/audit";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  PHOTO_BUCKET,
  PHOTO_EXT_BY_MIME,
  PHOTO_MAX_BYTES,
  allPhotoPaths,
  buildPhotoPath,
  buildPhotoPublicUrl,
} from "@/lib/storage/professional-photos";

export interface PerfilPublicoActionResult {
  ok: boolean;
  error?: string;
}

export interface UploadPhotoResult extends PerfilPublicoActionResult {
  fotoUrl?: string;
}

/** Refresh only this organization's public page after a consented profile edit. */
function revalidatePublicProfile(slug: string): void {
  revalidatePath(`/book/${slug}`);
  // The OG image is force-dynamic, so a removed photo is never served from
  // Folio's image cache. Third-party social previews have their own caches.
}

/** Sube/reemplaza la foto pública del profesional (member de la sesión). */
export async function uploadProfessionalPhoto(formData: FormData): Promise<UploadPhotoResult> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No recibimos un archivo." };
  if (file.size === 0) return { ok: false, error: "El archivo está vacío." };
  const ext = PHOTO_EXT_BY_MIME[file.type];
  if (!ext) return { ok: false, error: "Aceptamos JPG, PNG o WebP." };
  if (file.size > PHOTO_MAX_BYTES) return { ok: false, error: "La foto supera los 500 KB." };

  const ctx = await getActiveContext();
  if (!ctx.ok) return { ok: false, error: "Sesión expirada. Volvé a entrar." };
  const orgId = ctx.data.organization.id;
  const memberId = ctx.data.session.memberId;

  const service = createSupabaseServiceClient();

  // Borrar siblings de otra ext (evita huérfanos cuando el pro cambia de
  // formato — la key incluye la ext y el upsert solo pisa la misma key).
  await service.storage.from(PHOTO_BUCKET).remove(allPhotoPaths(orgId, memberId));

  const bytes = new Uint8Array(await file.arrayBuffer());
  const path = buildPhotoPath(orgId, memberId, ext);
  const { error: upErr } = await service.storage.from(PHOTO_BUCKET).upload(path, bytes, {
    contentType: file.type,
    upsert: true,
    cacheControl: "no-cache",
  });
  if (upErr) return { ok: false, error: `Error subiendo la foto: ${upErr.message}` };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const fotoUrl = `${buildPhotoPublicUrl({ supabaseUrl, orgId, memberId, ext })}?v=${Date.now()}`;

  const { error: dbErr } = await service
    .from("member")
    .update({ foto_publica_url: fotoUrl })
    .eq("id", memberId)
    .eq("organization_id", orgId);
  if (dbErr) return { ok: false, error: `Error guardando la foto: ${dbErr.message}` };

  await writeAuditEntry({
    organizationId: orgId,
    actorId: ctx.data.session.userId,
    actorRole: ctx.data.session.role,
    action: "member.perfil_publico.foto_update",
    resourceType: "member",
    resourceId: memberId,
    payload: { tiene_foto: true },
  });

  revalidatePublicProfile(ctx.data.organization.slug);

  return { ok: true, fotoUrl };
}

/** Quita la foto pública del profesional. Idempotente. */
export async function removeProfessionalPhoto(): Promise<PerfilPublicoActionResult> {
  const ctx = await getActiveContext();
  if (!ctx.ok) return { ok: false, error: "Sesión expirada." };
  const orgId = ctx.data.organization.id;
  const memberId = ctx.data.session.memberId;

  const service = createSupabaseServiceClient();
  const { error: rmErr } = await service.storage
    .from(PHOTO_BUCKET)
    .remove(allPhotoPaths(orgId, memberId));
  if (rmErr && !/not.?found/i.test(rmErr.message)) {
    return { ok: false, error: rmErr.message };
  }

  const { error: dbErr } = await service
    .from("member")
    .update({ foto_publica_url: null })
    .eq("id", memberId)
    .eq("organization_id", orgId);
  if (dbErr) return { ok: false, error: "No pude actualizar el perfil público. Reintentá." };

  await writeAuditEntry({
    organizationId: orgId,
    actorId: ctx.data.session.userId,
    actorRole: ctx.data.session.role,
    action: "member.perfil_publico.foto_remove",
    resourceType: "member",
    resourceId: memberId,
    payload: { tiene_foto: false },
  });

  revalidatePublicProfile(ctx.data.organization.slug);

  return { ok: true };
}

/** Guarda la bio pública (1-400 chars; vacío → null). */
export async function saveBioPublica(bioRaw: string): Promise<PerfilPublicoActionResult> {
  const bio = (bioRaw ?? "").trim();
  if (bio.length > 400) return { ok: false, error: "La bio no puede superar los 400 caracteres." };

  const ctx = await getActiveContext();
  if (!ctx.ok) return { ok: false, error: "Sesión expirada." };
  const orgId = ctx.data.organization.id;
  const memberId = ctx.data.session.memberId;

  const service = createSupabaseServiceClient();
  const { error } = await service
    .from("member")
    .update({ bio_publica: bio.length > 0 ? bio : null })
    .eq("id", memberId)
    .eq("organization_id", orgId);
  if (error) return { ok: false, error: `Error guardando la bio: ${error.message}` };

  await writeAuditEntry({
    organizationId: orgId,
    actorId: ctx.data.session.userId,
    actorRole: ctx.data.session.role,
    action: "member.perfil_publico.bio_update",
    resourceType: "member",
    resourceId: memberId,
    payload: { tiene_bio: bio.length > 0 },
  });

  revalidatePublicProfile(ctx.data.organization.slug);

  return { ok: true };
}

/** Togglea la visibilidad pública de la matrícula (opt-in). */
export async function setMostrarMatricula(mostrar: boolean): Promise<PerfilPublicoActionResult> {
  const ctx = await getActiveContext();
  if (!ctx.ok) return { ok: false, error: "Sesión expirada." };
  const orgId = ctx.data.organization.id;
  const memberId = ctx.data.session.memberId;

  const service = createSupabaseServiceClient();
  const { error } = await service
    .from("member")
    .update({ mostrar_matricula: mostrar })
    .eq("id", memberId)
    .eq("organization_id", orgId);
  if (error) return { ok: false, error: `Error guardando: ${error.message}` };

  await writeAuditEntry({
    organizationId: orgId,
    actorId: ctx.data.session.userId,
    actorRole: ctx.data.session.role,
    action: "member.perfil_publico.matricula_visibilidad",
    resourceType: "member",
    resourceId: memberId,
    payload: { mostrar_matricula: mostrar },
  });

  revalidatePublicProfile(ctx.data.organization.slug);

  return { ok: true };
}

/** Only the professional can publish or revoke their own Clinic page. */
export async function setOwnMiniwebConsent(enabled: boolean): Promise<PerfilPublicoActionResult> {
  if (typeof enabled !== "boolean") return { ok: false, error: "Opción inválida." };
  const client = await createSupabaseServerClient();
  const mfa = await verifyMfaSession(client);
  if (!mfa.ok) return { ok: false, error: mfa.error.message };
  const ctx = await getActiveContext();
  if (!ctx.ok || ctx.data.session.userId !== mfa.data.user.id ||
      ctx.data.organization.tipo !== "CLINICA" || !ctx.data.session.esColegiado) {
    return { ok: false, error: "Esta página personal no está disponible para tu cuenta." };
  }
  if (enabled && ctx.data.organization.optOutPublicListing) {
    return { ok: false, error: "El enlace público del consultorio debe estar habilitado primero." };
  }
  const memberId = ctx.data.session.memberId;
  const organizationId = ctx.data.organization.id;
  const { data: existing, error: readError } = await client.from("member_miniweb_consent")
    .select("enabled").eq("id", memberId).eq("organization_id", organizationId).maybeSingle();
  if (readError) return { ok: false, error: "No pudimos leer el estado actual. Recargá la página." };
  if ((existing?.enabled ?? false) === enabled) return { ok: true };
  const write = existing
    ? await client.from("member_miniweb_consent").update({ enabled })
      .eq("id", memberId).eq("organization_id", organizationId)
    : await client.from("member_miniweb_consent").insert({ id: memberId, organization_id: organizationId, enabled: true });
  if (write.error) {
    const { data: current } = await client.from("member_miniweb_consent")
      .select("enabled").eq("id", memberId).eq("organization_id", organizationId).maybeSingle();
    if (current?.enabled !== enabled) return { ok: false, error: "No pudimos confirmar el cambio. Recargá la página." };
  }
  revalidatePath(`/book/${ctx.data.organization.slug}/p/${memberId}`);
  revalidatePath(`/book/${ctx.data.organization.slug}`);
  revalidatePath("/configuracion");
  return { ok: true };
}
