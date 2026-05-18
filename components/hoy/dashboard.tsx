"use client";

/**
 * Folio · Dashboard "Hoy" · orchestrator.
 *
 * Port simplificado de `FolioApp` en folio/app.jsx. Tiene la state machine
 * de turnos (transitions + walk-in placeholder) y orquesta PageHeader,
 * KpiStrip y TurnoList. Ficha-panel y walk-in modal se montan vacíos en
 * F1 (no aparecen en el baseline); su UI funcional entra en F4 cuando la
 * persistencia real esté conectada.
 */

import { useMemo, useState } from "react";

import * as I from "@/components/icons";
import { KpiStrip } from "@/components/hoy/kpi-strip";
import { PageHeader } from "@/components/hoy/page-header";
import { TurnoList } from "@/components/hoy/turno-list";
import { NOW_SIM } from "@/lib/dashboard-helpers";
import { PACIENTES, TURNOS_HOY, bootAtendiendoDesde } from "@/lib/mock-data";
import { applyTransition } from "@/lib/turno-states";
import type { EstadoTurno, PacientesById, Turno } from "@/lib/types";

export function Dashboard() {
  // Inicialización lazy: aplica bootAtendiendoDesde con el clock del cliente
  // (mockeado por Playwright en tests, real en producción). Garantiza que
  // `atendiendoDesde` quede a -38min 14s del clock activo, manteniendo el
  // cronómetro determinístico contra el baseline.
  const [turnos, setTurnos] = useState<Turno[]>(() => bootAtendiendoDesde(TURNOS_HOY));
  const [pacientes] = useState<PacientesById>(PACIENTES);
  const [fichaTurnoId, setFichaTurnoId] = useState<number | null>(null);
  const [walkInOpen, setWalkInOpen] = useState(false);

  const handleTransition = (id: number, to: EstadoTurno, extra: Partial<Turno> = {}) => {
    setTurnos((prev) =>
      prev.map((t) => (t.id === id ? applyTransition(t, to, { extra }) : t)),
    );
  };

  const nextId = useMemo<number | undefined>(() => {
    const future = turnos.filter((x) => {
      const [h, m] = x.hora.split(":").map(Number);
      const tt = new Date(NOW_SIM);
      tt.setHours(h, m, 0, 0);
      return (
        tt.getTime() >= NOW_SIM.getTime() &&
        ["agendado", "confirmado", "en_sala"].includes(x.estado)
      );
    });
    return future[0]?.id;
  }, [turnos]);

  return (
    <>
      <div className="fi-content">
        <PageHeader turnos={turnos} pacientes={pacientes} />
        <KpiStrip turnos={turnos} pacientes={pacientes} />
        <TurnoList
          turnos={turnos}
          pacientes={pacientes}
          nextId={nextId}
          onTransition={handleTransition}
          onOpenFicha={(id) => setFichaTurnoId(id)}
        />
      </div>

      {/* FAB walk-in */}
      {!fichaTurnoId && !walkInOpen ? (
        <button type="button" className="fi-fab" onClick={() => setWalkInOpen(true)}>
          <I.Plus size={14} /> Walk-in
        </button>
      ) : null}

      {/* Walk-in modal y ficha-panel se materializan en F4. */}
    </>
  );
}
