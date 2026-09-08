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
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { ProfFilterChips } from "@/components/agenda/prof-filter-chips";
import * as I from "@/components/icons";
import { KpiStrip } from "@/components/hoy/kpi-strip";
import { PageHeader } from "@/components/hoy/page-header";
import { TurnoList } from "@/components/hoy/turno-list";
import { TurnoCreateModal } from "@/components/hoy/turno-create-modal";
import { TurnoReagendarModal } from "@/components/hoy/turno-reagendar-modal";
import { useToast } from "@/components/ui/toast";
import type { ProfesionalLite } from "@/lib/agenda/profesional";
import { cobroOptimistaAlCerrar } from "@/lib/hoy/kpi-cobro";
import { applyTransition, isTurnoStatePredecessor } from "@/lib/turno-states";
import { useAgendaAutoRefresh } from "@/lib/use-agenda-refresh";
import { useNow } from "@/lib/use-now";
import type { EstadoTurno, PacientesById, Turno } from "@/lib/types";

import { transitionTurnoAction, type CobroCierreActionInput } from "@/app/(app)/hoy/actions";

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
  /**
   * Checklist "Primeros pasos" (org joven): el Server Component decide si va
   * y arma la card; acá solo se inserta arriba del KpiStrip.
   */
  primerosPasos?: React.ReactNode;
  /**
   * PR #118 · capability real (lib/auth/capabilities → canRegistrarCobro):
   * gates el mini-diálogo de cobro al cerrar. Un rol sin permiso de pagos
   * (COORDINADOR: `pago_write_admin` de M09 lo excluye) cierra directo como
   * antes — no se le ofrece un diálogo cuyo cobro la RLS va a descartar.
   */
  canRegistrarCobro?: boolean;
}

/**
 * C4 · feedback: título del toast por transición de estado confirmada por el
 * server. "atendiendo" queda afuera adrede — abre la ficha, ESO es el feedback.
 */
const TRANSITION_TOAST: Partial<Record<EstadoTurno, string>> = {
  confirmado: "Turno confirmado",
  en_sala: "Llegada marcada",
  cerrado: "Turno cerrado",
  cancelado: "Turno cancelado",
  no_asistio: "No asistió registrado",
};

interface PendingTransition {
  turno: Turno;
  patch: Partial<Turno>;
}

function overlayPending(current: Turno, pending: PendingTransition): Turno {
  return {
    ...current,
    ...pending.patch,
    // A recorded payment wins over the proposed payment, including when SSR
    // still shows the previous appointment state (upsert ignores duplicates).
    cobro: current.cobro?.montoCents != null || !Object.hasOwn(pending.patch, "cobro")
      ? current.cobro : pending.turno.cobro,
  };
}

export function Dashboard({ initialTurnos, pacientes, fechaIso, fechaLarga, fechaAnio, nowIso, timezone, organizationId, profesionales = [], profActivo = null, primerosPasos = null, canRegistrarCobro = true }: DashboardProps) {
  const router = useRouter();
  const toast = useToast();
  const [turnos, setTurnos] = useState<Turno[]>(initialTurnos);
  const [walkInOpen, setWalkInOpen] = useState(false);
  /** Turno con el modal de reagendar abierto (null = cerrado). */
  const [reagendarFor, setReagendarFor] = useState<Turno | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [, startTransition] = useTransition();
  const now = useNow(nowIso, 60_000);
  const currentTurnos = useRef(initialTurnos);
  const pendingTurnos = useRef(new Map<string, PendingTransition>());
  const confirmedTurnos = useRef(new Map<string, Turno>());

  // Resincronizar el estado local cuando el Server Component re-renderiza
  // (revalidatePath tras crear/transicionar un turno, router.refresh del
  // polling). Sin esto, `turnos` quedaba congelado en el primer render y un
  // turno nuevo no aparecía hasta F5. `initialTurnos` es una referencia nueva
  // en cada pasada RSC, así que el efecto corre exactamente en cada refresh.
  useEffect(() => {
    // State transitions cannot go backwards in the DB (M91). A pre-save
    // snapshot stays stale even after an equal-state snapshot has arrived.
    const refreshed = initialTurnos.map((turno) => {
      const confirmed = confirmedTurnos.current.get(turno.id);
      const current = confirmed && isTurnoStatePredecessor(turno.estado, confirmed.estado)
        ? confirmed : turno;
      confirmedTurnos.current.set(turno.id, current);
      const pending = pendingTurnos.current.get(turno.id);
      // A later server state (including cancellation) takes precedence over
      // our in-flight optimism. Unrelated appointments remain independent.
      // Once SSR has reached the requested state, all of its fields are
      // authoritative, including payment and metadata while ACK is pending.
      return pending && isTurnoStatePredecessor(current.estado, pending.turno.estado)
        ? overlayPending(current, pending) : current;
    });
    currentTurnos.current = refreshed;
    setTurnos(refreshed);
  }, [initialTurnos]);

  // Live update: polling 25s con pestaña visible (+ realtime detrás de flag).
  useAgendaAutoRefresh(organizationId ?? null);

  /**
   * Optimistic transition + persistencia via Server Action.
   * - Aplica la transición local inmediatamente (UI responsiva).
   * - Dispara `transitionTurnoAction` en server.
   * - Si falla, revierte al estado anterior y muestra el error inline.
   */
  const handleTransition = (
    id: string,
    to: EstadoTurno,
    extra: Partial<Turno> = {},
    cobro?: CobroCierreActionInput,
  ) => {
    if (pendingTurnos.current.has(id)) return false;
    const before = currentTurnos.current.find((turno) => turno.id === id);
    if (!before) return false;
    const extraConCobro = to === "cerrado"
      ? { ...extra, cobro: cobroOptimistaAlCerrar(before, cobro, new Date().toISOString()) }
      : extra;
    const next = applyTransition(before, to, { extra: extraConCobro });
    if (next === before) return false;

    // Network calls and notifications belong to the event, never to a React
    // state updater: React can replay updaters during concurrent rendering.
    const pending: PendingTransition = {
      turno: next,
      patch: { ...extraConCobro, estado: next.estado, transiciones: next.transiciones },
    };
    pendingTurnos.current.set(id, pending);
    setPendingIds(new Set(pendingTurnos.current.keys()));
    const replaceTurno = (replacement: Turno) => {
      const updated = currentTurnos.current.map((turno) => turno.id === id ? replacement : turno);
      currentTurnos.current = updated;
      setTurnos(updated);
    };
    setTransitionError(null);
    replaceTurno(next);
    startTransition(async () => {
      try {
        const result = await transitionTurnoAction({
          turnoId: id,
          to,
          duracionRealMin: typeof extra.duracionMin === "number" ? extra.duracionMin : undefined,
          // E1 · cobro del mini-diálogo (solo viaja al cerrar).
          cobro,
        });
        if (!result.ok) {
          setTransitionError(result.error.message);
          replaceTurno(confirmedTurnos.current.get(id) ?? before);
          router.refresh();
          return;
        }
        const nombre = pacientes[before.pacienteId]?.nombre ?? "paciente";
        // El cobro NO se registró: revertir SOLO el cobro optimista (el cierre
        // del turno sí valió). Sin esto el KPI "Recaudado" seguía sumando plata
        // que nunca llegó a la tabla `pago` — la misma mentira que este PR
        // vino a eliminar, en versión transitoria.
        if (to === "cerrado" && result.data.pagoRegistrado === false) {
          const withoutPayment = { ...next, cobro: before.cobro };
          pendingTurnos.current.set(id, { turno: withoutPayment, patch: { ...pending.patch, cobro: before.cobro } });
        }
        const settled = pendingTurnos.current.get(id) ?? pending;
        const acknowledged = settled.turno;
        const seen = confirmedTurnos.current.get(id);
        // Keep the barrier after ACK, without keeping the request pending:
        // the user may immediately advance en_sala -> atendiendo -> cerrado.
        let confirmed = seen ? overlayPending(seen, settled) : acknowledged;
        if (seen && !isTurnoStatePredecessor(seen.estado, acknowledged.estado)) {
          // A numeric amount came from a real payment row in the refreshed
          // snapshot. A late ACK has no payment row of its own and must not
          // replace that evidence with the optimistic amount (or rollback).
          confirmed = seen.estado === acknowledged.estado && to === "cerrado" && seen.cobro?.montoCents == null
            ? { ...seen, cobro: acknowledged.cobro } : seen;
        }
        confirmedTurnos.current.set(id, confirmed);
        replaceTurno(confirmed);
        if (confirmed.estado !== to) return;
        // PR #118 · el server confirma si el cobro quedó registrado: cierre y
        // pago NO son atómicos. Si el usuario cargó un cobro y el upsert de
        // `pago` falló (RLS u otro error), el toast de éxito mentía "deuda
        // registrada" — ahora avisa con tono error que hay que cargarlo a mano.
        if (to === "cerrado" && cobro && result.data.pagoRegistrado === false) {
          toast.show({
            titulo: `Turno cerrado, pero no pudimos confirmar el cobro solicitado — revisalo en Finanzas · ${before.hora} · ${nombre}`,
            tono: "error",
          });
          return;
        }
        // C4 · feedback: toast de éxito recién cuando el server confirmó (el
        // update optimista ya se ve en la lista; el toast asegura "se guardó").
        const tituloToast = to === "cerrado" && result.data.pagoRegistrado === true &&
          confirmed.cobro?.estado === "pendiente" && (confirmed.cobro.montoCents ?? 0) > 0
          ? "Turno cerrado · deuda registrada"
          : TRANSITION_TOAST[to];
        if (tituloToast) {
          toast.show({ titulo: `${tituloToast} · ${before.hora} · ${nombre}` });
        }
      } catch {
        replaceTurno(confirmedTurnos.current.get(id) ?? before);
        setTransitionError("Se interrumpió la conexión. Estamos comprobando el estado del turno; revisalo antes de volver a intentar.");
        router.refresh();
      } finally {
        pendingTurnos.current.delete(id);
        setPendingIds(new Set(pendingTurnos.current.keys()));
      }
    });
    return true;
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
        {primerosPasos}
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
            canRegistrarCobro={canRegistrarCobro}
            pendingIds={pendingIds}
            onTransition={handleTransition}
            onReagendar={(turnoId) => {
              if (pendingTurnos.current.has(turnoId)) return;
              const turno = turnos.find((t) => t.id === turnoId);
              if (turno) setReagendarFor(turno);
            }}
            onOpenFicha={(turnoId, transitionStarted) => {
              if (pendingTurnos.current.has(turnoId) && !transitionStarted) return;
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
          // Con el filtro de profesional activo, el walk-in cae en ESA agenda
          // (CLINICA-3, hallazgo F): sin esto el turno se creaba a nombre del
          // usuario de sesión y "desaparecía" de la vista filtrada.
          defaultProfesionalId={profActivo}
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
