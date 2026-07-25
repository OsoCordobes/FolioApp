/**
 * Folio · session helpers del PORTAL DEL PACIENTE (Fase 3 · P3).
 *
 * Espejo, del lado paciente, de `lib/db/session.ts` (staff). Cada Server Action
 * del portal que toca la DB necesita conocer:
 *   1. ¿Hay sesión Supabase? (auth.uid())
 *   2. ¿El usuario logueado tiene una `paciente_cuenta` viva? (identidad portal)
 *   3. ¿A qué pacientes-de-varias-orgs abanica ese login? (selector multi-org)
 *
 * DIFERENCIAS CLAVE con el lado staff:
 *   · El paciente NUNCA es `member` ⇒ NO se resuelve organización activa vía
 *     `member`; se resuelve la `paciente_cuenta` vía `auth_user_id = auth.uid()`.
 *   · La lectura de las filas `paciente` sale por el cliente ANON (RLS-enforced,
 *     M71): `paciente.cuenta_id = paciente_cuenta_actual()`. La ÚNICA lectura
 *     service_role acá es `organization.nombre` de las orgs linkeadas (el
 *     paciente no es member ⇒ org_select_own se la oculta al anon); el resto de
 *     los usos privilegiados queda para el matcher/export auditados.
 *   · El "multi-org" del paciente es el fan-out de sus filas `paciente` (una por
 *     org linkeada), no un switcher de membership.
 *
 * Precedencia humano-que-es-ambos (paciente Y staff): un mismo auth.users puede
 * tener member (staff) y paciente_cuenta (portal). Esta función SÓLO mira
 * paciente_cuenta; `getActiveSession` (staff) sólo mira member. El middleware
 * documenta y aplica la precedencia de RUTA (staff → /hoy tiene prioridad sobre
 * portal → /portal); ver middleware.ts. Ninguna de las dos sesiones "pisa" a la
 * otra: son ortogonales y self-scoped por RLS.
 */

import { bookingSlugDeOrg } from "@/lib/portal/portal-booking";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";

import { err, ok, type Result } from "./errors";

/** La identidad portal del usuario logueado + el fan-out de sus pacientes. */
export interface PacienteSession {
  userId: string;
  email: string;
  /** id de la `paciente_cuenta` viva (M70). */
  cuentaId: string;
  emailVerified: boolean;
  telefonoVerified: boolean;
  /** Filas `paciente` linkeadas a esta cuenta (una por org). Puede estar vacío:
   * cuenta verificada pero sin ningún link todavía (ni auto ni por claim). */
  pacientes: PortalPaciente[];
}

/** Una fila `paciente` que cuelga de la cuenta del login (M71 la deja leer). */
export interface PortalPaciente {
  pacienteId: string;
  organizationId: string;
  organizacionNombre: string | null;
  /** Slug del booking público (`/book/{slug}`) SI la org está viva y listada
   * (bookingSlugDeOrg); null si la org optó por no listarse o fue borrada —
   * en ese caso el portal no ofrece "Reservar turno". */
  bookingSlug: string | null;
}

/** Forma cruda del row del fan-out (query anon, RLS-enforced). */
interface PacienteRow {
  id: string;
  organization_id: string;
}

/**
 * Resolución completa de la sesión de portal. Devuelve la cuenta del paciente y
 * sus filas `paciente` (fan-out multi-org). Usar al principio de cualquier
 * Server Action del portal que toca la DB.
 *
 * Errores tipados:
 *   · `auth_required` — no hay sesión Supabase.
 *   · `forbidden`     — hay sesión pero el usuario NO tiene paciente_cuenta viva
 *                       (p. ej. es sólo staff, o la cuenta portal fue dada de
 *                       baja). El middleware ya rutea, pero defendemos acá.
 */
export async function getPacienteSession(): Promise<Result<PacienteSession>> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return err("auth_required", "No estás autenticado.");
  }

  // La `paciente_cuenta` del usuario logueado. Se lee vía el helper DEFINER
  // paciente_cuenta_actual() (M70) para no depender de una policy de SELECT
  // sobre paciente_cuenta (que M70/M71 dejan cerrada para el paciente salvo lo
  // mínimo). paciente_cuenta_actual() filtra por auth.uid() ⇒ no impersona.
  const { data: cuentaId, error: cuentaErr } = await supabase.rpc(
    "paciente_cuenta_actual",
  );
  if (cuentaErr) {
    return err("db_error", "Error resolviendo tu cuenta.", cuentaErr.message);
  }
  if (!cuentaId) {
    // Hay sesión Supabase pero no es una cuenta de portal (puede ser staff, o
    // una cuenta aún no provisionada). El caller/middleware decide el destino.
    return err(
      "forbidden",
      "Tu usuario no tiene un perfil de paciente en el portal.",
    );
  }

  const cuentaIdStr = cuentaId as string;

  // Fan-out: las filas `paciente` linkeadas a esta cuenta. M71
  // (paciente_select_portal) las deja leer bajo el cliente anon (RLS): sólo las
  // que tienen cuenta_id = paciente_cuenta_actual().
  //
  // OJO: acá NO se embebe organization(nombre). El paciente NO es member ⇒
  // org_select_own (M02) le oculta la fila `organization` al cliente anon y el
  // embed venía SIEMPRE null (todo el portal mostraba el fallback "Consultorio").
  const { data: pacientesRaw, error: pacientesErr } = await supabase
    .from("paciente")
    .select("id, organization_id")
    .eq("cuenta_id", cuentaIdStr)
    .is("pseudonimizado_en", null);

  if (pacientesErr) {
    return err("db_error", "Error listando tus fichas.", pacientesErr.message);
  }

  const rows = (pacientesRaw ?? []) as unknown as PacienteRow[];

  // Nombre + slug reservable de cada org linkeada, resueltos server-side con
  // service_role. Salvaguarda (ver docs/audit/quarterly-service-role-audit.md):
  // corre DESPUÉS de auth.getUser() + paciente_cuenta_actual(), y los org ids
  // salen del fan-out RLS-enforced de arriba ⇒ sólo orgs a las que el paciente
  // está linkeado. Se leen ÚNICAMENTE `nombre` y el trío slug/opt-out/deleted
  // que decide si el link público /book/{slug} existe (datos no sensibles: el
  // slug es, por definición, público). El client admin nunca sale del server.
  // Falla soft: sin fila, el portal muestra su fallback y no ofrece reservar.
  const nombrePorOrg = new Map<string, string | null>();
  const bookingSlugPorOrg = new Map<string, string | null>();
  const orgIds = [...new Set(rows.map((p) => p.organization_id))];
  if (orgIds.length > 0) {
    const service = createSupabaseServiceClient();
    const { data: orgs } = await service
      .from("organization")
      .select("id, nombre, slug, opt_out_public_listing, deleted_at")
      .in("id", orgIds);
    for (const o of (orgs ?? []) as Array<{
      id: string;
      nombre: string | null;
      slug: string | null;
      opt_out_public_listing: boolean | null;
      deleted_at: string | null;
    }>) {
      nombrePorOrg.set(o.id, o.nombre);
      bookingSlugPorOrg.set(
        o.id,
        bookingSlugDeOrg({
          slug: o.slug,
          optOutPublicListing: Boolean(o.opt_out_public_listing),
          deletedAt: o.deleted_at,
        }),
      );
    }
  }

  const pacientes: PortalPaciente[] = rows.map((p) => ({
    pacienteId: p.id,
    organizationId: p.organization_id,
    organizacionNombre: nombrePorOrg.get(p.organization_id) ?? null,
    bookingSlug: bookingSlugPorOrg.get(p.organization_id) ?? null,
  }));

  return ok({
    userId: user.id,
    email: user.email ?? "",
    cuentaId: cuentaIdStr,
    // El portal exige email verificado para entrar (magic-link ya lo prueba),
    // así que en la práctica siempre true; el campo refleja el estado auth.
    emailVerified: Boolean(user.email_confirmed_at),
    telefonoVerified: Boolean(user.phone_confirmed_at),
    pacientes,
  });
}
