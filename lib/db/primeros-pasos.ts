/**
 * Folio · loader del checklist "Primeros pasos" para /hoy.
 *
 * Trae los contadores mínimos que necesita `computePrimerosPasos`
 * (lib/primeros-pasos.ts) y devuelve el estado listo para render, o `null`
 * cuando la card no corresponde.
 *
 * Barato por diseño:
 *   - Gate por fecha ANTES de tocar la DB: una org con ≥30 días no dispara
 *     ninguna query (es el caso de toda org madura, o sea casi siempre).
 *   - Solo head-counts (`count: exact, head: true`) sobre índices por org
 *     y un select chico de `integration.proveedor`.
 *   - Las queries de equipo solo corren en orgs CLINICA.
 *
 * Todo pasa por el server client (RLS): los counts reflejan lo que el rol
 * activo puede ver — suficiente para un nudge, nunca autoritativo.
 */

import {
  computePrimerosPasos,
  esOrgJoven,
  type OrgTipo,
  type PrimerosPasosEstado,
} from "@/lib/primeros-pasos";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, ok, type Result } from "./errors";

export interface LoadPrimerosPasosInput {
  organizationId: string;
  tipo: OrgTipo;
  /** organization.created_at (ISO) — proxy de la fecha de fin del onboarding. */
  orgCreatedAt: string;
  onboardingCompleted: boolean;
  /** ctx.subscription.estado — cualquier valor no-null implica alta en MP. */
  suscripcionEstado: string | null;
  /**
   * ctx.session.role === "OWNER". Decide si el checklist ofrece "Activá tu
   * suscripción": /configuracion/billing es OWNER-only (404 para el resto
   * mientras el gate esté permitido) — ver lib/primeros-pasos.ts.
   */
  esOwner: boolean;
}

/**
 * Estado del checklist, o `null` si la card no debe mostrarse. Errores de
 * lectura vuelven como `err` — el caller (page de /hoy) loguea y no renderiza
 * la card; el checklist jamás tira /hoy abajo.
 */
export async function loadPrimerosPasosHoy(
  input: LoadPrimerosPasosInput,
): Promise<Result<PrimerosPasosEstado | null>> {
  if (!input.onboardingCompleted || !esOrgJoven(input.orgCreatedAt, Date.now())) {
    return ok(null);
  }

  const supabase = await createSupabaseServerClient();
  const orgId = input.organizationId;
  const esClinica = input.tipo === "CLINICA";

  const [turnosRes, reservasRes, pacientesRes, integracionesRes, membersRes, invitesRes] =
    await Promise.all([
      supabase
        .from("turno")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .is("deleted_at", null),
      supabase
        .from("turno")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("origen", "BOOKING")
        .is("deleted_at", null),
      // paciente_identidad y no paciente: la PII la leen todos los roles de
      // agenda (la PHI de `paciente` está gateada por can_read_clinical).
      supabase
        .from("paciente_identidad")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .is("deleted_at", null),
      supabase
        .from("integration")
        .select("proveedor")
        .eq("organization_id", orgId)
        .in("proveedor", ["GOOGLE_CALENDAR", "MERCADOPAGO"]),
      esClinica
        ? supabase
            .from("member")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId)
            .is("deleted_at", null)
        : Promise.resolve(null),
      esClinica
        ? supabase
            .from("member_invitation")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId)
            .eq("estado", "PENDIENTE")
        : Promise.resolve(null),
    ]);

  const firstError =
    turnosRes.error ??
    reservasRes.error ??
    pacientesRes.error ??
    integracionesRes.error ??
    membersRes?.error ??
    invitesRes?.error;
  if (firstError) {
    return err("db_error", "No se pudo calcular Primeros pasos.", firstError.message);
  }

  const proveedores = new Set(
    ((integracionesRes.data ?? []) as { proveedor: string }[]).map((r) => r.proveedor),
  );

  const estado = computePrimerosPasos({
    tipo: input.tipo,
    onboardingCompleted: input.onboardingCompleted,
    orgCreatedAt: input.orgCreatedAt,
    turnosTotal: turnosRes.count ?? 0,
    reservasOnline: reservasRes.count ?? 0,
    pacientesTotal: pacientesRes.count ?? 0,
    gcalConectado: proveedores.has("GOOGLE_CALENDAR"),
    cobrosMpListos: input.suscripcionEstado != null || proveedores.has("MERCADOPAGO"),
    // El titular cuenta como member: >1 significa que alguien más entró.
    equipoInvitado:
      esClinica && ((membersRes?.count ?? 0) > 1 || (invitesRes?.count ?? 0) > 0),
    esOwner: input.esOwner,
  });

  return ok(estado.visible ? estado : null);
}
