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

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import { ProfFilterChips } from "@/components/agenda/prof-filter-chips";
import * as I from "@/components/icons";
import { KpiStrip } from "@/components/hoy/kpi-strip";
import { PageHeader } from "@/components/hoy/page-header";
import { TurnoList } from "@/components/hoy/turno-list";
import { TurnoCreateModal } from "@/components/hoy/turno-create-modal";
import { TurnoReagendarModal } from "@/components/hoy/turno-reagendar-modal";
import type { ProfesionalLite } from "@/lib/agenda/profesional";
import { applyTransition } from "@/lib/turno-states";
import { useAgendaAutoRefresh } from "@/lib/use-agenda-refresh";
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
  /** IANA timezone de la org — los labels "próximo en X min" se calculan acá. */
  timezone: string;
  /** Org activa — habilita el live update (polling / realtime tras flag). */
  organizationId?: string;
  /**
   * Modo clínica: colegiados para el selector de profesional. Lista vacía
   * (default) = sin selector — el render histórico de orgs Solo no cambia.
   */
  profesionales?: ProfesionalLite[];
  /** member.id activo en el filtro `?prof=`; null = "Todos". */
  profActivo?: string | null;
}

export function Dashboard({ initialTurnos, pacientes, fechaIso, fechaLarga, fechaAnio, nowIso, timezone, organizationId, profesionales = [], profActivo = null }: DashboardProps) {
  const router = useRouter();
  const [turnos, setTurnos] = useState<Turno[]>(initialTurnos);
  const [walkInOpen, setWalkInOpen] = useState(false);
  /** Turno con el modal de reagendar abierto (null = cerrado). */
  const [reagendarFor, setReagendarFor] = useState<Turno | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const now = useNow(nowIso, 60_000);

  // Resincronizar el estado local cuando el Server Component re-renderiza
  // (revalidatePath tras crear/transicionar un turno, router.refresh del
  // polling). Sin esto, `turnos` quedaba congelado en el primer render y un
  // turno nuevo no aparecía hasta F5. `initialTurnos` es una referencia nueva
  // en cada pasada RSC, así que el efecto corre exactamente en cada refresh.
  useEffect(() => {
    setTurnos(initialTurnos);
  }, [initialTurnos]);

  // Live update: polling 25s con pestaña visible (+ realtime detrás de flag).
  useAgendaAutoRefresh(organizationId ?? null);

  /**
   * Optimistic transition + persistencia via Server Action.
   * - Aplica la transición local inmediatamente (UI responsiva).
   * - Dispara `transitionTurnoAction` en server.
   * - Si falla, revierte al estado anterior y muestra el error inline.
   */
  const handleTransition = (id: string, to: EstadoTurno, extra: Partial<Turno> = {}) => {
    setTransitionError(null);
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
          setTransitionError(result.error.message);
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
          timezone={timezone}
          onOpenWalkIn={() => setWalkInOpen(true)}
        />
        {profesionales.length > 1 ? (
          <ProfFilterChips
            profesionales={profesionales}
            profActivo={profActivo}
            hrefFor={(id) => (id ? `/hoy?prof=${id}` : "/hoy")}
          />
        ) : null}
        <KpiStrip turnos={turnos} pacientes={pacientes} now={now} timezone={timezone} />
        {transitionError ? (
          <div
            role="alert"
            style={{
              margin: "12px 0",
              padding: "10px 14px",
              background: "var(--red-soft, #fee2e2)",
              color: "var(--red, #991b1b)",
              borderRadius: 8,
              fontSize: 14,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span>No se pudo guardar el cambio: {transitionError}</span>
            <button
              type="button"
              onClick={() => setTransitionError(null)}
              style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer", fontSize: 16, padding: 0 }}
              aria-label="Cerrar mensaje"
            >
              ×
            </button>
          </div>
        ) : null}
        {turnos.length === 0 ? (
          <EmptyState fechaLarga={fechaLarga} />
        ) : (
          <TurnoList
            turnos={turnos}
            pacientes={pacientes}
            nextId={nextId}
            now={now}
            timezone={timezone}
            onTransition={handleTransition}
            onReagendar={(turnoId) => {
              const turno = turnos.find((t) => t.id === turnoId);
              if (turno) setReagendarFor(turno);
            }}
            onOpenFicha={(turnoId) => {
              // Side panel-style ficha planeado para sprint posterior. Mientras
              // tanto, navegar a la ficha completa del paciente — toda la info
              // clínica + plan + sesiones está allí.
              const turno = turnos.find((t) => t.id === turnoId);
              if (turno) router.push(`/pacientes/${turno.pacienteId}`);
            }}
          />
        )}
      </div>

      {/* FAB walk-in: abre el modal de creación rápida de turno. */}
      {!walkInOpen ? (
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

      {/* Modal de reagendar: el inicio actual se arma de fechaIso (/hoy es un
          día puntual) + hora local del turno — solo es el default del picker. */}
      {reagendarFor ? (
        <TurnoReagendarModal
          turnoId={reagendarFor.id}
          pacienteNombre={pacientes[reagendarFor.pacienteId]?.nombre ?? "Paciente"}
          servicioNombre={reagendarFor.servicio}
          inicioIso={`${fechaIso}T${reagendarFor.hora}`}
          duracionMin={reagendarFor.duracionMin ?? 45}
          onClose={() => setReagendarFor(null)}
          onDone={() => {
            setReagendarFor(null);
            router.refresh();
          }}
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
          No tenés turnos agendados para el {fechaLarga.toLowerCase()}. Creá uno con el botón
          «Turno walk-in» o compartí tu link de reservas online (lo encontrás en Configuración)
          para que tus pacientes pidan turno solos.
        </p>
      </div>
    </section>
  );
}
