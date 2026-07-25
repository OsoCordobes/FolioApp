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
import { nombreCortoProfesional } from "@/lib/agenda/profesional";
import { fmtMoney } from "@/lib/dashboard-helpers";
import { computeCobroKpi } from "@/lib/hoy/kpi-cobro";
import type { EstadoTurno, PacientesById, Turno } from "@/lib/types";

import type { CobroCierreActionInput } from "@/app/(app)/hoy/actions";

interface TurnoListProps {
  turnos: Turno[];
  pacientes: PacientesById;
  nextId: string | undefined;
  /** "Ahora" (hydration-safe) — habilita acciones dependientes de la hora ("No asistió"). */
  now?: Date;
  /** IANA timezone de la org, para comparar `turno.hora` contra `now`. */
  timezone?: string;
  /** PR #118 · gate del mini-diálogo de cobro al cerrar (ver TurnoRow). */
  canRegistrarCobro?: boolean;
  onTransition: (id: string, to: EstadoTurno, extra?: Partial<Turno>, cobro?: CobroCierreActionInput) => void;
  onOpenFicha: (id: string) => void;
  /** Abre el modal de reagendar para un turno (sube hasta Dashboard). */
  onReagendar?: (id: string) => void;
  dense?: boolean;
}

interface Group {
  id: string;
  label: string;
  /** Rango horario REAL del grupo ("08 – 12 hs"); null si no es derivable. */
  hoursRange: string | null;
  turnos: Turno[];
}

const CANCELADOS_ESTADOS: EstadoTurno[] = ["cancelado", "no_asistio", "reagendado"];

/**
 * Rango horario real de un grupo, derivado de la primera y última hora de SUS
 * turnos (antes: "09 – 12 hs" / "15 – 18 hs" hardcodeados del prototipo — un
 * turno de 07:45 aparecía bajo un header que decía "09 – 12 hs").
 */
function rangoHorasGrupo(turnos: Turno[]): string | null {
  const horas = turnos
    .map((t) => parseInt(t.hora, 10))
    .filter((h) => Number.isFinite(h) && h >= 0 && h <= 23);
  if (horas.length === 0) return null;
  const pad = (h: number) => String(h).padStart(2, "0");
  const primera = Math.min(...horas);
  const ultima = Math.max(...horas);
  return primera === ultima ? `${pad(primera)} hs` : `${pad(primera)} – ${pad(ultima)} hs`;
}

export function TurnoList({ turnos, pacientes, nextId, now, timezone, canRegistrarCobro = true, onTransition, onOpenFicha, onReagendar, dense }: TurnoListProps) {
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
      { id: "manana", label: "Mañana", hoursRange: rangoHorasGrupo(morning), turnos: morning },
      { id: "tarde", label: "Tarde", hoursRange: rangoHorasGrupo(afternoon), turnos: afternoon },
    ];
  }, [activos]);

  // MISMO criterio que el KPI de arriba (lib/hoy/kpi-cobro.ts): "recaudado" es
  // lo que figura COBRADO en `pago`, no la suma de precios de lista. Sumar
  // `t.precio` acá reponía la contradicción con /finanzas 30px debajo del KPI
  // que la acababa de arreglar — un turno cerrado con "quedó debiendo" no es
  // plata recaudada. La deuda se muestra aparte en vez de esconderse.
  const cerradosCobro = useMemo(() => computeCobroKpi(cerrados), [cerrados]);

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
              {g.hoursRange ? <span className="fi-block-hours">{g.hoursRange}</span> : null}
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
                  now={now}
                  timezone={timezone}
                  canRegistrarCobro={canRegistrarCobro}
                  onTransition={onTransition}
                  onOpenFicha={onOpenFicha}
                  onReagendar={onReagendar}
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
              <span className="fi-mono">{fmtMoney(cerradosCobro.cobradoPesos)}</span> cobrado
              {cerradosCobro.deudaPesos > 0 ? (
                <>
                  <span className="fi-cerrados-dot">·</span>
                  <span className="fi-mono">{fmtMoney(cerradosCobro.deudaPesos)}</span> a cobrar
                </>
              ) : null}
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
                      {t.profesionalNombre ? (
                        <span className="fi-t-prof" title={t.profesionalNombre}>
                          {nombreCortoProfesional(t.profesionalNombre)}
                        </span>
                      ) : null}
                      <span className="fi-cerrados-dot">·</span>
                      <span>{estadoLabel[t.estado] ?? t.estado}</span>
                      {/* M91 · atribución real de la cancelación: sin esto una
                          baja hecha por el paciente (email 1-click o portal) se
                          lee igual que una de mostrador. */}
                      {t.estado === "cancelado" && t.canceladoPorPaciente ? (
                        <span
                          className="fi-chip-canc-paciente"
                          title="El paciente canceló desde el email de recordatorio o el portal"
                        >
                          Canceló el paciente
                        </span>
                      ) : null}
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
