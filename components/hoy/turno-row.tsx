"use client";

/**
 * Folio · Dashboard · fila de un turno activo.
 *
 * Port de `TurnoRow` en folio/dashboard.jsx (líneas 127-222). Incluye:
 *  - hora (con G de Google si está sincronizado)
 *  - dot de estado (pulse si en curso)
 *  - nombre + flag de alerta (notas importantes) + pill "Próximo"
 *  - servicio + cronómetro vivo si "atendiendo"
 *  - CTA contextual según estado (Marcar llegada / Abrir ficha / Cerrar turno)
 *  - menú "⋮" con las acciones secundarias (Reagendar / No asistió / Cancelar)
 *  - drag handle (drag-and-drop habilitado en F4)
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

import * as I from "@/components/icons";
import { nombreCortoProfesional } from "@/lib/agenda/profesional";
import { minutesTo, STATE_CONF } from "@/lib/dashboard-helpers";
import { canTransition } from "@/lib/turno-states";
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
  /** Abre el modal de reagendar (estados agendado|confirmado). */
  onReagendar?: (id: string) => void;
}

export function TurnoRow({ turno, paciente, isNext, now, timezone, onTransition, onOpenFicha, onReagendar }: TurnoRowProps) {
  const conf = STATE_CONF[turno.estado as keyof typeof STATE_CONF] ?? STATE_CONF.agendado;
  const isAtendiendo = turno.estado === "atendiendo";
  const isEnSala = turno.estado === "en_sala";
  const isConfirmado = turno.estado === "confirmado";
  const isAgendado = turno.estado === "agendado";

  let cta: CtaSpec | null = null;
  if (isAgendado || isConfirmado) {
    // M57 · flujo de llegada unificado: tanto AGENDADO como CONFIRMADO ofrecen
    // "Marcar llegada" → EN_SALA directo. La confirmación dejó de ser un paso
    // obligatorio en la UI (el trigger M57 habilita AGENDADO→EN_SALA en DB).
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

  // Acciones secundarias que viven en el menú "⋮". Si ninguna aplica al estado
  // actual (terminales: cerrado/cancelado/no_asistio/reagendado), no montamos
  // el trigger del menú.
  const puedeReagendar = (isAgendado || isConfirmado) && onReagendar != null;
  // Gateado por la matriz REAL (no por exclusión): atendiendo solo permite
  // → cerrado, así que "Cancelar" no debe ofrecerse ahí (evita un confirm
  // destructivo que después no-opea — la transición la rechaza applyTransition).
  const puedeCancelar = canTransition(turno.estado, "cancelado");
  const tieneMenu = puedeReagendar || showNoAsistio || puedeCancelar;

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
          {/* Atribución multi-profesional: profesionalNombre solo viene seteado
              en vista "Todos" con >1 colegiado — en orgs Solo o con filtro
              activo es null y este nodo no existe (render histórico intacto). */}
          {turno.profesionalNombre ? (
            <span className="fi-t-prof" title={turno.profesionalNombre}>
              {nombreCortoProfesional(turno.profesionalNombre)}
            </span>
          ) : null}
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
        {/* Acciones secundarias (Reagendar / No asistió / Cancelar) plegadas en
            un menú "⋮": el baseline colapsado de la fila se mantiene y la zona
            de acciones no crece con cada estado. */}
        {tieneMenu ? (
          <TurnoOverflowMenu
            pacienteNombre={paciente.nombre}
            puedeReagendar={puedeReagendar}
            showNoAsistio={showNoAsistio}
            puedeCancelar={puedeCancelar}
            onReagendar={() => onReagendar?.(turno.id)}
            onNoAsistio={() => onTransition(turno.id, "no_asistio")}
            onCancelar={() => onTransition(turno.id, "cancelado")}
          />
        ) : null}
      </div>
    </div>
  );
}

// ─── Menú "⋮" de acciones secundarias ───────────────────────────────────────

interface TurnoOverflowMenuProps {
  pacienteNombre: string;
  puedeReagendar: boolean;
  showNoAsistio: boolean;
  puedeCancelar: boolean;
  onReagendar: () => void;
  onNoAsistio: () => void;
  onCancelar: () => void;
}

/**
 * Popover de acciones secundarias del turno. Accesible a mano (no useModalA11y,
 * que es solo-modal): trigger con aria-haspopup="menu"/aria-expanded, contenedor
 * role="menu" con role="menuitem", Escape cierra y devuelve el foco al trigger,
 * pointerdown afuera cierra. stopPropagation en trigger y menú para que abrirlo
 * NO dispare también el onClick de la fila (→ abrir ficha).
 */
function TurnoOverflowMenu({
  pacienteNombre,
  puedeReagendar,
  showNoAsistio,
  puedeCancelar,
  onReagendar,
  onNoAsistio,
  onCancelar,
}: TurnoOverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Cierre por click/tap afuera + Escape (devolviendo el foco al trigger).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Helper: ejecuta la acción y cierra el menú. Las que tienen window.confirm
  // preservan el guard (acciones terminales en la UI).
  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <div className="fi-t-menu">
      <button
        ref={triggerRef}
        type="button"
        className="fi-btn fi-btn-ghost fi-t-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Más acciones para el turno de ${pacienteNombre}`}
        title="Más acciones"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <span aria-hidden>⋮</span>
      </button>
      {open ? (
        <div
          ref={menuRef}
          className="fi-t-menu-pop"
          role="menu"
          aria-label="Acciones del turno"
          onClick={(e) => e.stopPropagation()}
        >
          {puedeReagendar ? (
            <button
              type="button"
              role="menuitem"
              className="fi-t-menu-item"
              onClick={() => run(onReagendar)}
              title="Mover el turno a otro horario"
            >
              Reagendar
            </button>
          ) : null}
          {showNoAsistio ? (
            <button
              type="button"
              role="menuitem"
              className="fi-t-menu-item"
              onClick={() =>
                run(() => {
                  if (typeof window === "undefined") return;
                  if (!window.confirm(`¿Marcar que ${pacienteNombre} no asistió? El turno queda registrado como "No asistió".`)) return;
                  onNoAsistio();
                })
              }
              title="El paciente no se presentó"
            >
              No asistió
            </button>
          ) : null}
          {puedeCancelar ? (
            <button
              type="button"
              role="menuitem"
              className="fi-t-menu-item fi-t-menu-item--danger"
              onClick={() =>
                run(() => {
                  if (typeof window === "undefined") return;
                  if (!window.confirm(`¿Cancelar el turno de ${pacienteNombre}? Esta acción queda en el audit log y no se puede borrar.`)) return;
                  onCancelar();
                })
              }
              title="Cancelar turno"
            >
              Cancelar
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
