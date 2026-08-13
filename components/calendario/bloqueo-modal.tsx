"use client";

/**
 * Folio · BloqueoModal · marcar vacaciones o una ausencia (D1).
 *
 * Hasta ahora **nadie podía marcar una ausencia en Folio**. La única escritura a
 * `bloqueo` era el sync de Google — y ahí los eventos all-day se descartaban,
 * que es exactamente como se marcan las vacaciones. Peor: Configuración decía
 * que "los bloqueos puntuales se hacen desde el Calendario" y el Calendario no
 * tenía la función.
 *
 * Con `auto_confirmar_reservas` en true (el default), cada paciente que
 * reservaba durante la ausencia quedaba **confirmado**.
 *
 * Dos modos, porque son dos cosas distintas:
 *   - **Días completos** (vacaciones): el `hasta` es INCLUSIVO, porque nadie
 *     dice "me voy del 20 al 28" queriendo volver el 27.
 *   - **Franja horaria** (una tarde, un turno médico propio): el `hasta` es
 *     exclusivo, como cualquier rango de horas.
 *
 * Si el rango pisa turnos ya agendados, el bloqueo **no los cancela** — se
 * avisa para que el profesional los reagende. Un bloqueo que borra turnos en
 * silencio es peor que no tenerlo.
 */

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { crearBloqueoAction } from "@/app/(app)/calendario/actions";
import { useModalA11y } from "@/lib/use-modal-a11y";

type Modo = "dias" | "horas";

export function BloqueoModal({
  /** Día preseleccionado (YYYY-MM-DD) si se abrió desde una celda. */
  fechaInicial,
  onClose,
}: {
  fechaInicial?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const hoy = fechaInicial ?? new Date().toISOString().slice(0, 10);
  const [modo, setModo] = useState<Modo>("dias");
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [horaDesde, setHoraDesde] = useState("09:00");
  const [horaHasta, setHoraHasta] = useState("13:00");
  const [motivo, setMotivo] = useState("");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalA11y(dialogRef, { onClose, closeDisabled: pending });

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    setErr(null);
    setAviso(null);
    startTransition(async () => {
      const result = await crearBloqueoAction(
        modo === "dias"
          ? { modo, desde, hasta, motivo: motivo.trim() || null }
          : {
              modo,
              // Sin offset explícito: el server las resuelve en la timezone de
              // la organización, no en la del browser.
              desde: `${desde}T${horaDesde}:00`,
              hasta: `${desde}T${horaHasta}:00`,
              motivo: motivo.trim() || null,
            },
      );
      if (!result.ok) {
        setErr(result.error.message);
        return;
      }
      if (result.data.turnosEnRango > 0) {
        // No se cierra el modal: el profesional tiene que ver esto.
        setAviso(
          `Bloqueo creado (${result.data.dias} ${result.data.dias === 1 ? "día" : "días"}), pero quedaron ${result.data.turnosEnRango} turno(s) agendados adentro. No los cancelamos — reagendalos vos.`,
        );
        router.refresh();
        return;
      }
      onClose();
      router.refresh();
    });
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="bloqueo-title"
      tabIndex={-1}
      className="a11y-modal-root"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20,14,8,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
      }}
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 10,
          maxWidth: 460,
          width: "100%",
          padding: "20px 22px",
          boxShadow: "0 24px 80px rgba(0,0,0,0.18)",
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
        }}
      >
        <header style={{ marginBottom: 16 }}>
          <span className="fi-eyebrow">agenda</span>
          <h2 id="bloqueo-title" style={{ margin: "4px 0 0", fontSize: 20 }}>
            Bloquear agenda
          </h2>
          <p style={{ margin: "4px 0 0", color: "var(--ink-3)", fontSize: 13 }}>
            Los horarios bloqueados dejan de ofrecerse en tu link público.
          </p>
        </header>

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {(["dias", "horas"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`fi-btn ${modo === m ? "fi-btn-primary" : "fi-btn-ghost"}`}
              onClick={() => setModo(m)}
              aria-pressed={modo === m}
            >
              {m === "dias" ? "Días completos" : "Franja horaria"}
            </button>
          ))}
        </div>

        {modo === "dias" ? (
          <>
            <Field label="Desde">
              <input
                type="date"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
                style={inputStyle}
                required
                autoFocus
              />
            </Field>
            <Field label="Hasta" hint="Incluido: si volvés el 28, poné el 27.">
              <input
                type="date"
                value={hasta}
                min={desde}
                onChange={(e) => setHasta(e.target.value)}
                style={inputStyle}
                required
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="Día">
              <input
                type="date"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
                style={inputStyle}
                required
                autoFocus
              />
            </Field>
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <Field label="Desde">
                  <input
                    type="time"
                    value={horaDesde}
                    onChange={(e) => setHoraDesde(e.target.value)}
                    style={inputStyle}
                    required
                  />
                </Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label="Hasta">
                  <input
                    type="time"
                    value={horaHasta}
                    onChange={(e) => setHoraHasta(e.target.value)}
                    style={inputStyle}
                    required
                  />
                </Field>
              </div>
            </div>
          </>
        )}

        <Field label="Motivo (opcional)" hint="Sólo lo ves vos y tu equipo.">
          <input
            type="text"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            style={inputStyle}
            maxLength={300}
            placeholder="Vacaciones, congreso, turno médico…"
          />
        </Field>

        {err ? (
          <p role="alert" style={{ color: "var(--red)", fontSize: 13, marginTop: 8 }}>
            {err}
          </p>
        ) : null}
        {aviso ? (
          <p role="status" className="au-ok" style={{ marginTop: 8 }}>
            {aviso}
          </p>
        ) : null}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" className="fi-btn fi-btn-ghost" onClick={onClose} disabled={pending}>
            {aviso ? "Cerrar" : "Cancelar"}
          </button>
          {!aviso ? (
            <button type="submit" className="fi-btn fi-btn-primary" disabled={pending} aria-busy={pending}>
              {pending ? "Bloqueando…" : "Bloquear"}
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={{ display: "block", fontSize: 13, color: "var(--ink-3)", marginBottom: 4 }}>
        {label}
      </span>
      {children}
      {hint ? (
        <span style={{ display: "block", fontSize: 12, color: "var(--ink-3)", marginTop: 4 }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 14,
  border: "1px solid var(--line)",
  borderRadius: 6,
  background: "var(--surface)",
  font: "inherit",
};
