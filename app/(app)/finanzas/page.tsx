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
import { getFinanzasDelMes } from "@/lib/db/finanzas";
import { getInsightsForActiveOrg } from "@/lib/db/insights";

export const dynamic = "force-dynamic";

export default async function FinanzasPage() {
  const ctx = await getActiveContext();
  if (!ctx.ok) {
    throw new Error(`No se pudo cargar /finanzas: ${ctx.error.message}`);
  }

  const tz = ctx.data.organization.timezone || "America/Argentina/Cordoba";

  const [insightsResult, finanzasResult] = await Promise.all([
    getInsightsForActiveOrg(),
    getFinanzasDelMes({
      organizationId: ctx.data.organization.id,
      timezone: tz,
    }),
  ]);

  if (!finanzasResult.ok) {
    throw new Error(`Error cargando finanzas: ${finanzasResult.error.message}`);
  }
  const insightsBundle = insightsResult.ok ? insightsResult.data : null;

  return (
    <>
      <InsightsCard bundle={insightsBundle} />
      <Finanzas data={finanzasResult.data} />
    </>
  );
}
