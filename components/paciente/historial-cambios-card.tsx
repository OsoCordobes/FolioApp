"use client";

/**
 * Folio · card "Historial de cambios" de la ficha.
 *
 * El tercero de los cuatro reportes del quiropráctico: "quiero ver quién tocó
 * qué y cuándo". La infraestructura existía (audit_log con before/after) pero
 * no había ninguna pantalla que la mostrara.
 *
 * Dos cosas deliberadas:
 *
 *   1. COLAPSADA por defecto y con lazy-fetch. Leer el audit cuesta un service
 *      client y varias queries; nadie abre una ficha para auditarla, la abre
 *      para atender. Se paga sólo cuando se pide.
 *
 *   2. Muestra QUÉ campos cambiaron, NUNCA sus valores. No es una limitación:
 *      mostrar el contenido sería reconstruir la historia clínica en una
 *      pantalla que no pasa por la RLS de la ficha. Ver lib/ficha/timeline-core.
 */

import { useState, useTransition } from "react";

import type { EventoTimeline } from "@/lib/ficha/timeline-core";

function fmtFechaHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-AR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function HistorialCambiosCard({
  cargar,
}: {
  cargar: () => Promise<{ ok: true; eventos: EventoTimeline[] } | { ok: false; error: string }>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [eventos, setEventos] = useState<EventoTimeline[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const alternar = () => {
    if (abierto) {
      setAbierto(false);
      return;
    }
    setAbierto(true);
    if (eventos !== null || pending) return;
    setError(null);
    startTransition(async () => {
      const r = await cargar();
      if (r.ok) setEventos(r.eventos);
      else setError(r.error);
    });
  };

  return (
    <section className="pc-card">
      <button
        type="button"
        className="pc-card-head"
        onClick={alternar}
        aria-expanded={abierto}
        style={{
          width: "100%",
          background: "transparent",
          border: 0,
          padding: 0,
          cursor: "pointer",
          textAlign: "left",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span className="fi-eyebrow">Historial de cambios</span>
        <span className="au-fine">{abierto ? "Ocultar" : "Ver"}</span>
      </button>

      {abierto ? (
        <div style={{ marginTop: 12 }}>
          <p className="au-fine" style={{ marginBottom: 10 }}>
            Quién tocó la historia clínica y cuándo. Se muestran los campos que
            cambiaron, no su contenido.
          </p>

          {pending ? <p className="au-fine">Cargando…</p> : null}
          {error ? (
            <p className="au-err" role="alert">
              {error}
            </p>
          ) : null}

          {eventos !== null && eventos.length === 0 ? (
            <p className="au-fine">Todavía no hay cambios registrados en esta ficha.</p>
          ) : null}

          {eventos && eventos.length > 0 ? (
            <div className="fi-historia-timeline">
              {eventos.map((e) => (
                <article key={e.id} className="fi-historia-card">
                  <div className="fi-historia-rail">
                    <span className="fi-historia-rail-dot" aria-hidden />
                    <span className="fi-historia-rail-line" aria-hidden />
                  </div>
                  <div className="fi-historia-card-body">
                    <div className="fi-historia-card-meta">
                      <time dateTime={e.ts}>{fmtFechaHora(e.ts)}</time>
                      {e.actorNombre ? <span> · {e.actorNombre}</span> : null}
                      {e.agrupados > 1 ? (
                        // Una consulta de veinte minutos genera decenas de
                        // autosaves; decir cuántos se agruparon evita que
                        // parezca que hubo un solo toque.
                        <span> · {e.agrupados} ediciones seguidas</span>
                      ) : null}
                    </div>
                    <p className="fi-historia-card-title">{e.titulo}</p>
                    {e.campos.length > 0 ? (
                      <div className="fi-historia-verts">
                        {e.campos.map((c) => (
                          <span key={c} className="fi-historia-vert-chip">
                            {c}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
