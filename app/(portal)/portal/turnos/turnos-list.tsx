"use client";

/**
 * Folio · Portal · lista de turnos + self-service (Fase 3 · P4).
 *
 * Muestra los turnos del paciente (whitelist operativo del server, sin SOAP) y
 * ofrece CANCELAR (fuera de la ventana de corte) y SOLICITAR REAGENDA (nuevo
 * horario propuesto → pedido PENDIENTE que confirma el consultorio). Todas las
 * mutaciones pasan por server actions RLS-enforced; este componente sólo maneja la
 * interacción y refresca el segment tras cada cambio.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { PortalTurnoView } from "@/lib/db/portal-turnos";

import { cancelarTurnoAction, solicitarReagendaAction } from "./actions";

const FMT = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Cordoba",
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

/** Etiqueta legible del estado del turno (no exponemos el enum crudo). */
const ESTADO_LABEL: Record<string, string> = {
  AGENDADO: "Agendado",
  CONFIRMADO: "Confirmado",
  EN_SALA: "En sala",
  ATENDIENDO: "En atención",
  CERRADO: "Atendido",
  NO_ASISTIO: "No asististe",
  CANCELADO: "Cancelado",
  REAGENDADO: "Reprogramado",
};

function formatInicio(iso: string): string {
  try {
    return FMT.format(new Date(iso));
  } catch {
    return iso;
  }
}

export function TurnosList({ turnos }: { turnos: PortalTurnoView[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ id: string; text: string; tone: "ok" | "err" } | null>(null);
  const [reagendaFor, setReagendaFor] = useState<string | null>(null);

  if (turnos.length === 0) {
    return (
      <p className="pt-empty" style={{ color: "var(--ink-2)", fontSize: "var(--fs-sm)" }}>
        Todavía no tenés turnos registrados.
      </p>
    );
  }

  const cancelar = (turnoId: string) => {
    setMsg(null);
    startTransition(async () => {
      const res = await cancelarTurnoAction({ turnoId });
      if (!res.ok) {
        setMsg({ id: turnoId, text: res.error.message, tone: "err" });
        return;
      }
      setMsg({ id: turnoId, text: "Turno cancelado.", tone: "ok" });
      router.refresh();
    });
  };

  const reagendar = (turnoId: string, nuevoInicioLocal: string, motivo: string) => {
    setMsg(null);
    // El <input type="datetime-local"> da hora local sin zona. La interpretamos en
    // AR (UTC-3 fijo) y la mandamos como ISO con offset explícito.
    const isoAr = nuevoInicioLocal ? `${nuevoInicioLocal}:00-03:00` : "";
    if (!isoAr) {
      setMsg({ id: turnoId, text: "Elegí una fecha y hora.", tone: "err" });
      return;
    }
    startTransition(async () => {
      const res = await solicitarReagendaAction({
        turnoId,
        nuevoInicio: isoAr,
        motivo: motivo.trim() || undefined,
      });
      if (!res.ok) {
        setMsg({ id: turnoId, text: res.error.message, tone: "err" });
        return;
      }
      setReagendaFor(null);
      setMsg({
        id: turnoId,
        text: "Solicitud enviada. El consultorio la va a confirmar.",
        tone: "ok",
      });
      router.refresh();
    });
  };

  return (
    <ul className="pt-org-list" style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
      {turnos.map((t) => {
        const activo = t.estado === "AGENDADO" || t.estado === "CONFIRMADO";
        const showMsg = msg && msg.id === t.id ? msg : null;
        return (
          <li key={t.id} className="pt-card" style={{ padding: "16px 18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
              <strong style={{ textTransform: "capitalize" }}>{formatInicio(t.inicio)}</strong>
              <span
                style={{
                  fontSize: "var(--fs-xs, .78rem)",
                  color: activo ? "var(--accent)" : "var(--ink-3)",
                  whiteSpace: "nowrap",
                }}
              >
                {ESTADO_LABEL[t.estado] ?? t.estado}
              </span>
            </div>
            <p style={{ margin: "4px 0 0", color: "var(--ink-2)", fontSize: "var(--fs-sm)" }}>
              {t.organizacionNombre ?? "Consultorio"}
              {t.modalidad === "telemedicina" ? " · Videoconsulta" : ""}
              {" · "}
              {t.duracionMin} min
            </p>

            {activo ? (
              <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="fi-btn fi-btn-ghost"
                  disabled={pending}
                  onClick={() => setReagendaFor(reagendaFor === t.id ? null : t.id)}
                >
                  {reagendaFor === t.id ? "Cerrar" : "Pedir otro horario"}
                </button>
                <button
                  type="button"
                  className="fi-btn fi-btn-danger"
                  disabled={pending || !t.cancelable}
                  title={t.cancelable ? undefined : `Se puede cancelar hasta ${t.cutoffHoras} h antes.`}
                  onClick={() => cancelar(t.id)}
                >
                  Cancelar
                </button>
              </div>
            ) : null}

            {activo && !t.cancelable ? (
              <p style={{ margin: "8px 0 0", color: "var(--ink-3)", fontSize: "var(--fs-xs, .78rem)" }}>
                Para cancelar necesitás avisar con al menos {t.cutoffHoras} h. Llamá al consultorio.
              </p>
            ) : null}

            {reagendaFor === t.id ? (
              <ReagendaForm turnoId={t.id} pending={pending} onSubmit={reagendar} />
            ) : null}

            {showMsg ? (
              <p
                role="status"
                style={{
                  margin: "10px 0 0",
                  fontSize: "var(--fs-sm)",
                  color: showMsg.tone === "err" ? "var(--red)" : "var(--green, #2E7D5B)",
                }}
              >
                {showMsg.text}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function ReagendaForm({
  turnoId,
  pending,
  onSubmit,
}: {
  turnoId: string;
  pending: boolean;
  onSubmit: (turnoId: string, nuevoInicioLocal: string, motivo: string) => void;
}) {
  const [fecha, setFecha] = useState("");
  const [motivo, setMotivo] = useState("");
  return (
    <form
      className="au-form"
      style={{ marginTop: 12 }}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(turnoId, fecha, motivo);
      }}
    >
      <label className="au-field">
        <span>Nuevo horario preferido</span>
        <input
          type="datetime-local"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          disabled={pending}
          required
        />
      </label>
      <label className="au-field">
        <span>Motivo (opcional)</span>
        <input
          type="text"
          maxLength={2000}
          placeholder="Ej.: me surgió un compromiso"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          disabled={pending}
        />
      </label>
      <button type="submit" className="fi-btn fi-btn-primary au-submit" disabled={pending || !fecha}>
        {pending ? "Enviando…" : "Enviar solicitud"}
      </button>
    </form>
  );
}
