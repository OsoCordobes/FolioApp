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
 *     M71): `paciente.cuenta_id = paciente_cuenta_actual()`. NO se usa
 *     service_role acá (eso queda para el matcher/export auditados).
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

import { createSupabaseServerClient } from "@/lib/supabase/server";

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
}

/** Forma cruda del row + embed. PostgREST tipa el embed to-one como array en
 * inferencia aunque en runtime venga objeto (FK a-uno); normalizamos abajo. */
interface PacienteRow {
  id: string;
  organization_id: string;
  organization: { nombre: string | null } | { nombre: string | null }[] | null;
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
  // que tienen cuenta_id = paciente_cuenta_actual(). El embed a organization usa
  // la FK organization_id (PostgREST la detecta).
  const { data: pacientesRaw, error: pacientesErr } = await supabase
    .from("paciente")
    .select("id, organization_id, organization(nombre)")
    .eq("cuenta_id", cuentaIdStr)
    .is("pseudonimizado_en", null);

  if (pacientesErr) {
    return err("db_error", "Error listando tus fichas.", pacientesErr.message);
  }

  const pacientes: PortalPaciente[] = (
    (pacientesRaw ?? []) as unknown as PacienteRow[]
  ).map((p) => {
    const org = Array.isArray(p.organization) ? p.organization[0] : p.organization;
    return {
      pacienteId: p.id,
      organizationId: p.organization_id,
      organizacionNombre: org?.nombre ?? null,
    };
  });

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
