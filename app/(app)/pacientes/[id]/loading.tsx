/**
 * Folio · /pacientes/[id] — estado de carga (E2).
 *
 * Sin este archivo, Next resolvía el `loading.tsx` del segmento padre y la
 * ficha de un paciente mostraba el esqueleto del DIRECTORIO: una barra de
 * búsqueda, chips de filtro y ocho filas de lista. Es decir, durante el
 * segundo que tarda en cargar, la pantalla decía "estás en la lista de
 * pacientes" y después saltaba a otra cosa completamente distinta.
 *
 * La ficha es la pantalla más pesada de la app (historia, sesiones, consentimientos)
 * y la que más se abre desde el teléfono, con la peor conexión. Ese segundo se ve
 * siempre.
 *
 * Espeja la estructura real de `<PacienteDetalle />`: back, identidad, tabs y
 * la grilla del plan. Sin nombres ni PHI — solo shimmer sobre `--surface-*`.
 */

import { Skeleton } from "@/components/ui/skeleton";

export default function PacienteFichaLoading() {
  return (
    <div className="fi-content pc-content" aria-busy="true" aria-label="Cargando ficha del paciente">
      <header className="pc-head">
        <Skeleton variant="text" width={92} height={13} />
        <div className="pc-id-row">
          <Skeleton variant="circle" width={56} height={56} />
          <div className="pc-id-body">
            <Skeleton variant="text" width={240} height={28} />
            <Skeleton variant="text" width={180} height={13} />
          </div>
          <div className="pc-actions">
            <Skeleton width={104} height={31} />
            <Skeleton width={88} height={31} />
          </div>
        </div>
      </header>

      {/* Tabs: Información · Plan · Sesiones · Documentos. */}
      <div className="pc-tabs" aria-hidden="true">
        {[104, 78, 118, 116].map((w, i) => (
          <Skeleton key={i} width={w} height={38} style={{ marginRight: 2 }} />
        ))}
      </div>

      {/* Cuerpo: la grilla de dos columnas del tab por defecto. En mobile las
          reglas de .pc-plan-grid la bajan a una sola, igual que la real. */}
      <div className="pc-plan-grid" aria-hidden="true">
        <div className="pc-card" style={{ display: "grid", gap: 12 }}>
          <Skeleton variant="text" width="45%" height={12} />
          <Skeleton variant="text" width="80%" height={20} />
          <Skeleton height={8} />
          <Skeleton variant="text" width="60%" height={13} />
          <Skeleton variant="text" width="70%" height={13} />
        </div>
        <div className="pc-card" style={{ display: "grid", gap: 14 }}>
          <Skeleton variant="text" width="35%" height={12} />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ display: "grid", gap: 6 }}>
              <Skeleton variant="text" width="30%" height={11} />
              <Skeleton variant="text" width="85%" height={13} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
