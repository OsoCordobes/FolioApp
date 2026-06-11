"use client";

/**
 * Folio · Dashboard · fila de un turno activo.
 *
 * Port de `TurnoRow` en folio/dashboard.jsx (líneas 127-222). Incluye:
 *  - hora (con G de Google si está sincronizado)
 *  - dot de estado (pulse si en curso)
 *  - nombre + flag de alerta (notas importantes) + pill "Próximo"
 *  - servicio + cronómetro vivo si "atendiendo"
 *  - CTA contextual según estado (Confirmar / Marcar llegada / Abrir ficha / Cerrar turno)
 *  - drag handle (drag-and-drop habilitado en F4)
 */

import type { ReactNode } from "react";

import * as I from "@/components/icons";
import { minutesTo, STATE_CONF } from "@/lib/dashboard-helpers";
import { useLiveTimer } from "@/lib/use-live-timer";
import type { EstadoTurno, Paciente, Turno } from "@/lib/types";

type CtaKind = "primary" | "secondary" | "primary-brass";

interface CtaSpec {
  kind: CtaKind;
  label: string;
  icon: ReactNode;
  onClick: () => void;
}

interface TurnoRowProps {
  turno: Turno;
  paciente: Paciente;
  isNext: boolean;
  /** "Ahora" — gating de "No asistió" (solo turnos con la hora ya pasada). */
  now?: Date;
  /** IANA timezone de la org. */
  timezone?: string;
  onTransition: (id: string, to: EstadoTurno, extra?: Partial<Turno>) => void;
  onOpenFicha: (id: string) => void;
}

export function TurnoRow({ turno, paciente, isNext, now, timezone, onTransition, onOpenFicha }: TurnoRowProps) {
  const conf = STATE_CONF[turno.estado as keyof typeof STATE_CONF] ?? STATE_CONF.agendado;
  const isAtendiendo = turno.estado === "atendiendo";
  const isEnSala = turno.estado === "en_sala";
  const isConfirmado = turno.estado === "confirmado";
  const isAgendado = turno.estado === "agendado";

  let cta: CtaSpec | null = null;
  if (isAgendado) {
    cta = {
      kind: "secondary",
      label: "Confirmar",
      icon: <I.Check size={12} />,
      onClick: () => onTransition(turno.id, "confirmado"),
    };
  } else if (isConfirmado) {
    cta = {
      kind: isNext ? "primary" : "secondary",
      label: "Marcar llegada",
      icon: <I.ArrowRight size={12} />,
      onClick: () => onTransition(turno.id, "en_sala"),
    };
  } else if (isEnSala) {
    cta = {
      kind: "primary-brass",
      label: "Abrir ficha",
      icon: <I.ArrowRight size={12} />,
      onClick: () => {
        onTransition(turno.id, "atendiendo", { atendiendoDesde: new Date().toISOString() });
        onOpenFicha(turno.id);
      },
    };
  } else if (isAtendiendo) {
    cta = {
      kind: "primary",
      label: "Cerrar turno",
      icon: <I.Check size={12} />,
      onClick: () => {
        // duracionReal: minutos transcurridos desde atendiendoDesde hasta ahora.
        // Si no hay timestamp (no debería pasar en estado atendiendo), default a la
        // duración planificada del turno.
        const fromIso = turno.atendiendoDesde;
        const duracionMin = fromIso
          ? Math.max(1, Math.round((Date.now() - new Date(fromIso).getTime()) / 60000))
          : (turno.duracionMin ?? 45);
        onTransition(turno.id, "cerrado", { duracionMin });
      },
    };
  }

  const time = useLiveTimer(isAtendiendo ? turno.atendiendoDesde : null);
  const hasImportante = (paciente.notasImportantes ?? "").trim().length > 0;

  // "No asistió": solo tiene sentido clínico cuando el turno está AGENDADO o
  // CONFIRMADO y la hora ya pasó (la state machine no lo permite desde
  // EN_SALA/ATENDIENDO — si llegó, no es un no-show). El gating por hora
  // además preserva el baseline visual: a las 08:30 (snapshot) ningún turno
  // activo tiene la hora vencida, así que el botón no aparece.
  const horaPasada = now != null && minutesTo(turno.hora, now, timezone) < 0;
  const showNoAsistio = (isAgendado || isConfirmado) && horaPasada;

  return (
    <div
      onClick={() => onOpenFicha(turno.id)}
      className={[
        "fi-turno",
        "fi-turno--" + turno.estado,
        isAtendiendo ? "is-atendiendo" : "",
        isNext && !isAtendiendo ? "is-next" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="fi-drag" aria-hidden>
        <I.Drag size={14} />
      </span>

      <div className="fi-t-time">
        <b>{turno.hora}</b>
        {turno.gcal ? (
          <span className="fi-t-gcal" title="Sincronizado con Google Calendar">
            <I.Google size={9} />
          </span>
        ) : null}
      </div>

      <span className="fi-t-dot-wrap">
        <span className="fi-t-dot" style={{ background: conf.dot }} />
        {isAtendiendo ? <span className="fi-t-dot-pulse" style={{ background: conf.dot }} /> : null}
      </span>

      <div className="fi-t-who">
        <div className="fi-t-name-row">
          <b className="fi-t-name">{paciente.nombre}</b>
          {hasImportante ? (
            <span className="fi-t-flag fi-t-flag--warn" title={paciente.notasImportantes}>
              <I.Alert size={11} />
            </span>
          ) : null}
          {isNext && !isAtendiendo ? <span className="fi-pill fi-pill--next">Próximo</span> : null}
        </div>
        <div className="fi-t-meta">
          <span>{turno.servicio}</span>
          {isAtendiendo ? (
            <span className="fi-t-live">
              <span className="fi-t-live-dot" />
              En curso · <span className="fi-mono">{time}</span>
            </span>
          ) : null}
        </div>
      </div>

      <div className="fi-t-actions">
        {cta ? (
          <button
            type="button"
            className={"fi-btn fi-btn-" + cta.kind}
            onClick={(e) => {
              e.stopPropagation();
              cta.onClick();
            }}
          >
            {cta.label}
            {cta.icon}
          </button>
        ) : null}
        {/* "No asistió": ghost (mismo patrón que cancelar), solo con la hora
            ya vencida. Confirm previo porque en la UI es terminal. */}
        {showNoAsistio ? (
          <button
            type="button"
            className="fi-btn fi-btn-ghost"
            onClick={(e) => {
              e.stopPropagation();
              if (typeof window === "undefined") return;
              if (!window.confirm(`¿Marcar que ${paciente.nombre} no asistió? El turno queda registrado como "No asistió".`)) return;
              onTransition(turno.id, "no_asistio");
            }}
            title="El paciente no se presentó"
            aria-label={`Marcar que ${paciente.nombre} no asistió`}
          >
            No asistió
          </button>
        ) : null}
        {/* Audit-prep Phase 5: explicit cancel button on every non-terminal state.
            Cancel writes to audit_log via the M12 trigger on turno UPDATE. */}
        {turno.estado !== "cerrado" && turno.estado !== "cancelado" && turno.estado !== "no_asistio" && turno.estado !== "reagendado" ? (
          <button
            type="button"
            className="fi-btn fi-btn-ghost fi-t-cancel"
            onClick={(e) => {
              e.stopPropagation();
              if (typeof window === "undefined") return;
              if (!window.confirm(`¿Cancelar el turno de ${paciente.nombre}? Esta acción queda en el audit log y no se puede borrar.`)) return;
              onTransition(turno.id, "cancelado");
            }}
            title="Cancelar turno"
            aria-label={`Cancelar turno de ${paciente.nombre}`}
          >
            <I.X size={12} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
