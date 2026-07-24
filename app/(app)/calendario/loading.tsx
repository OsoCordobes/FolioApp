/**
 * Folio · /calendario — estado de carga (Suspense boundary).
 *
 * Espeja el layout de `<Calendario />`: header con título y acciones, fila de
 * tabs/controles (Semana·Mes, navegación, Agendar) y la grilla semanal de 7
 * columnas. Sin datos ni PHI — solo bloques de shimmer sobre `--surface-*`
 * (mismo patrón que /hoy, /pacientes y /finanzas).
 */

import { Skeleton, SkeletonScreen } from "@/components/ui/skeleton";

export default function CalendarioLoading() {
  return (
    <SkeletonScreen label="Cargando tu calendario">
      {/* Header: eyebrow + título, y controles a la derecha. */}
      <header className="fi-page-head">
        <div>
          <Skeleton variant="text" width={150} height={11} />
          <Skeleton variant="text" width={260} height={38} style={{ margin: "10px 0 0" }} />
          <Skeleton variant="text" width={200} height={13} style={{ margin: "12px 0 0" }} />
        </div>
        <div className="fi-page-actions">
          <Skeleton width={140} height={31} />
          <Skeleton width={110} height={31} />
        </div>
      </header>

      {/* Fila de controles: tabs Semana/Mes + navegación de semana. */}
      <div
        aria-hidden="true"
        style={{ display: "flex", alignItems: "center", gap: 8, margin: "18px 0 16px" }}
      >
        <Skeleton width={168} height={32} />
        <div style={{ flex: 1 }} />
        <Skeleton width={90} height={30} />
        <Skeleton width={180} height={30} />
        <Skeleton width={90} height={30} />
      </div>

      {/* Grilla semanal: 7 columnas de día con bloques de turnos. */}
      <div
        aria-hidden="true"
        style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 10 }}
      >
        {[0, 1, 2, 3, 4, 5, 6].map((dia) => (
          <div key={dia} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Skeleton variant="text" width="70%" height={12} />
            <Skeleton height={64} />
            <Skeleton height={44} />
            {dia % 2 === 0 ? <Skeleton height={52} /> : null}
          </div>
        ))}
      </div>
    </SkeletonScreen>
  );
}
