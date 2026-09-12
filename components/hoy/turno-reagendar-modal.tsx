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
import { useRouter } from "next/navigation";

import { reagendarTurnoAction, type ReagendarTurnoActionInput } from "@/app/(app)/hoy/actions";
import { useToast } from "@/components/ui/toast";
import {
  isoToLocalDatetimeExact,
  localDatetimeToIso,
  localDatetimeToastLabel,
} from "@/lib/datetime-local";
import { useModalA11y } from "@/lib/use-modal-a11y";

interface TurnoReagendarModalProps {
  turnoId: string;
  /** Only for returning to the original agenda; DB resolves authority itself. */
  profesionalId?: string | null;
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
  profesionalId,
  pacienteNombre,
  servicioNombre,
  inicioIso,
  duracionMin,
  onClose,
  onDone,
}: TurnoReagendarModalProps) {
  // Default EXACTO: el picker abre en la hora actual del turno (review PR #44,
  // M1) — sin el "+5' redondeado" del create modal, que acá corría el horario.
  const [inicioLocal, setInicioLocal] = useState<string>(() => isoToLocalDatetimeExact(inicioIso));
  const [duracion, setDuracion] = useState<number>(duracionMin);
  const [submitting, startTransition] = useTransition();
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const phase = useRef<"idle" | "pending" | "uncertain" | "confirmed">("idle");
  const attempt = useRef<{ input: ReagendarTurnoActionInput; label: string; agenda: string } | null>(null);
  const toast = useToast();
  const router = useRouter();
  const handleClose = () => {
    if (phase.current === "pending") return;
    if (phase.current === "uncertain") {
      router.refresh();
      router.push(attempt.current?.agenda ?? "/calendario");
    }
    onClose();
  };

  // A11y de modal compartida (PR #45): focus trap + Escape (deshabilitado en
  // submit) + foco inicial + restore focus. Ver lib/use-modal-a11y.ts.
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalA11y(dialogRef, { onClose: handleClose, closeDisabled: submitting });

  // Focus inicial en el picker de fecha/hora (a11y teclado).
  const focusTargetRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const t = setTimeout(() => focusTargetRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  const canSubmit = !submitting && !outcomeUnknown && inicioLocal.length > 0 && Number.isInteger(duracion) && duracion >= 5 && duracion <= 480;
  const markUncertain = () => {
    phase.current = "uncertain";
    setOutcomeUnknown(true);
    setSubmitErr("No pudimos confirmar si cambió el turno. Comprobá este mismo intento o revisá la agenda antes de reagendar otra vez.");
  };
  const submitAttempt = () => {
    const pending = attempt.current;
    if (!pending || phase.current === "pending" || phase.current === "confirmed") return;
    const wasUncertain = phase.current === "uncertain";
    phase.current = "pending";
    setSubmitErr(null);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof reagendarTurnoAction>>;
      try { result = await reagendarTurnoAction(pending.input); }
      catch { markUncertain(); return; }
      if (!result.ok) {
        // A denied recovery cannot prove that the earlier request did not commit.
        if (wasUncertain || result.error.code === "network" || result.error.code === "db_error") {
          markUncertain(); return;
        }
        phase.current = "idle";
        attempt.current = null;
        setOutcomeUnknown(false);
        setSubmitErr(result.error.message);
        return;
      }
      phase.current = "confirmed";
      setOutcomeUnknown(false);
      toast.show({
        titulo: `Turno reagendado · ${pending.label}`,
      });
      onDone(result.data.nuevoTurnoId);
    });
  };
  const handleSubmit = () => {
    if (!canSubmit || phase.current !== "idle") return;
    let isoInicio: string;
    try { isoInicio = localDatetimeToIso(inicioLocal); }
    catch { setSubmitErr("Revisá la fecha y hora del turno."); return; }
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Cordoba", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(isoInicio));
    const agenda = new URLSearchParams({ w: day, mes: day.slice(0, 7) });
    if (profesionalId) agenda.set("prof", profesionalId);
    attempt.current = {
      input: { operacionId: crypto.randomUUID(), turnoId, nuevoInicio: isoInicio, nuevaDuracionMin: duracion },
      label: `${localDatetimeToastLabel(inicioLocal)} · ${pacienteNombre}`,
      agenda: `/calendario?${agenda}`,
    };
    submitAttempt();
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="turno-reagendar-title"
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
      // Guard de submit (review PR #44, M2): el click en el overlay no cierra
      // mientras el reagendado está en vuelo — mismo criterio que Escape.
      onClick={handleClose}
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
              disabled={submitting || outcomeUnknown}
              value={inicioLocal}
              onChange={(e) => setInicioLocal(e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Duración (min)">
            <input
              type="number"
              disabled={submitting || outcomeUnknown}
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
          <button type="button" className="fi-btn fi-btn-ghost" onClick={handleClose} disabled={submitting}>
            {outcomeUnknown ? "Ver agenda" : "Cancelar"}
          </button>
          {outcomeUnknown ? (
            <button type="button" className="fi-btn fi-btn-primary" onClick={submitAttempt} disabled={submitting}>
              {submitting ? "Comprobando…" : "Comprobar cambio"}
            </button>
          ) : null}
          {!outcomeUnknown ? <button
            type="button"
            className="fi-btn fi-btn-primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {submitting ? "Reagendando…" : "Reagendar turno"}
          </button> : null}
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
