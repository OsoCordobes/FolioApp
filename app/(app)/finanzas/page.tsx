/**
 * Folio · /finanzas (Server Component).
 *
 * Lee pagos + turnos del mes en TZ de la org y los agrega para KPIs, chart
 * diario, donut por servicio y transacciones recientes. PII desencriptada
 * server-side.
 *
 * Insights card (F8 cohort k=5) ya estaba conectada — la mantenemos en su
 * lugar arriba del dashboard.
 */

import { Finanzas } from "@/components/finanzas/finanzas";
import { InsightsCard } from "@/components/finanzas/insights-card";
import { getActiveContext } from "@/lib/db/active-context";
import { computeRangeOverride, getFinanzasDelMes, type FinanzasPeriodo } from "@/lib/db/finanzas";
import { getInsightsForActiveOrg } from "@/lib/db/insights";

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

  const tz = ctx.data.organization.timezone || "America/Argentina/Cordoba";
  const sp = await searchParams;
  const periodo = parsePeriodo(sp?.periodo);
  const rangeOverride = computeRangeOverride(periodo, tz);

  const [insightsResult, finanzasResult] = await Promise.all([
    getInsightsForActiveOrg(),
    getFinanzasDelMes({
      organizationId: ctx.data.organization.id,
      timezone: tz,
      rangeOverride,
    }),
  ]);

  if (!finanzasResult.ok) {
    throw new Error(`Error cargando finanzas: ${finanzasResult.error.message}`);
  }
  const insightsBundle = insightsResult.ok ? insightsResult.data : null;

  return (
    <>
      <Finanzas data={finanzasResult.data} periodo={periodo} />
      {/* Insights k-anónimos al pie: es contenido secundario (y suele estar
          en estado "cohort insuficiente") — no debe desplazar al título y
          los KPIs del período, que son lo que el profesional vino a ver. */}
      <InsightsCard bundle={insightsBundle} />
    </>
  );
}
