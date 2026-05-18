"use client";

/**
 * Folio · Dashboard · header de la página /hoy.
 *
 * Port de `PageHeader` en folio/dashboard.jsx (líneas 96-122).
 */

import * as I from "@/components/icons";
import { FECHA_LARGA } from "@/lib/mock-data";
import { minutesTo, relativeTo } from "@/lib/dashboard-helpers";
import type { PacientesById, Turno } from "@/lib/types";

interface PageHeaderProps {
  turnos: Turno[];
  pacientes: PacientesById;
}

export function PageHeader({ turnos, pacientes }: PageHeaderProps) {
  const proximo = turnos.find(
    (t) =>
      ["agendado", "confirmado", "en_sala"].includes(t.estado) &&
      minutesTo(t.hora) >= 0,
  );
  const eta = proximo ? relativeTo(proximo.hora) : null;
  const activos = turnos.filter(
    (t) => !["cerrado", "cancelado", "no_asistio"].includes(t.estado),
  ).length;

  return (
    <header className="fi-page-head">
      <div>
        <span className="fi-eyebrow">{FECHA_LARGA} · 2026</span>
        <h1>Tu agenda hoy</h1>
        <p className="fi-page-sub">
          {activos} turnos por delante
          {eta && proximo ? (
            <>
              <span className="fi-sep">·</span>
              próximo <b>{pacientes[proximo.pacienteId].nombre.split(" ")[0]}</b> {eta}
            </>
          ) : null}
        </p>
      </div>
      <div className="fi-page-actions">
        <button type="button" className="fi-btn fi-btn-ghost">
          <I.Printer size={13} /> Imprimir
        </button>
        <button type="button" className="fi-btn fi-btn-secondary">
          <I.Plus size={13} /> Turno walk-in
        </button>
      </div>
    </header>
  );
}
