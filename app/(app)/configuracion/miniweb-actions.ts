"use server";

import { revalidatePath } from "next/cache";

import type { PublicLandingLayout } from "@/components/book-landing/book-landing-view";
import { verifyMfaSession } from "@/lib/auth/mfa-access";
import { extractGoogleMapsEmbedUrl } from "@/lib/book-landing/map-embed";
import { getActiveContext } from "@/lib/db/active-context";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

type SaveResult = { ok: true; value?: string | null } | { ok: false; error: string; uncertain?: boolean };

async function editableOrg() {
  const client = await createSupabaseServerClient();
  const mfa = await verifyMfaSession(client);
  if (!mfa.ok) return null;
  const ctx = await getActiveContext();
  if (!ctx.ok || ctx.data.session.userId !== mfa.data.user.id ||
      !["OWNER", "DIRECTOR"].includes(ctx.data.session.role)) return null;
  return ctx.data.organization;
}

export async function saveMiniwebLayoutAction(layout: PublicLandingLayout): Promise<SaveResult> {
  if (layout !== "perfil" && layout !== "consultorio") return { ok: false, error: "Disposición inválida." };
  const org = await editableOrg();
  if (!org) return { ok: false, error: "No tenés permiso para cambiar esta página." };
  const service = createSupabaseServiceClient();
  const { data, error } = await service.from("organization").update({ miniweb_layout: layout })
    .eq("id", org.id).is("deleted_at", null).select("id").maybeSingle();
  if (error || !data) return { ok: false, uncertain: true, error: "No pudimos confirmar la disposición. Recargá la página para verificarla." };
  revalidatePath(`/book/${org.slug}`);
  revalidatePath("/configuracion");
  return { ok: true };
}

/** Only the verified Google Share iframe src is stored; the address is a snapshot. */
export async function saveMiniwebMapAction(input: { snippet: string | null; expectedAddress: string }): Promise<SaveResult> {
  if (input.snippet !== null && input.snippet.length > 4000) return { ok: false, error: "El código del mapa es demasiado largo." };
  const embedUrl = input.snippet === null ? null : extractGoogleMapsEmbedUrl(input.snippet);
  if (input.snippet !== null && !embedUrl) return { ok: false, error: "Copiá el código de «Insertar un mapa» de Google Maps." };
  const org = await editableOrg();
  if (!org) return { ok: false, error: "No tenés permiso para cambiar esta página." };
  const service = createSupabaseServiceClient();
  const { data: current, error: readError } = await service.from("organization")
    .select("direccion_completa").eq("id", org.id).is("deleted_at", null).maybeSingle();
  if (readError || !current) return { ok: false, error: "No pudimos verificar la dirección guardada." };
  const address = current.direccion_completa?.trim() ?? "";
  if (embedUrl && (!address || address !== input.expectedAddress.trim())) {
    return { ok: false, error: "Guardá primero la dirección actual antes de confirmar el mapa." };
  }
  let update = service.from("organization")
    .update({ maps_embed_url: embedUrl, maps_confirmed_address: embedUrl ? address : null })
    .eq("id", org.id).is("deleted_at", null);
  update = current.direccion_completa === null
    ? update.is("direccion_completa", null)
    : update.eq("direccion_completa", current.direccion_completa);
  const { data, error } = await update.select("id").maybeSingle();
  if (error || !data) return { ok: false, uncertain: true, error: "No pudimos confirmar si cambió el mapa. Recargá la página para verificarlo." };
  revalidatePath(`/book/${org.slug}`);
  revalidatePath("/configuracion");
  return { ok: true, value: embedUrl };
}
