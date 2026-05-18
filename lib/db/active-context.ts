/**
 * Folio · contexto activo del request (session + organization + profile).
 *
 * Wrapper sobre `getActiveSession()` que además trae:
 *   - `organization` row completa (nombre, rubro, ciudad, acento, etc.).
 *   - `profile` row con `nombre` y `apellido` ya DESENCRIPTADOS (server-side only).
 *
 * Diseño:
 *   - Server-only (usa cookies de Next + service decrypt de PII).
 *   - Un single query joineado (member ⋈ organization ⋈ profile) para evitar
 *     N+1 en cada Server Component que necesita el contexto.
 *   - Devuelve `Result<ActiveContext>` para que el caller pueda discriminar
 *     `auth_required` (redirect /login), `no_org` (redirect /onboarding) o
 *     `db_error` (mostrar error).
 *
 * Uso típico desde un Server Component:
 *
 *   ```ts
 *   const ctx = await getActiveContext();
 *   if (!ctx.ok) {
 *     if (ctx.error.code === "auth_required") redirect("/login");
 *     if (ctx.error.code === "no_org") redirect("/onboarding");
 *     throw new Error(ctx.error.message);
 *   }
 *   const { session, organization, profile } = ctx.data;
 *   ```
 */

import { decryptColumn } from "@/lib/crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, mapSupabaseError, ok, type Result } from "./errors";
import { getActiveSession, type ActiveSession } from "./session";

export interface ActiveOrganization {
  id: string;
  slug: string;
  nombre: string;
  rubro: string | null;
  ciudad: string | null;
  provincia: string | null;
  acentoHex: string;
  tema: string;
  timezone: string;
  moneda: string;
  cuit: string | null;
  razonSocial: string | null;
  condicionIva: "MONOTRIBUTO" | "RESPONSABLE_INSCRIPTO" | "EXENTO";
  optOutAnalytics: boolean;
  optOutPublicListing: boolean;
}

export interface ActiveProfile {
  id: string;
  email: string;
  /** Nombre desencriptado (server-side decrypt). Nunca se serializa al cliente sin gating. */
  nombre: string | null;
  /** Apellido desencriptado (server-side decrypt). */
  apellido: string | null;
  matricula: string | null;
  avatarUrl: string | null;
}

export interface ActiveContext {
  session: ActiveSession;
  organization: ActiveOrganization;
  profile: ActiveProfile;
}

/**
 * Helper canónico para Server Components y Server Actions.
 * Llamadas múltiples en el mismo request son baratas (Supabase serializa
 * cookies por request; podemos memo-izar en una versión futura si hace falta).
 */
export async function getActiveContext(): Promise<Result<ActiveContext>> {
  const sessionResult = await getActiveSession();
  if (!sessionResult.ok) return sessionResult;
  const session = sessionResult.data;

  const supabase = await createSupabaseServerClient();

  // Single round-trip: trae organization + profile en paralelo.
  const [orgRes, profRes] = await Promise.all([
    supabase
      .from("organization")
      .select(
        "id, slug, nombre, rubro, ciudad, provincia, acento_hex, tema, timezone, moneda, cuit, razon_social, condicion_iva, opt_out_analytics, opt_out_public_listing",
      )
      .eq("id", session.organizationId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("profile")
      .select("id, email, nombre_cifrado, apellido_cifrado, matricula, avatar_url")
      .eq("id", session.userId)
      .maybeSingle(),
  ]);

  if (orgRes.error) return err("db_error", "Error leyendo organización.", orgRes.error.message);
  if (!orgRes.data) return err("not_found", "Organización no encontrada o eliminada.");
  if (profRes.error) {
    return err("db_error", "Error leyendo perfil.", profRes.error.message);
  }
  if (!profRes.data) return err("not_found", "Perfil del usuario no existe.");

  const orgRow = orgRes.data as {
    id: string;
    slug: string;
    nombre: string;
    rubro: string | null;
    ciudad: string | null;
    provincia: string | null;
    acento_hex: string;
    tema: string;
    timezone: string;
    moneda: string;
    cuit: string | null;
    razon_social: string | null;
    condicion_iva: "MONOTRIBUTO" | "RESPONSABLE_INSCRIPTO" | "EXENTO";
    opt_out_analytics: boolean;
    opt_out_public_listing: boolean;
  };

  const profRow = profRes.data as {
    id: string;
    email: string;
    nombre_cifrado: Buffer | null;
    apellido_cifrado: Buffer | null;
    matricula: string | null;
    avatar_url: string | null;
  };

  // Desencriptar PII server-side. NUNCA se enviarán los buffers cifrados al cliente.
  let nombre: string | null = null;
  let apellido: string | null = null;
  try {
    nombre = decryptColumn(toBuffer(profRow.nombre_cifrado));
    apellido = decryptColumn(toBuffer(profRow.apellido_cifrado));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(
      "db_error",
      "No se pudo desencriptar el perfil. Verificá FOLIO_ENC_KEY.",
      msg,
    );
  }

  const organization: ActiveOrganization = {
    id: orgRow.id,
    slug: orgRow.slug,
    nombre: orgRow.nombre,
    rubro: orgRow.rubro,
    ciudad: orgRow.ciudad,
    provincia: orgRow.provincia,
    acentoHex: orgRow.acento_hex,
    tema: orgRow.tema,
    timezone: orgRow.timezone,
    moneda: orgRow.moneda,
    cuit: orgRow.cuit,
    razonSocial: orgRow.razon_social,
    condicionIva: orgRow.condicion_iva,
    optOutAnalytics: orgRow.opt_out_analytics,
    optOutPublicListing: orgRow.opt_out_public_listing,
  };

  const profile: ActiveProfile = {
    id: profRow.id,
    email: profRow.email,
    nombre,
    apellido,
    matricula: profRow.matricula,
    avatarUrl: profRow.avatar_url,
  };

  void mapSupabaseError; // (helper disponible por consistencia con el resto del data layer)
  return ok({ session, organization, profile });
}

/**
 * Supabase serializa bytea como hex string (`\x...`) cuando viene de PostgREST,
 * no como Buffer. Convertimos a Buffer antes de pasar a `decryptColumn`.
 * Acepta también Buffer (caso futuro de bindings nativos) y null/undefined.
 */
function toBuffer(value: Buffer | string | null | undefined): Buffer | null {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === "string") {
    // Format PostgREST: `\x` + hex pairs.
    if (value.startsWith("\\x")) return Buffer.from(value.slice(2), "hex");
    // Fallback: tratar como base64 (Supabase JS suele entregar base64 en algunas configs).
    return Buffer.from(value, "base64");
  }
  return null;
}
