"use client";

/**
 * Folio · PermissionMatrix (X4) — matriz legible rol × capacidad.
 *
 * Vista SOLO-lectura de quién puede hacer qué en la organización. Se deriva
 * enteramente de `capabilitiesFor` (lib/auth/capabilities.ts): cada celda es
 * `matrixCell(fila, columna)`, así la tabla NUNCA puede divergir del modelo de
 * capacidades — que a su vez espeja la RLS de Postgres (la frontera real).
 *
 * No hay overrides acá: los permisos restrict-only (member_permission / M76)
 * son Fase 5. Esta pantalla es explicativa y vendible: le muestra a quien dirige
 * una clínica exactamente qué ve y qué toca cada rol antes de invitar a alguien.
 *
 * Estilo: folio.css hand-written, tokens brass/cream. Reusa el chrome de sección
 * (`Section`) del propio configuracion.tsx y clases `.pm-*` propias (append en
 * public/folio.css). Sin Tailwind/shadcn.
 */

import * as I from "@/components/icons";
import {
  PERMISSION_MATRIX_COLUMNS,
  PERMISSION_MATRIX_GROUPS,
  matrixCell,
  type MatrixColumn,
  type MatrixRow,
} from "@/lib/auth/capabilities";

/** Celda: check brass si la capacidad está concedida; guion tenue si no. */
function Cell({ granted, roleLabel, capLabel }: { granted: boolean; roleLabel: string; capLabel: string }) {
  return (
    <td className="pm-cell" data-granted={granted ? "1" : "0"}>
      {granted ? (
        <span className="pm-yes" aria-hidden="true">
          <I.Check size={14} />
        </span>
      ) : (
        <span className="pm-no" aria-hidden="true">
          —
        </span>
      )}
      {/* Texto para lectores de pantalla: cada celda dice explícitamente sí/no. */}
      <span className="sr-only">
        {roleLabel}: {granted ? "sí" : "no"} — {capLabel}
      </span>
    </td>
  );
}

export function PermissionMatrix() {
  const cols: readonly MatrixColumn[] = PERMISSION_MATRIX_COLUMNS;

  return (
    <section className="cfg-section">
      <header>
        <div>
          <h2>Permisos por rol</h2>
          <p>
            Qué ve y qué puede hacer cada rol en tu organización. Es la referencia
            que aplica cuando invitás a alguien — se define por el rol, no por
            persona.
          </p>
        </div>
      </header>
      <div className="cfg-section-body">
        {/* Referencia de cada columna: rol + una línea de alcance. */}
        <ul className="pm-legend">
          {cols.map((col) => (
            <li key={col.key} className="pm-legend-item">
              <span className="pm-legend-role">{col.label}</span>
              <span className="pm-legend-desc">{col.descripcion}</span>
            </li>
          ))}
        </ul>

        <div className="pm-scroll">
          <table className="pm-table">
            <caption className="sr-only">
              Matriz de permisos: filas de capacidades, columnas de roles. Un
              tilde indica que el rol tiene esa capacidad.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="pm-th-cap">
                  Capacidad
                </th>
                {cols.map((col) => (
                  <th key={col.key} scope="col" className="pm-th-role">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_MATRIX_GROUPS.map((group) => (
                <GroupRows key={group.titulo} titulo={group.titulo} filas={group.filas} cols={cols} />
              ))}
            </tbody>
          </table>
        </div>

        <p className="pm-foot">
          Estos permisos reflejan las reglas de seguridad del sistema y no se
          editan por persona. La restricción fina por integrante llega más
          adelante.
        </p>
      </div>
    </section>
  );
}

function GroupRows({
  titulo,
  filas,
  cols,
}: {
  titulo: string;
  filas: readonly MatrixRow[];
  cols: readonly MatrixColumn[];
}) {
  return (
    <>
      <tr className="pm-group-row">
        <th scope="colgroup" colSpan={cols.length + 1} className="pm-group-th">
          {titulo}
        </th>
      </tr>
      {filas.map((row) => (
        <tr key={row.key} className="pm-row">
          <th scope="row" className="pm-th-cap-cell">
            <span className="pm-cap-label">{row.label}</span>
            <span className="pm-cap-detalle">{row.detalle}</span>
          </th>
          {cols.map((col) => (
            <Cell
              key={col.key}
              granted={matrixCell(row, col)}
              roleLabel={col.label}
              capLabel={row.label}
            />
          ))}
        </tr>
      ))}
    </>
  );
}
