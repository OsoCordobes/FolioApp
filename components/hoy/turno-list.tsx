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

const CANCELADOS_ESTADOS: EstadoTurno[] = ["cancelado", "no_asistio", "reagendado"];

export function TurnoList({ turnos, pacientes, nextId, onTransition, onOpenFicha, dense }: TurnoListProps) {
  const [showCerrados, setShowCerrados] = useState(true);
  const [showCancelados, setShowCancelados] = useState(false);

  const activos = turnos.filter(
    (t) => !["cerrado", "cancelado", "no_asistio", "reagendado"].includes(t.estado),
  );
  const cerrados = turnos
    .filter((t) => t.estado === "cerrado")
    .sort((a, b) => a.hora.localeCompare(b.hora));
  const cancelados = turnos
    .filter((t) => CANCELADOS_ESTADOS.includes(t.estado))
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

  const estadoLabel: Partial<Record<EstadoTurno, string>> = {
    cancelado: "Cancelado",
    no_asistio: "No asistió",
    reagendado: "Reagendado",
  };

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

      {cancelados.length ? (
        <section className="fi-cerrados">
          <header
            className="fi-cerrados-head"
            onClick={() => setShowCancelados((v) => !v)}
            role="button"
            tabIndex={0}
          >
            <span className="fi-cerrados-chev" data-open={showCancelados}>
              <I.ChevronDown size={12} />
            </span>
            <span className="fi-block-lbl">Cancelados / No asistió</span>
            <span className="fi-cerrados-meta">
              {cancelados.length} {cancelados.length === 1 ? "turno" : "turnos"}
            </span>
            <span className="fi-block-line" />
          </header>
          {showCancelados ? (
            <div className="fi-cerrados-rows">
              {cancelados.map((t) => (
                <div
                  key={t.id}
                  className="fi-cerrado-row is-muted"
                  onClick={() => onOpenFicha(t.id)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="fi-t-time">
                    <b>{t.hora}</b>
                  </div>
                  <span className="fi-t-dot-wrap">
                    <span className="fi-t-dot" style={{ background: "var(--ink-3)" }} />
                  </span>
                  <div className="fi-t-who">
                    <div className="fi-t-name-row">
                      <b className="fi-t-name">{pacientes[t.pacienteId]?.nombre ?? "Paciente"}</b>
                    </div>
                    <div className="fi-t-meta">
                      <span>{t.servicio}</span>
                      <span className="fi-cerrados-dot">·</span>
                      <span>{estadoLabel[t.estado] ?? t.estado}</span>
                    </div>
                  </div>
                  <div className="fi-cerrado-cta">
                    <span className="fi-btn fi-btn-ghost">
                      Ver ficha <I.ArrowRight size={11} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
