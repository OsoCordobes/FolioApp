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

import { err, ok, type Result } from "./errors";
import { getActiveSession, type ActiveSession } from "./session";
import {
  computeAccessGate,
  loadSubscriptionForOrg,
  type AccessGate,
} from "./suscripcion";

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
  onboardingCompleted: boolean;
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

export interface ActiveSubscription {
  /** Estado de la suscripción en MP, o null si nunca se creó. */
  estado:
    | "PENDIENTE_ACTIVACION"
    | "ACTIVA"
    | "PAUSADA"
    | "CANCELADA"
    | "MOROSA"
    | null;
  /** Próximo cobro (ISO). Útil para mostrar "se renueva el X" en UI. */
  proximaCobro: string | null;
}

export interface ActiveContext {
  session: ActiveSession;
  organization: ActiveOrganization;
  profile: ActiveProfile;
  /** Estado actual de la suscripción (lazy: usa lookup local, no MP). */
  subscription: ActiveSubscription;
  /** Decisión de gating: si denegado, el layout debe redirigir a /configuracion/billing. */
  accessGate: AccessGate;
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

  // Single round-trip: trae organization + profile + suscripción en paralelo.
  // La suscripción usa service client (en suscripcion.ts) para bypassar RLS;
  // el gating se hace acá, no en la policy.
  const [orgRes, profRes, subRes] = await Promise.all([
    supabase
      .from("organization")
      .select(
        "id, slug, nombre, rubro, ciudad, provincia, acento_hex, tema, timezone, moneda, cuit, razon_social, condicion_iva, opt_out_analytics, opt_out_public_listing, onboarding_completed, created_at",
      )
      .eq("id", session.organizationId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("profile")
      .select("id, email, nombre_cifrado, apellido_cifrado, matricula, avatar_url")
      .eq("id", session.userId)
      .maybeSingle(),
    loadSubscriptionForOrg(session.organizationId),
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
    onboarding_completed: boolean;
    created_at: string;
  };

  const profRow = profRes.data as {
    id: string;
    email: string;
    nombre_cifrado: string | null;
    apellido_cifrado: string | null;
    matricula: string | null;
    avatar_url: string | null;
  };

  // Desencriptar PII server-side. NUNCA se envía el ciphertext al cliente.
  // Si la decodificación falla (corruption, key rotation, data legacy del bug
  // pre-2026-05-18 donde supabase-js serializaba Buffer como JSON), logueamos
  // y devolvemos null en vez de tirar la app abajo — el sidebar muestra
  // fallback con organization.nombre.
  const nombre = tryDecrypt(profRow.nombre_cifrado, "profile.nombre_cifrado");
  const apellido = tryDecrypt(profRow.apellido_cifrado, "profile.apellido_cifrado");

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
    onboardingCompleted: orgRow.onboarding_completed,
  };

  const profile: ActiveProfile = {
    id: profRow.id,
    email: profRow.email,
    nombre,
    apellido,
    matricula: profRow.matricula,
    avatarUrl: profRow.avatar_url,
  };

  // Suscripción + gate. Si el lookup falla (db_error), no bloqueamos al usuario:
  // tratamos como sin suscripción y dejamos que el grace period decida. Loguear
  // pero no fail-fast — un hiccup en la tabla suscripcion no debería tirar
  // toda la app abajo.
  const subscriptionRow = subRes.ok ? subRes.data : null;
  if (!subRes.ok) {
    console.warn(`[active-context] loadSubscriptionForOrg falló: ${subRes.error.message}`);
  }
  const accessGate = computeAccessGate(orgRow.created_at, subscriptionRow);
  const subscription: ActiveSubscription = {
    estado: subscriptionRow?.estado ?? null,
    proximaCobro: subscriptionRow?.proximaCobro ?? null,
  };

  return ok({ session, organization, profile, subscription, accessGate });
}

/**
 * Wrapper sobre `decryptColumn` que NO lanza: si la decodificación falla,
 * loguea en server y devuelve null. Reservado para PII nice-to-have donde
 * el render tolera ausencia (ej. nombre del profesional en sidebar). NO
 * usar para PHI ni para datos donde el null genere ambigüedad.
 */
function tryDecrypt(value: string | null, label: string): string | null {
  if (!value) return null;
  try {
    return decryptColumn(value);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[active-context] ${label}: decrypt falló (${msg}). len=${value.length}, sample="${value.slice(0, 40)}"`,
    );
    return null;
  }
}
