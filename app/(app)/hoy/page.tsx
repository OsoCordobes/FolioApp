/**
 * Folio · /hoy — Dashboard del día (Server Component).
 *
 * Resuelve contexto (org + timezone), calcula "hoy" en zona horaria local,
 * lee `turno_extendido` + sesiones de la fecha, desencripta PII server-side
 * y pasa el shape view-friendly al Client Component `<Dashboard />`.
 *
 * Query params:
 *   ?prof=<memberId> — filtra la agenda al profesional indicado (modo
 *   clínica). Solo lo honra un rol con actsAcrossProfessionals; un
 *   PROFESIONAL ve SIEMPRE su propia agenda (ver lib/agenda/profesional.ts).
 */

import { resolveAgendaProfesional, type ProfesionalLite } from "@/lib/agenda/profesional";
import { capabilitiesFor } from "@/lib/auth/capabilities";
import { getActiveContext } from "@/lib/db/active-context";
import { fechaHoyEnTz, getDashboardHoy } from "@/lib/db/hoy";
import { listProfesionalesLite } from "@/lib/db/members";
import { decideGcalNudge, type GcalNudgeModo } from "@/lib/google/health";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { Dashboard } from "@/components/hoy/dashboard";
import { GcalNudgeBanner } from "@/components/hoy/gcal-nudge-banner";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ prof?: string }>;
}

export default async function HoyPage({ searchParams }: PageProps) {
  const ctx = await getActiveContext();
  if (!ctx.ok) {
    // El layout padre ya gating; si llegamos acá, es db_error.
    throw new Error(`No se pudo cargar /hoy: ${ctx.error.message}`);
  }

  const timezone = ctx.data.organization.timezone || "America/Argentina/Buenos_Aires";
  const fechaIso = fechaHoyEnTz(timezone);
  const params = await searchParams;

  // Dimensión profesional (modo clínica). Si la lectura de colegiados falla,
  // degradamos al comportamiento histórico (org-wide, sin selector) con un
  // warn — nunca tiramos la agenda abajo por el filtro.
  const profsRes = await listProfesionalesLite(ctx.data.organization.id);
  if (!profsRes.ok) {
    console.warn(`[hoy] listProfesionalesLite falló: ${profsRes.error.message}`);
  }
  const profesionales: ProfesionalLite[] = profsRes.ok ? profsRes.data : [];
  const caps = capabilitiesFor(ctx.data.session.role, ctx.data.session.esColegiado);
  const { selectorVisible, profesionalIdEfectivo, mostrarAtribucion } = resolveAgendaProfesional({
    actsAcrossProfessionals: caps.actsAcrossProfessionals,
    sessionMemberId: ctx.data.session.memberId,
    profParam: params.prof ?? null,
    profesionales,
  });

  // Nudge de Google Calendar: solo profesionales colegiados sin integración
  // (modo "conectar") o con integración muerta por invalid_grant (modo
  // "reconectar"). La decisión es pura (lib/google/health.ts); la lectura es
  // fail-safe — ante cualquier error, no molestar. En paralelo con la agenda:
  // son independientes y /hoy es la página más caliente (review PR #51).
  const [gcalNudgeModo, data] = await Promise.all([
    loadGcalNudgeModo(
      ctx.data.organization.id,
      ctx.data.session.memberId,
      ctx.data.session.esColegiado,
    ),
    getDashboardHoy({
      organizationId: ctx.data.organization.id,
      fechaIso,
      timezone,
      profesionalId: profesionalIdEfectivo,
      profesionalesNombreById: mostrarAtribucion
        ? Object.fromEntries(profesionales.map((p) => [p.id, p.displayName]))
        : undefined,
    }),
  ]);

  if (!data.ok) {
    throw new Error(`Error cargando agenda: ${data.error.message}`);
  }

  return (
    <>
      {gcalNudgeModo ? (
        <GcalNudgeBanner modo={gcalNudgeModo} memberId={ctx.data.session.memberId} />
      ) : null}
      <Dashboard
        initialTurnos={data.data.turnos}
        pacientes={data.data.pacientes}
        fechaIso={data.data.fechaIso}
        fechaLarga={data.data.fechaLarga}
        fechaAnio={data.data.fechaAnio}
        nowIso={new Date().toISOString()}
        timezone={timezone}
        organizationId={ctx.data.organization.id}
        profesionales={selectorVisible ? profesionales : []}
        profActivo={selectorVisible ? profesionalIdEfectivo : null}
      />
    </>
  );
}

/**
 * Lee el estado de la integración GOOGLE_CALENDAR del member de la sesión y
 * decide el modo del banner. Fail-safe: si la query falla, devolvemos null
 * (no molestar) — el nudge es un nice-to-have, nunca tira /hoy abajo.
 * El select pasa por RLS (integration_select_admin_or_self: el profesional
 * lee su propia fila). El ciphertext solo se usa server-side para computar
 * `sinToken`; al cliente viaja únicamente el modo.
 */
async function loadGcalNudgeModo(
  organizationId: string,
  memberId: string,
  esColegiado: boolean,
): Promise<GcalNudgeModo | null> {
  if (!esColegiado) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("integration")
      .select("refresh_token_cifrado, ultimo_error, ultimo_error_ts")
      .eq("organization_id", organizationId)
      .eq("profesional_id", memberId)
      .eq("proveedor", "GOOGLE_CALENDAR")
      .maybeSingle();
    if (error) return null;
    return decideGcalNudge({
      esColegiado,
      integracion: data
        ? {
            sinToken: !data.refresh_token_cifrado,
            ultimoError: (data.ultimo_error as string | null) ?? null,
            ultimoErrorTs: (data.ultimo_error_ts as string | null) ?? null,
          }
        : null,
    });
  } catch {
    return null;
  }
}
