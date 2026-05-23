"use client";

/**
 * Folio · Dashboard · header de la página /hoy.
 *
 * Port de `PageHeader` en folio/dashboard.jsx (líneas 96-122).
 */

import * as I from "@/components/icons";
import { minutesTo, relativeTo } from "@/lib/dashboard-helpers";
import type { PacientesById, Turno } from "@/lib/types";

interface PageHeaderProps {
  turnos: Turno[];
  pacientes: PacientesById;
  fechaLarga: string;
  fechaAnio: number;
  now: Date;
  onOpenWalkIn?: () => void;
}

export function PageHeader({ turnos, pacientes, fechaLarga, fechaAnio, now, onOpenWalkIn }: PageHeaderProps) {
  const proximo = turnos.find(
    (t) =>
      ["agendado", "confirmado", "en_sala"].includes(t.estado) &&
      minutesTo(t.hora, now) >= 0,
  );
  const eta = proximo ? relativeTo(proximo.hora, now) : null;
  const activos = turnos.filter(
    (t) => !["cerrado", "cancelado", "no_asistio"].includes(t.estado),
  ).length;
  const proximoPaciente = proximo ? pacientes[proximo.pacienteId] : null;

  return (
    <header className="fi-page-head">
      <div>
        <span className="fi-eyebrow">{fechaLarga} · {fechaAnio}</span>
        <h1>Tu agenda hoy</h1>
        <p className="fi-page-sub">
          {activos} turnos por delante
          {eta && proximoPaciente ? (
            <>
              <span className="fi-sep">·</span>
              próximo <b>{proximoPaciente.nombre.split(" ")[0]}</b> {eta}
            </>
          ) : null}
        </p>
      </div>
      <div className="fi-page-actions">
        <button
          type="button"
          className="fi-btn fi-btn-ghost"
          onClick={() => window.print()}
          title="Imprimir o exportar a PDF la agenda del día"
        >
          <I.Printer size={13} /> Imprimir
        </button>
        <button
          type="button"
          className="fi-btn fi-btn-secondary"
          onClick={() => onOpenWalkIn?.()}
          title="Agendar un walk-in (turno ahora)"
        >
          <I.Plus size={13} /> Turno walk-in
        </button>
      </div>
    </header>
  );
}
