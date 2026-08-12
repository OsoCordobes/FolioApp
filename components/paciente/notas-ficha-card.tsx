"use client";

/**
 * Folio · card "Notas de la ficha" (M96).
 *
 * Lo que pidió el quiropráctico: la ficha de papel "la agarra, la lee y la
 * modifica cuando quiere". Acá se anota sin turno de por medio — la llamada
 * telefónica, el WhatsApp preguntando por una reacción, lo que uno recuerda al
 * día siguiente.
 *
 * Dos decisiones de diseño que no son cosméticas:
 *
 *   1. GUARDADO EXPLÍCITO, sin autosave. La tabla es append-only: un debounce
 *      generaría una fila por pausa de tipeo y la historia clínica quedaría
 *      llena de fragmentos irreversibles. Acá el botón ES la decisión.
 *
 *   2. La fecha y el autor SIEMPRE visibles. Una anotación clínica sin cuándo
 *      ni quién no es un registro, es un post-it.
 *
 * Estilos: clases pc-* de folio.css (tokens de :root), sin librerías.
 */

import { useState, useTransition } from "react";

import { NOTA_CLINICA_MAX } from "@/lib/ficha/nota-clinica";

export interface NotaFichaItem {
  id: string;
  createdAt: string;
  texto: string | null;
  autorNombre: string | null;
}

function fmtFechaCorta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}

function fmtAnio(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : String(d.getFullYear());
}

function fmtFechaHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-AR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function NotasFichaCard({
  notas,
  onAnotar,
}: {
  notas: NotaFichaItem[];
  /** Devuelve un mensaje de error, o null si salió bien. */
  onAnotar: (texto: string) => Promise<string | null>;
}) {
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const limpio = texto.trim();
  const puedeGuardar = limpio.length > 0 && limpio.length <= NOTA_CLINICA_MAX && !pending;

  const anotar = () => {
    if (!puedeGuardar) return;
    setError(null);
    startTransition(async () => {
      const err = await onAnotar(limpio);
      if (err) {
        setError(err);
        return;
      }
      setTexto("");
    });
  };

  return (
    <section className="pc-card">
      <header className="pc-card-head">
        <span className="fi-eyebrow">Notas de la ficha</span>
      </header>

      <p className="au-fine" style={{ marginBottom: 10 }}>
        Para lo que pasa fuera de la consulta: una llamada, un mensaje, algo que
        recordás después. Queda fechado y firmado, y no se puede editar ni
        borrar — si te equivocás, agregás otra nota.
      </p>

      <label className="au-field">
        <span className="sr-only">Nota para la ficha</span>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={3}
          maxLength={NOTA_CLINICA_MAX}
          placeholder="Llamó por la molestia lumbar: cede con hielo, sigue con el plan."
          disabled={pending}
        />
      </label>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          marginTop: 8,
        }}
      >
        <span className="au-fine">
          {limpio.length > 0 ? `${limpio.length} / ${NOTA_CLINICA_MAX}` : ""}
        </span>
        <button
          type="button"
          className="fi-btn fi-btn-secondary"
          onClick={anotar}
          disabled={!puedeGuardar}
        >
          {pending ? "Anotando…" : "Anotar en la ficha"}
        </button>
      </div>

      {error ? (
        <p className="au-err" role="alert" style={{ marginTop: 8 }}>
          {error}
        </p>
      ) : null}

      {notas.length > 0 ? (
        // Adopta el timeline .fi-historia-* que ya vivía en folio.css sin
        // consumidores: mismo lenguaje visual que la Historia de sesiones, así
        // las dos cosas se leen como una sola línea de tiempo.
        <div className="fi-historia-timeline" style={{ marginTop: 16 }}>
          {notas.map((n) => (
            <article key={n.id} className="fi-historia-card">
              <div className="fi-historia-rail">
                <span className="fi-historia-date">{fmtFechaCorta(n.createdAt)}</span>
                <span className="fi-historia-date-year">{fmtAnio(n.createdAt)}</span>
                <span className="fi-historia-rail-dot" aria-hidden />
                <span className="fi-historia-rail-line" aria-hidden />
              </div>
              <div className="fi-historia-card-body">
                <div className="fi-historia-card-meta">
                  <time dateTime={n.createdAt}>{fmtFechaHora(n.createdAt)}</time>
                  {n.autorNombre ? <span> · {n.autorNombre}</span> : null}
                </div>
                {n.texto === null ? (
                  // Una nota ilegible NO se esconde: un hueco silencioso en la
                  // historia clínica es peor que un aviso incómodo.
                  <p className="fi-historia-notas" style={{ color: "var(--ink-3)" }}>
                    <i>No pudimos descifrar esta nota. Avisanos y la recuperamos.</i>
                  </p>
                ) : (
                  <p className="fi-historia-notas">{n.texto}</p>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
