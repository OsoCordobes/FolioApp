"use client";

/**
 * Folio · TurnoReagendarModal · UI para mover un turno a otro horario.
 *
 * Mismo patrón que TurnoCreateModal (overlay, card con tokens, Escape-guard
 * durante el submit, useTransition, error con role=alert, botones fi-btn).
 * Paciente y servicio son read-only: reagendar conserva paciente, servicio,
 * profesional y precio — solo cambian fecha/hora y (opcionalmente) duración.
 *
 * Submit → reagendarTurnoAction: el turno original queda REAGENDADO (cancela
 * recordatorios + evento de Google Calendar) y se crea uno nuevo AGENDADO.
 */

import { useEffect, useRef, useState, useTransition } from "react";

import { reagendarTurnoAction } from "@/app/(app)/hoy/actions";
import { isoToLocalDatetime, localDatetimeToIso } from "@/lib/datetime-local";

interface TurnoReagendarModalProps {
  turnoId: string;
  pacienteNombre: string;
  servicioNombre: string;
  /** Inicio actual del turno — default del picker de horario nuevo. */
  inicioIso: string;
  duracionMin: number;
  onClose: () => void;
  /** Reagendado OK — el caller cierra y refresca (router.refresh). */
  onDone: (nuevoTurnoId: string) => void;
}

export function TurnoReagendarModal({
  turnoId,
  pacienteNombre,
  servicioNombre,
  inicioIso,
  duracionMin,
  onClose,
  onDone,
}: TurnoReagendarModalProps) {
  const [inicioLocal, setInicioLocal] = useState<string>(() => isoToLocalDatetime(inicioIso));
  const [duracion, setDuracion] = useState<number>(duracionMin);
  const [submitting, startTransition] = useTransition();
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  // Escape cierra el modal cuando no estamos en submit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  // Focus inicial en el picker de fecha/hora (a11y teclado).
  const focusTargetRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const t = setTimeout(() => focusTargetRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  const canSubmit = !submitting && inicioLocal.length > 0 && duracion >= 5 && duracion <= 480;

  const handleSubmit = () => {
    setSubmitErr(null);
    if (!inicioLocal) return;
    const isoInicio = localDatetimeToIso(inicioLocal);
    startTransition(async () => {
      const result = await reagendarTurnoAction({
        turnoId,
        nuevoInicio: isoInicio,
        nuevaDuracionMin: duracion,
      });
      if (!result.ok) {
        setSubmitErr(result.error.message);
        return;
      }
      onDone(result.data.nuevoTurnoId);
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="turno-reagendar-title"
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
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 10,
          maxWidth: 520,
          width: "100%",
          padding: "20px 22px",
          boxShadow: "0 24px 80px rgba(0,0,0,0.18)",
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={{ marginBottom: 16 }}>
          <span className="fi-eyebrow">reagendar turno</span>
          <h2 id="turno-reagendar-title" style={{ margin: "4px 0 0", fontSize: 20 }}>
            Nuevo horario
          </h2>
        </header>

        {/* Paciente / servicio read-only: reagendar no cambia el quién ni el qué. */}
        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: 6,
            padding: "10px 12px",
            marginBottom: 14,
            display: "grid",
            gap: 2,
          }}
        >
          <span style={{ fontWeight: 500 }}>{pacienteNombre}</span>
          <span style={{ fontSize: 13, color: "var(--ink-3)" }}>{servicioNombre}</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 8 }}>
          <Field label="Nueva fecha y hora">
            <input
              ref={focusTargetRef}
              type="datetime-local"
              value={inicioLocal}
              onChange={(e) => setInicioLocal(e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Duración (min)">
            <input
              type="number"
              value={duracion}
              min={5}
              max={480}
              step={5}
              onChange={(e) => setDuracion(Number(e.target.value))}
              style={inputStyle}
            />
          </Field>
        </div>

        <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "0 0 8px" }}>
          El turno actual queda marcado como «Reagendado» y se crea uno nuevo en este horario,
          con sus recordatorios.
        </p>

        {submitErr ? (
          <p role="alert" style={{ color: "var(--red)", fontSize: 13, marginTop: 8 }}>
            {submitErr}
          </p>
        ) : null}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" className="fi-btn fi-btn-ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </button>
          <button
            type="button"
            className="fi-btn fi-btn-primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {submitting ? "Reagendando…" : "Reagendar turno"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <span style={{ display: "block", fontSize: 13, color: "var(--ink-3)", marginBottom: 4 }}>
        {label}
      </span>
      {children}
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
