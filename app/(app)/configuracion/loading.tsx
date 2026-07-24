/**
 * Folio · /configuracion — estado de carga (Suspense boundary).
 *
 * Espeja el layout de `<Configuracion />`: header con acciones de guardado y
 * la `.cfg-grid` (nav lateral de secciones + panel de formulario). Sin datos
 * ni PHI — solo bloques de shimmer sobre `--surface-*` (mismo patrón que
 * /hoy, /pacientes y /finanzas).
 */

import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";

export default function ConfiguracionLoading() {
  return (
    <SkeletonScreen label="Cargando la configuración">
      {/* Header: eyebrow + título, y acciones de guardado. */}
      <header className="fi-page-head">
        <div>
          <Skeleton variant="text" width={130} height={11} />
          <Skeleton variant="text" width={240} height={38} style={{ margin: "10px 0 0" }} />
          <Skeleton variant="text" width={280} height={13} style={{ margin: "12px 0 0" }} />
        </div>
        <div className="fi-page-actions">
          <Skeleton width={96} height={31} />
          <Skeleton width={110} height={31} />
        </div>
      </header>

      {/* Grid: nav lateral de secciones + panel con campos de formulario. */}
      <div className="cfg-grid" aria-hidden="true" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} width="85%" height={30} />
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <Skeleton variant="text" width={180} height={16} />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <Skeleton variant="text" width={120} height={11} />
              <Skeleton height={36} />
            </div>
          ))}
          <Skeleton variant="text" width={180} height={16} style={{ marginTop: 10 }} />
          <Skeleton height={120} />
        </div>
      </div>
    </SkeletonScreen>
  );
}
