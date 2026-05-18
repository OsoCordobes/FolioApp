/**
 * Folio · /finanzas
 *
 * Ingresos del mes con KPIs (ingresos, sesiones, ticket prom, proyección),
 * gráfico de línea de ingresos diarios, donut por servicio y tabla de
 * transacciones recientes con búsqueda y exportar.
 *
 * En F8 acá vivirá el card de Insights (analytics k-anónimos vs cohort
 * de la misma especialidad y región). En F4 todas las agregaciones se
 * computan server-side desde `Pago` + `Turno`.
 */

import { Finanzas } from "@/components/finanzas/finanzas";

export default function FinanzasPage() {
  return <Finanzas />;
}
