/**
 * Folio · /finanzas
 *
 * Server Component: fetcha los insights del cohort y los pasa a la card.
 * El resto del dashboard (KPIs, gráficos, transacciones) sigue siendo Client
 * Component con datos mock por ahora — se conectará a la DB en F11 cuando
 * tengamos pagos reales.
 */

import { Finanzas } from "@/components/finanzas/finanzas";
import { InsightsCard } from "@/components/finanzas/insights-card";
import { getInsightsForActiveOrg } from "@/lib/db/insights";

export default async function FinanzasPage() {
  const result = await getInsightsForActiveOrg();
  const bundle = result.ok ? result.data : null;

  return (
    <>
      <InsightsCard bundle={bundle} />
      <Finanzas />
    </>
  );
}
