/**
 * Folio · /pacientes — estado de carga (Suspense boundary, PR X6).
 *
 * Espeja el layout de `<PacientesDir />`: header, toolbar (búsqueda + chips de
 * filtro) y filas del directorio. Sin nombres ni PHI — solo shimmer sobre
 * `--surface-*`.
 */

import { Skeleton } from "@/components/ui/skeleton";

export default function PacientesLoading() {
  return (
    <div className="fi-content pd-content" aria-busy="true" aria-label="Cargando pacientes">
      {/* Header de página. */}
      <header className="fi-page-head">
        <div>
          <Skeleton variant="text" width={130} height={11} />
          <Skeleton variant="text" width={220} height={38} style={{ margin: "10px 0 0" }} />
          <Skeleton variant="text" width={180} height={13} style={{ margin: "12px 0 0" }} />
        </div>
        <div className="fi-page-actions">
          <Skeleton width={96} height={31} />
          <Skeleton width={128} height={31} />
        </div>
      </header>

      {/* Toolbar: búsqueda + chips de filtro. */}
      <div className="pd-toolbar">
        <Skeleton width={260} height={34} />
        <div style={{ display: "flex", gap: 6 }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} width={74} height={28} />
          ))}
        </div>
      </div>

      {/* Filas del directorio. */}
      <div className="fi-skeleton-list" aria-hidden="true" style={{ marginTop: 16 }}>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="fi-skeleton-row">
            <Skeleton variant="circle" width={34} height={34} />
            <div className="fi-skeleton-row-main">
              <Skeleton variant="text" width="34%" height={13} />
              <Skeleton variant="text" width="20%" height={11} />
            </div>
            <Skeleton width={60} height={20} />
            <Skeleton width={72} height={14} />
          </div>
        ))}
      </div>
    </div>
  );
}
