"use client";

/**
 * Folio · Portal · lista de turnos + self-service (Fase 3 · P4 · F2 identidad).
 *
 * Muestra los turnos del paciente (whitelist operativo del server, sin SOAP) y
 * ofrece CANCELAR (fuera de la ventana de corte) y SOLICITAR REAGENDA (nuevo
 * horario propuesto → pedido PENDIENTE que confirma el consultorio).
 *
 * REAGENDA CON SLOTS REALES (F2): en vez del datetime-local a ciegas (que
 * proponía horarios ocupados o fuera de agenda), el picker carga la MISMA
 * grilla del booking público (fetchSlotsPublico con el org/servicio/profesional
 * del turno) y agrupa por día (agruparPorDia compartido con el wizard). Si la
 * grilla no está disponible (org deslistada, turno sin servicio, org
 * multi-profesional con turno sin profesional asignado, error transitorio), se
 * degrada al horario libre de siempre — capacidad nunca menor a la histórica.
 *
 * Todas las mutaciones pasan por server actions RLS-enforced; este componente
 * sólo maneja la interacción y refresca el segment tras cada cambio.
 */

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { fetchSlotsPublico } from "@/app/(public)/book/[slug]/actions";
import type { Slot } from "@/lib/booking/availability";
import { agruparPorDia, fmtHora } from "@/lib/booking/slots-format";
import type { PortalTurnoView } from "@/lib/db/portal-turnos";

import { cancelarTurnoAction, solicitarReagendaAction } from "./actions";

// hourCycle explícito (mismo criterio que fmtHora): sin él el ICU de Node
// resuelve es-AR como h12 y el turno del paciente se renderiza en el server
// como "10:00 a. m." (y "10:00" en el browser → mismatch de hidratación).
const FMT = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Cordoba",
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
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

/** Tono del chip de estado — sólo tokens de status (--green/--amber/--red/--slate). */
const ESTADO_TONE: Record<string, "green" | "amber" | "red" | "slate"> = {
  AGENDADO: "slate",
  CONFIRMADO: "green",
  EN_SALA: "green",
  ATENDIENDO: "green",
  CERRADO: "slate",
  NO_ASISTIO: "amber",
  CANCELADO: "red",
  REAGENDADO: "slate",
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
      <div className="pt-empty pt-empty-hero">
        <p className="pt-empty-title">Todavía no tenés turnos registrados</p>
        <p className="pt-empty-sub">
          Cuando tu consultorio agende un turno a tu nombre, lo vas a ver acá.
        </p>
      </div>
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

  const reagendar = (turnoId: string, nuevoInicioIso: string, motivo: string) => {
    setMsg(null);
    if (!nuevoInicioIso) {
      setMsg({ id: turnoId, text: "Elegí una fecha y hora.", tone: "err" });
      return;
    }
    startTransition(async () => {
      const res = await solicitarReagendaAction({
        turnoId,
        nuevoInicio: nuevoInicioIso,
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
    <ul className="pt-org-list">
      {turnos.map((t) => {
        const activo = t.estado === "AGENDADO" || t.estado === "CONFIRMADO";
        const showMsg = msg && msg.id === t.id ? msg : null;
        const tone = ESTADO_TONE[t.estado] ?? "slate";
        return (
          <li key={t.id} className="pt-card">
            <div className="pt-card-row">
              <strong className="pt-card-title pt-cap">{formatInicio(t.inicio)}</strong>
              <span className={`pt-chip pt-chip--${tone}`}>
                {ESTADO_LABEL[t.estado] ?? t.estado}
              </span>
            </div>
            <p className="pt-card-meta">
              {t.organizacionNombre ?? "Consultorio"}
              {t.modalidad === "telemedicina" ? " · Videoconsulta" : ""}
              {" · "}
              {t.duracionMin} min
            </p>

            {activo ? (
              <div className="pt-actions">
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
              <p className="pt-footnote">
                Para cancelar necesitás avisar con al menos {t.cutoffHoras} h. Llamá al
                consultorio.
              </p>
            ) : null}

            {reagendaFor === t.id ? (
              <ReagendaPicker turno={t} pending={pending} onSubmit={reagendar} />
            ) : null}

            {showMsg ? (
              <p
                role="status"
                className={`pt-msg ${showMsg.tone === "err" ? "pt-msg-err" : "pt-msg-ok"}`}
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

/**
 * Picker de reagenda. Dos modos:
 *   · "slots"  — grilla REAL del profesional (fetchSlotsPublico, misma fuente
 *     que el booking público), agrupada por día. Sólo se intenta si el turno
 *     tiene org reservable + servicio; el profesional del turno viaja tal cual
 *     (si es null y la org tiene varios colegiados, el server rechaza y caemos
 *     a manual).
 *   · "manual" — datetime-local libre (comportamiento histórico), fallback
 *     cuando la grilla no está disponible o ningún horario le sirve. Cuando la
 *     caída a manual NO fue elegida por el paciente (grilla falló / no aplica),
 *     lo decimos con una línea arriba del campo — sin aviso, el picker "pobre"
 *     parece el diseño y no una degradación.
 */
function ReagendaPicker({
  turno,
  pending,
  onSubmit,
}: {
  turno: PortalTurnoView;
  pending: boolean;
  onSubmit: (turnoId: string, nuevoInicioIso: string, motivo: string) => void;
}) {
  const puedeCargarSlots = Boolean(turno.organizacionSlug && turno.servicioId);
  const [modo, setModo] = useState<"slots" | "manual">(
    puedeCargarSlots ? "slots" : "manual",
  );
  // true sólo cuando caímos a manual SIN que el paciente lo elija (turno sin
  // org/servicio reservable, o fetchSlotsPublico falló). Los switches
  // voluntarios ("Proponer otro horario") no lo activan.
  const [avisoSinGrilla, setAvisoSinGrilla] = useState(!puedeCargarSlots);
  const [cargando, setCargando] = useState(puedeCargarSlots);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotSel, setSlotSel] = useState<string | null>(null);
  const [fechaManual, setFechaManual] = useState("");
  const [motivo, setMotivo] = useState("");

  useEffect(() => {
    if (!puedeCargarSlots) return;
    let alive = true;
    (async () => {
      const res = await fetchSlotsPublico({
        orgSlug: turno.organizacionSlug!,
        servicioId: turno.servicioId!,
        profesionalId: turno.profesionalId ?? undefined,
        diasAdelante: 14,
      });
      if (!alive) return;
      setCargando(false);
      if (!res.ok) {
        // Grilla no disponible (org deslistada, profesional sin asignar en org
        // multi-prof, error transitorio) → degradar al horario libre, AVISANDO
        // que la grilla no cargó (si no, la degradación es invisible).
        setAvisoSinGrilla(true);
        setModo("manual");
        return;
      }
      setSlots(res.data);
    })();
    return () => {
      alive = false;
    };
  }, [puedeCargarSlots, turno.organizacionSlug, turno.servicioId, turno.profesionalId]);

  const puedeEnviar = modo === "slots" ? slotSel != null : fechaManual !== "";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (modo === "slots") {
      if (!slotSel) return;
      onSubmit(turno.id, slotSel, motivo);
      return;
    }
    // El <input type="datetime-local"> da hora local sin zona. La interpretamos
    // en AR (UTC-3 fijo) y la mandamos como ISO con offset explícito.
    if (!fechaManual) return;
    onSubmit(turno.id, `${fechaManual}:00-03:00`, motivo);
  };

  return (
    <form className="au-form pt-reagenda" onSubmit={submit}>
      {modo === "slots" ? (
        <>
          {cargando ? (
            <div role="status" aria-live="polite" className="pt-reagenda-loading">
              <p className="pt-card-meta">Buscando horarios libres…</p>
              <div className="bk-slot-grid">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="bk-skel bk-skel-slot" />
                ))}
              </div>
            </div>
          ) : slots.length === 0 ? (
            <div className="pt-empty">
              <p className="pt-empty-title">
                No encontramos horarios libres en los próximos 14 días.
              </p>
              <button
                type="button"
                className="fi-btn fi-btn-ghost"
                onClick={() => setModo("manual")}
              >
                Proponer otro horario
              </button>
            </div>
          ) : (
            <>
              <div className="pt-reagenda-slots">
                {agruparPorDia(slots).map(({ dia, items }) => (
                  <div key={dia}>
                    <h4 className="bk-dia-label">{dia}</h4>
                    <div className="bk-slot-grid">
                      {items.map((s) => (
                        <button
                          key={s.inicio}
                          type="button"
                          aria-label={`${dia}, ${fmtHora(s.inicio)} hs`}
                          aria-pressed={slotSel === s.inicio}
                          className={`bk-slot${slotSel === s.inicio ? " is-selected" : ""}`}
                          disabled={pending}
                          onClick={() => setSlotSel(s.inicio)}
                        >
                          {fmtHora(s.inicio)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="pt-link-btn"
                onClick={() => {
                  setSlotSel(null);
                  setModo("manual");
                }}
              >
                ¿Ninguno te sirve? Proponé otro horario
              </button>
            </>
          )}
        </>
      ) : (
        <>
          {avisoSinGrilla ? (
            <p className="pt-footnote">
              No pudimos cargar los horarios disponibles — proponé un horario y
              el consultorio lo confirma.
            </p>
          ) : null}
          <label className="au-field">
            <span>Nuevo horario preferido</span>
            <input
              type="datetime-local"
              value={fechaManual}
              onChange={(e) => setFechaManual(e.target.value)}
              disabled={pending}
              required
            />
            {/* Con el aviso arriba ya dijimos "el consultorio lo confirma";
                repetirlo abajo del campo sería ruido. */}
            {!avisoSinGrilla ? (
              <small className="pt-footnote">
                El consultorio va a revisar si ese horario está disponible.
              </small>
            ) : null}
          </label>
        </>
      )}

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
      <button
        type="submit"
        className="fi-btn fi-btn-primary au-submit"
        disabled={pending || !puedeEnviar}
      >
        {pending ? "Enviando…" : "Enviar solicitud"}
      </button>
    </form>
  );
}
