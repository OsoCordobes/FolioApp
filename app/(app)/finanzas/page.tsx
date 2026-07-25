/**
 * Folio · /finanzas (Server Component).
 *
 * Lee pagos + turnos del período en TZ de la org y los agrega para KPIs,
 * chart (diario o mensual según período), donut por servicio, desglose por
 * profesional y transacciones recientes. PII desencriptada server-side.
 *
 * Scoping por rol (E1 · FIX LEAK):
 *   - OWNER/DIRECTOR (canSeeFinanzasAll): toda la organización.
 *   - PROFESIONAL (canSeeFinanzasOwn): SOLO sus propios turnos/pagos — la
 *     matriz de permisos de Configuración lo promete y hasta este PR no se
 *     cumplía (un médico veía las finanzas de toda la clínica).
 *   - Recepción/coordinación: notFound() (sin panel de finanzas).
 *
 * Insights card (F8 cohort k=5) ya estaba conectada — la mantenemos en su
 * lugar al pie del dashboard.
 */

import { notFound } from "next/navigation";

import { Finanzas } from "@/components/finanzas/finanzas";
import { InsightsCard } from "@/components/finanzas/insights-card";
import { finanzasScopeMemberId } from "@/lib/auth/finanzas-scope";
import { capabilitiesForSession } from "@/lib/auth/guard";
import { getActiveContext } from "@/lib/db/active-context";
import { computeRangeOverride, getFinanzasDelMes, type FinanzasPeriodo } from "@/lib/db/finanzas";
import { getInsightsForActiveOrg } from "@/lib/db/insights";
import { listProfesionalesLite } from "@/lib/db/members";

export const dynamic = "force-dynamic";

const PERIODOS: FinanzasPeriodo[] = ["hoy", "semana", "mes", "6m", "anio"];

function parsePeriodo(raw: string | string[] | undefined): FinanzasPeriodo {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return PERIODOS.includes(v as FinanzasPeriodo) ? (v as FinanzasPeriodo) : "mes";
}

export default async function FinanzasPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string | string[] }>;
}) {
  const ctx = await getActiveContext();
  if (!ctx.ok) {
    throw new Error(`No se pudo cargar /finanzas: ${ctx.error.message}`);
  }

  // Recepción/coordinación no tiene panel de finanzas (cobra en el cierre de
  // turno, no ve el dashboard). El nav ya lo oculta; esto corta el acceso por
  // URL directa.
  const caps = capabilitiesForSession(ctx.data.session);
  if (!caps.canSeeFinanzas) {
    notFound();
  }

  const tz = ctx.data.organization.timezone || "America/Argentina/Cordoba";
  const sp = await searchParams;
  const periodo = parsePeriodo(sp?.periodo);
  const rangeOverride = computeRangeOverride(periodo, tz);

  // E1 · scoping: cada médico/a ve lo suyo; Director/dueño ve todo.
  const profesionalMemberId = finanzasScopeMemberId(caps, ctx.data.session.memberId);

  // E2 · desglose por profesional: solo para quien ve toda la org y solo si
  // hay más de un colegiado activo (en un consultorio Solo no aporta nada).
  let profesionales = undefined;
  if (caps.canSeeFinanzasAll) {
    const profsRes = await listProfesionalesLite(ctx.data.organization.id);
    if (profsRes.ok && profsRes.data.length > 1) {
      profesionales = profsRes.data;
    } else if (!profsRes.ok) {
      console.warn(`[finanzas] listProfesionalesLite falló: ${profsRes.error.message}`);
    }
  }

  const [insightsResult, finanzasResult] = await Promise.all([
    getInsightsForActiveOrg(),
    getFinanzasDelMes({
      organizationId: ctx.data.organization.id,
      timezone: tz,
      rangeOverride,
      profesionalMemberId,
      profesionales,
    }),
  ]);

  if (!finanzasResult.ok) {
    throw new Error(`Error cargando finanzas: ${finanzasResult.error.message}`);
  }
  const insightsBundle = insightsResult.ok ? insightsResult.data : null;

  return (
    <>
      <Finanzas
        data={finanzasResult.data}
        periodo={periodo}
        canMarcarCobrado={caps.canRegistrarCobro}
      />
      {/* Insights k-anónimos al pie: es contenido secundario (y suele estar
          en estado "cohort insuficiente") — no debe desplazar al título y
          los KPIs del período, que son lo que el profesional vino a ver. */}
      <InsightsCard bundle={insightsBundle} />
    </>
  );
}
