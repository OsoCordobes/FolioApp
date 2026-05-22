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

import { useMemo, useState, useTransition } from "react";

import * as I from "@/components/icons";
import { KpiStrip } from "@/components/hoy/kpi-strip";
import { PageHeader } from "@/components/hoy/page-header";
import { TurnoList } from "@/components/hoy/turno-list";
import { TurnoCreateModal } from "@/components/hoy/turno-create-modal";
import { applyTransition } from "@/lib/turno-states";
import { useNow } from "@/lib/use-now";
import type { EstadoTurno, PacientesById, Turno } from "@/lib/types";

import { transitionTurnoAction } from "@/app/(app)/hoy/actions";

interface DashboardProps {
  initialTurnos: Turno[];
  pacientes: PacientesById;
  fechaIso: string; // YYYY-MM-DD
  fechaLarga: string; // "miércoles 13 de mayo"
  fechaAnio: number;
  nowIso: string; // ISO del SSR, hydration-safe
}

export function Dashboard({ initialTurnos, pacientes, fechaIso, fechaLarga, fechaAnio, nowIso }: DashboardProps) {
  const [turnos, setTurnos] = useState<Turno[]>(initialTurnos);
  const [fichaTurnoId, setFichaTurnoId] = useState<string | null>(null);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [, startTransition] = useTransition();
  const now = useNow(nowIso, 60_000);

  /**
   * Optimistic transition + persistencia via Server Action.
   * - Aplica la transición local inmediatamente (UI responsiva).
   * - Dispara `transitionTurnoAction` en server.
   * - Si falla, revierte al estado anterior.
   */
  const handleTransition = (id: string, to: EstadoTurno, extra: Partial<Turno> = {}) => {
    setTurnos((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx === -1) return prev;
      const before = prev[idx];
      const next = applyTransition(before, to, { extra });
      // Si el estado no cambió (transición inválida), no hacer server call.
      if (next === before) return prev;

      const optimistic = [...prev];
      optimistic[idx] = next;

      startTransition(async () => {
        const result = await transitionTurnoAction({
          turnoId: id,
          to,
          duracionRealMin: typeof extra.duracionMin === "number" ? extra.duracionMin : undefined,
        });
        if (!result.ok) {
          console.warn("[hoy] transición rechazada:", result.error.message);
          setTurnos((curr) => curr.map((t) => (t.id === id ? before : t)));
        }
      });

      return optimistic;
    });
  };

  const nextId = useMemo<string | undefined>(() => {
    const [yy, mm, dd] = fechaIso.split("-").map(Number);
    const future = turnos.filter((x) => {
      const [h, m] = x.hora.split(":").map(Number);
      const tt = new Date(yy, mm - 1, dd, h, m, 0, 0);
      return (
        tt.getTime() >= now.getTime() &&
        ["agendado", "confirmado", "en_sala"].includes(x.estado)
      );
    });
    return future[0]?.id;
  }, [turnos, fechaIso, now]);

  return (
    <>
      <div className="fi-content">
        <PageHeader
          turnos={turnos}
          pacientes={pacientes}
          fechaLarga={fechaLarga}
          fechaAnio={fechaAnio}
          now={now}
        />
        <KpiStrip turnos={turnos} pacientes={pacientes} now={now} />
        {turnos.length === 0 ? (
          <EmptyState fechaLarga={fechaLarga} />
        ) : (
          <TurnoList
            turnos={turnos}
            pacientes={pacientes}
            nextId={nextId}
            onTransition={handleTransition}
            onOpenFicha={(id) => setFichaTurnoId(id)}
          />
        )}
      </div>

      {/* FAB walk-in: abre el modal de creación rápida de turno. */}
      {!fichaTurnoId && !walkInOpen ? (
        <button
          type="button"
          className="fi-fab"
          title="Agendar un walk-in (turno ahora)"
          onClick={() => setWalkInOpen(true)}
        >
          <I.Plus size={14} /> Walk-in
        </button>
      ) : null}

      {walkInOpen ? (
        <TurnoCreateModal
          origen="WALK_IN"
          onClose={() => setWalkInOpen(false)}
          onCreated={() => setWalkInOpen(false)}
        />
      ) : null}
    </>
  );
}

function EmptyState({ fechaLarga }: { fechaLarga: string }) {
  return (
    <section className="fi-empty">
      <div className="fi-empty-inner">
        <h2 className="fi-empty-title">Sin turnos para hoy</h2>
        <p className="fi-empty-sub">
          No tenés turnos agendados para el {fechaLarga.toLowerCase()}. Podés crear uno desde
          Calendario o cargar un walk-in.
        </p>
      </div>
    </section>
  );
}
