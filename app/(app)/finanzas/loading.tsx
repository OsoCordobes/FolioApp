/**
 * Folio · /finanzas — estado de carga (Suspense boundary, PR X6).
 *
 * Espeja el layout de `<Finanzas />`: header con período, strip de 4 KPIs,
 * grid de dos gráficos (línea + donut) y la tabla densa de transacciones.
 * Sin cifras ni PHI — solo shimmer sobre `--surface-*`.
 */

import { Skeleton } from "@/components/ui/skeleton";

export default function FinanzasLoading() {
  return (
    <div className="fi-content fn-content" aria-busy="true" aria-label="Cargando finanzas">
      {/* Header: eyebrow + título del mes + chips de período. */}
      <header className="fi-page-head">
        <div>
          <Skeleton variant="text" width={150} height={11} />
          <Skeleton variant="text" width={240} height={38} style={{ margin: "10px 0 0" }} />
          <Skeleton variant="text" width={140} height={13} style={{ margin: "12px 0 0" }} />
        </div>
        <div className="fi-page-actions">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} width={54} height={28} />
          ))}
        </div>
      </header>

      {/* Strip de 4 KPIs. */}
      <div className="fn-kpis">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="fn-kpi">
            <Skeleton variant="text" width={90} height={10} />
            <Skeleton variant="text" width={130} height={30} style={{ margin: "4px 0" }} />
            <Skeleton variant="text" width={100} height={11} />
          </div>
        ))}
      </div>

      {/* Grid de dos gráficos. */}
      <div className="fn-charts-grid">
        <section className="fn-chart-card">
          <header style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <Skeleton variant="text" width={180} height={11} />
            <Skeleton variant="text" width={110} height={11} />
          </header>
          <Skeleton height={220} style={{ marginTop: 16 }} />
        </section>
        <section className="fn-chart-card">
          <header style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <Skeleton variant="text" width={90} height={11} />
            <Skeleton variant="text" width={80} height={11} />
          </header>
          <Skeleton variant="circle" width={160} height={160} style={{ margin: "20px auto 0", display: "block" }} />
        </section>
      </div>

      {/* Tabla de transacciones. */}
      <div className="fi-skeleton-list" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="fi-skeleton-row">
            <div className="fi-skeleton-row-main">
              <Skeleton variant="text" width="32%" height={13} />
              <Skeleton variant="text" width="18%" height={11} />
            </div>
            <Skeleton width={72} height={20} />
            <Skeleton width={88} height={14} />
          </div>
        ))}
      </div>
    </div>
  );
}
