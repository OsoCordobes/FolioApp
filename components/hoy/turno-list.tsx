"use client";

/**
 * Folio · Dashboard · lista de turnos agrupados (mañana/tarde + cerrados).
 *
 * Port de `TurnoList` en folio/dashboard.jsx (líneas 256-352). El drag-and-drop
 * del prototipo se quita en F1 (no se ve en el baseline) y vuelve en F4 cuando
 * la persistencia real (`onReorder`) esté conectada.
 */

import { useMemo, useState } from "react";

import * as I from "@/components/icons";
import { CerradoRow } from "@/components/hoy/cerrado-row";
import { TurnoRow } from "@/components/hoy/turno-row";
import { fmtMoney } from "@/lib/dashboard-helpers";
import type { EstadoTurno, PacientesById, Turno } from "@/lib/types";

interface TurnoListProps {
  turnos: Turno[];
  pacientes: PacientesById;
  nextId: string | undefined;
  onTransition: (id: string, to: EstadoTurno, extra?: Partial<Turno>) => void;
  onOpenFicha: (id: string) => void;
  dense?: boolean;
}

interface Group {
  id: string;
  label: string;
  hoursRange: string;
  turnos: Turno[];
}

export function TurnoList({ turnos, pacientes, nextId, onTransition, onOpenFicha, dense }: TurnoListProps) {
  const [showCerrados, setShowCerrados] = useState(true);

  const activos = turnos.filter(
    (t) => !["cerrado", "cancelado", "no_asistio"].includes(t.estado),
  );
  const cerrados = turnos
    .filter((t) => t.estado === "cerrado")
    .sort((a, b) => a.hora.localeCompare(b.hora));

  const groups = useMemo<Group[]>(() => {
    const morning = activos.filter((t) => parseInt(t.hora) < 13);
    const afternoon = activos.filter((t) => parseInt(t.hora) >= 13);
    return [
      { id: "manana", label: "Mañana", hoursRange: "09 – 12 hs", turnos: morning },
      { id: "tarde", label: "Tarde", hoursRange: "15 – 18 hs", turnos: afternoon },
    ];
  }, [activos]);

  const cerradosTotal = cerrados.reduce((s, t) => s + t.precio, 0);

  return (
    <div className={"fi-list " + (dense ? "is-dense" : "")}>
      {groups.map((g) =>
        g.turnos.length ? (
          <section key={g.id} className="fi-block">
            <header className="fi-block-head">
              <span className="fi-block-lbl">{g.label}</span>
              <span className="fi-block-hours">{g.hoursRange}</span>
              <span className="fi-block-line" />
              <span className="fi-block-count">{g.turnos.length} turnos</span>
            </header>
            <div className="fi-block-rows">
              {g.turnos.map((t) => (
                <TurnoRow
                  key={t.id}
                  turno={t}
                  paciente={pacientes[t.pacienteId]}
                  isNext={t.id === nextId}
                  onTransition={onTransition}
                  onOpenFicha={onOpenFicha}
                />
              ))}
            </div>
          </section>
        ) : null,
      )}

      {cerrados.length ? (
        <section className="fi-cerrados">
          <header
            className="fi-cerrados-head"
            onClick={() => setShowCerrados((v) => !v)}
            role="button"
            tabIndex={0}
          >
            <span className="fi-cerrados-chev" data-open={showCerrados}>
              <I.ChevronDown size={12} />
            </span>
            <span className="fi-block-lbl">Cerrados</span>
            <span className="fi-cerrados-meta">
              {cerrados.length} {cerrados.length === 1 ? "turno cerrado" : "turnos cerrados"}
              <span className="fi-cerrados-dot">·</span>
              <span className="fi-mono">{fmtMoney(cerradosTotal)}</span> recaudado
            </span>
            <span className="fi-block-line" />
          </header>
          {showCerrados ? (
            <div className="fi-cerrados-rows">
              {cerrados.map((t) => (
                <CerradoRow
                  key={t.id}
                  turno={t}
                  paciente={pacientes[t.pacienteId]}
                  onOpenFicha={onOpenFicha}
                />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
