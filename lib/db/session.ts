/**
 * Folio · session helpers (auth + org resolution).
 *
 * Cada Server Action que toca la DB necesita conocer:
 *   1. ¿Hay sesión Supabase? (auth.uid())
 *   2. ¿Qué Organization está activa? (puede haber múltiples — clinic-ready)
 *   3. ¿Cuál es el member_id del usuario en esa org?
 *
 * El multi-org se resuelve así:
 *   - Por default, la org activa es la primera member del user (créo orden
 *     por created_at en signup).
 *   - El user puede switchearse vía cookie `folio.active_org` que el
 *     <OrgSwitcher /> en sidebar setea.
 */

import { cookies } from "next/headers";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, ok, type Result } from "./errors";

export interface ActiveSession {
  userId: string;
  email: string;
  organizationId: string;
  memberId: string;
  role: "OWNER" | "DIRECTOR" | "PROFESIONAL" | "COORDINADOR" | "ASISTENTE";
  esColegiado: boolean;
}

const ACTIVE_ORG_COOKIE = "folio.active_org";

/**
 * Resolución completa de sesión. Devuelve la org activa y el member_id.
 * Para usar al principio de cualquier Server Action que toca la DB.
 */
export async function getActiveSession(): Promise<Result<ActiveSession>> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return err("auth_required", "No estás autenticado.");
  }

  // Cookie con org seleccionada manualmente (clinic-switching)
  const cookieStore = await cookies();
  const preferredOrgId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value ?? null;

  // Listar memberships activas
  const { data: members, error } = await supabase
    .from("member")
    .select("id, organization_id, role, es_colegiado")
    .eq("profile_id", user.id)
    .is("deleted_at", null);

  if (error) {
    return err("db_error", "Error obteniendo membresía.", error.message);
  }
  if (!members || members.length === 0) {
    return err("no_org", "No tenés acceso a ninguna organización todavía.");
  }

  // Picker: cookie preferida si existe entre las memberships, sino primera
  const picked =
    members.find((m) => m.organization_id === preferredOrgId) ?? members[0];

  return ok({
    userId: user.id,
    email: user.email ?? "",
    organizationId: picked.organization_id,
    memberId: picked.id,
    role: picked.role,
    esColegiado: picked.es_colegiado,
  });
}

/** Switchear la org activa (set cookie). Usado por <OrgSwitcher />. */
export async function setActiveOrg(organizationId: string): Promise<Result<void>> {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365, // 1 año
    path: "/",
  });
  return ok(undefined);
}
