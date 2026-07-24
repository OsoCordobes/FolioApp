"use client";

/**
 * Folio · PrimerosPasosCard — checklist de activación post-onboarding en /hoy.
 *
 * El Server Component de /hoy decide si se muestra y con qué estado
 * (lib/db/primeros-pasos.ts → computePrimerosPasos): cada check sale de datos
 * REALES de la org, nunca de localStorage. Acá solo vive la interacción:
 *
 *   - compartir_link:   URL pública /book/<slug> + botón Copiar (mismo patrón
 *                       que el Step 9 del onboarding).
 *   - primer_paciente:  abre PacienteCreateModal (el alta real del directorio).
 *   - primer_turno:     abre TurnoCreateModal (origen MANUAL).
 *   - google_calendar:  link a /configuracion#integraciones.
 *   - cobros_mp:        link a /configuracion/billing.
 *   - invitar_equipo:   link a /configuracion#equipo (solo CLINICA — el server
 *                       ya omite el paso en INDEPENDIENTE).
 *
 * Colapso: preferencia de UI (no es estado de tareas) → localStorage por org.
 * Al crear paciente/turno, router.refresh() re-deriva el estado en el server;
 * cuando todo está hecho o la org deja de ser joven, la card desaparece sola.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import * as I from "@/components/icons";
import { TurnoCreateModal } from "@/components/hoy/turno-create-modal";
import { PacienteCreateModal } from "@/components/pacientes/paciente-create-modal";
import type { EspecialidadSlug } from "@/lib/especialidades/meta";
import type { PrimerPasoId, PrimerosPasosEstado } from "@/lib/primeros-pasos";

interface PrimerosPasosCardProps {
  estado: PrimerosPasosEstado;
  /** URL absoluta del booking público (https://…/book/<slug>). */
  bookingUrl: string;
  /** La misma URL sin esquema, para mostrar (patrón Step 9). */
  bookingUrlDisplay: string;
  /** Namespacea la preferencia de colapso en localStorage. */
  organizationId: string;
  /** Especialidad de la org — default del alta de paciente. */
  especialidad: EspecialidadSlug;
  /** true en CLINICA: el alta deja elegir la especialidad del intake. */
  permiteElegirEspecialidad: boolean;
}

const collapseKey = (orgId: string) => `folio:primeros-pasos-colapsado:${orgId}`;

export function PrimerosPasosCard({
  estado,
  bookingUrl,
  bookingUrlDisplay,
  organizationId,
  especialidad,
  permiteElegirEspecialidad,
}: PrimerosPasosCardProps) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [altaOpen, setAltaOpen] = useState(false);
  const [turnoOpen, setTurnoOpen] = useState(false);

  // Hidratar el colapso en un efecto (no en el estado inicial) para que el
  // primer render del cliente coincida con el SSR — mismo criterio que
  // GcalNudgeBanner.
  useEffect(() => {
    try {
      if (localStorage.getItem(collapseKey(organizationId)) === "1") setCollapsed(true);
    } catch {
      // Privacy mode / storage bloqueado: arranca expandida.
    }
  }, [organizationId]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(collapseKey(organizationId), next ? "1" : "0");
      } catch {
        // Best-effort: sin storage, el colapso dura esta vista.
      }
      return next;
    });
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(bookingUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard bloqueado: el link queda visible para copiar a mano.
    }
  };

  // Copy + acción por tarea. El orden y la presencia (invitar_equipo solo en
  // CLINICA) ya vienen decididos por lib/primeros-pasos.ts.
  const filas: Record<PrimerPasoId, { label: string; sub: ReactNode; action: ReactNode }> = {
    compartir_link: {
      label: "Compartí tu link de reservas",
      sub: (
        <a className="fi-pp-url fm-mono" href={bookingUrl} target="_blank" rel="noopener noreferrer">
          {bookingUrlDisplay}
        </a>
      ),
      action: (
        <button
          type="button"
          className={`fi-btn fi-btn-secondary fi-pp-copy ${copied ? "is-copied" : ""}`}
          onClick={onCopy}
        >
          {copied ? (
            <>
              <I.Check size={13} /> Copiado
            </>
          ) : (
            <>
              <I.Copy size={13} /> Copiar
            </>
          )}
        </button>
      ),
    },
    primer_paciente: {
      label: "Cargá tu primer paciente",
      sub: "Su ficha clínica queda lista para la primera consulta.",
      action: (
        <button
          type="button"
          className="fi-btn fi-btn-secondary"
          onClick={() => setAltaOpen(true)}
        >
          <I.Plus size={13} /> Nuevo paciente
        </button>
      ),
    },
    primer_turno: {
      label: "Agendá tu primer turno",
      sub: "Probá la agenda con un turno real o de prueba.",
      action: (
        <button
          type="button"
          className="fi-btn fi-btn-secondary"
          onClick={() => setTurnoOpen(true)}
        >
          <I.Calendar size={13} /> Agendar turno
        </button>
      ),
    },
    google_calendar: {
      label: "Conectá Google Calendar",
      sub: "Tus turnos se reflejan solos y tus eventos personales bloquean horarios.",
      action: (
        <Link href="/configuracion#integraciones" className="fi-btn fi-btn-secondary">
          <I.Google size={13} /> Ir a Integraciones
        </Link>
      ),
    },
    cobros_mp: {
      // "Activá tu suscripción", no "cobros con MP": Folio NO cobra turnos a
      // pacientes (sin MP Connect) — prometerlo acá sería una feature falsa.
      label: "Activá tu suscripción",
      sub: "El pago es por Mercado Pago; seguís usando Folio al terminar la prueba.",
      action: (
        <Link href="/configuracion/billing" className="fi-btn fi-btn-secondary">
          <I.Wallet size={13} /> Ver plan
        </Link>
      ),
    },
    invitar_equipo: {
      label: "Invitá a tu equipo",
      sub: "Sumá profesionales y secretaría a la clínica.",
      action: (
        <Link href="/configuracion#equipo" className="fi-btn fi-btn-secondary">
          <I.Users size={13} /> Invitar
        </Link>
      ),
    },
  };

  const progresoPct =
    estado.total > 0 ? Math.round((estado.completados / estado.total) * 100) : 0;

  return (
    <>
      <section className="fi-pp" aria-labelledby="fi-pp-title">
        <header className="fi-pp-head">
          <div className="fi-pp-head-txt">
            <span className="fi-eyebrow">Primeros pasos</span>
            <h2 id="fi-pp-title">Poné tu consultorio en marcha</h2>
          </div>
          <div className="fi-pp-progress">
            <span className="fi-pp-count fm-mono">
              {estado.completados} de {estado.total}
            </span>
            <div
              className="fi-pp-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={estado.total}
              aria-valuenow={estado.completados}
              aria-label={`Completaste ${estado.completados} de ${estado.total} tareas`}
            >
              <div className="fi-pp-bar-fill" style={{ width: `${progresoPct}%` }} />
            </div>
          </div>
          <button
            type="button"
            className={`fi-pp-toggle ${collapsed ? "is-collapsed" : ""}`}
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-controls="fi-pp-list"
            aria-label={collapsed ? "Mostrar las tareas" : "Ocultar las tareas"}
          >
            <I.ChevronDown size={15} />
          </button>
        </header>

        {!collapsed ? (
          <ul id="fi-pp-list" className="fi-pp-list">
            {estado.pasos.map((paso) => {
              const fila = filas[paso.id];
              return (
                <li key={paso.id} className={`fi-pp-item ${paso.done ? "is-done" : ""}`}>
                  <span className="fi-pp-check" aria-hidden="true">
                    {paso.done ? <I.Check size={12} /> : null}
                  </span>
                  <div className="fi-pp-body">
                    <span className="fi-pp-label">
                      {fila.label}
                      {paso.done ? <span className="sr-only"> (completado)</span> : null}
                    </span>
                    <span className="fi-pp-sub">{fila.sub}</span>
                  </div>
                  <div className="fi-pp-action">
                    {paso.done ? (
                      <span className="fi-pp-done-chip" aria-hidden="true">
                        Listo
                      </span>
                    ) : (
                      fila.action
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      {altaOpen ? (
        <PacienteCreateModal
          especialidad={especialidad}
          permiteElegirEspecialidad={permiteElegirEspecialidad}
          onClose={() => setAltaOpen(false)}
          onCreated={() => setAltaOpen(false)}
        />
      ) : null}

      {turnoOpen ? (
        <TurnoCreateModal
          origen="MANUAL"
          onClose={() => setTurnoOpen(false)}
          onCreated={() => {
            setTurnoOpen(false);
            // createTurnoAction ya revalida /hoy; el refresh fuerza re-derivar
            // el checklist sin esperar al polling.
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
