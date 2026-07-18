/**
 * Folio · /hoy — estado de carga (Suspense boundary, PR X6).
 *
 * Espeja el layout real de `<Dashboard />`: header de página, strip de 4 KPIs
 * y la lista de turnos del día. Sin datos ni PHI — solo bloques de shimmer
 * sobre `--surface-*`. Next lo renderiza automáticamente mientras el Server
 * Component resuelve contexto + agenda.
 */

import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";

export default function HoyLoading() {
  return (
    <SkeletonScreen label="Cargando tu agenda de hoy">
      {/* Header de página: eyebrow + título + subtítulo, y acciones a la derecha. */}
      <header className="fi-page-head">
        <div>
          <Skeleton variant="text" width={180} height={11} />
          <Skeleton variant="text" width={280} height={38} style={{ margin: "10px 0 0" }} />
          <Skeleton variant="text" width={220} height={13} style={{ margin: "12px 0 0" }} />
        </div>
        <div className="fi-page-actions">
          <Skeleton width={104} height={31} />
          <Skeleton width={128} height={31} />
        </div>
      </header>

      {/* Strip de 4 KPIs. */}
      <div className="fi-kpis">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="fi-kpi">
            <Skeleton variant="text" width={72} height={10} />
            <Skeleton variant="text" width={110} height={26} style={{ margin: "6px 0 4px" }} />
            <Skeleton variant="text" width={90} height={11} />
          </div>
        ))}
      </div>

      {/* Lista de turnos del día. */}
      <div className="fi-skeleton-list" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="fi-skeleton-row">
            <Skeleton variant="circle" width={38} height={38} />
            <div className="fi-skeleton-row-main">
              <Skeleton variant="text" width="40%" height={14} />
              <Skeleton variant="text" width="24%" height={11} />
            </div>
            <Skeleton width={64} height={24} />
          </div>
        ))}
      </div>
    </SkeletonScreen>
  );
}
