"use client";

/**
 * Folio · PedidoModal · UI para aceptar/rechazar un pedido pendiente.
 *
 * Triggereado por click en una pedido-ghost-card en /calendario o por click en
 * una fila de la bandeja. Muestra los datos del pedido (nombre, contacto,
 * fecha/hora propuesta, motivo) y deja al profesional:
 *   - Aceptar → crea paciente si hace falta + crea turno CONFIRMADO + marca
 *     el pedido como CONFIRMADO. Server action: aceptarPedidoAction.
 *   - Aceptar con OTRO horario → para pedidos sin fecha propuesta (WhatsApp/
 *     teléfono), sin servicio, o cuyo horario se ocupó: picker de fecha+hora
 *     (+servicio si falta) y aceptarPedidoConHorarioAction — el pedido queda
 *     CONFIRMADO y el turno se crea con el origen del canal preservado.
 *   - Crear turno manual (escape hatch dentro de "otro horario") → delega en
 *     el TurnoCreateModal del caller CON pedido.id vinculado: al crear el
 *     turno, el server confirma el pedido (antes quedaba PENDIENTE eterno).
 *   - Rechazar → pide un motivo y marca el pedido como RECHAZADO. Server
 *     action: rechazarPedidoAction.
 *
 * CLINICA-3: si el pedido NO trae profesional asignado (booking sin
 * preferencia / WhatsApp), con >1 colegiado se muestra el picker de
 * profesional (mismo patrón que TurnoCreateModal); con 1 solo colegiado se
 * manda ese sin picker. El server (aceptarPedido / aceptarPedidoConHorario)
 * valida el destino como colegiado activo — se eliminó el fallback silencioso
 * a la sesión, que convertía a la secretaria en "profesional" del turno.
 */

import { useEffect, useRef, useState, useTransition } from "react";

import {
  aceptarPedidoAction,
  aceptarPedidoConHorarioAction,
  listServiciosActivosAction,
  rechazarPedidoAction,
  type ServicioPedidoPickerRow,
} from "@/app/(app)/calendario/actions";
import { resolvePickerProfesional, type ProfesionalLite } from "@/lib/agenda/profesional";
import { isoToLocalDatetime, localDatetimeToIso } from "@/lib/datetime-local";
import type { Pedido } from "@/lib/types";
import { useModalA11y } from "@/lib/use-modal-a11y";

interface PedidoModalProps {
  pedido: Pedido;
  /**
   * Colegiados activos de la org (lista COMPLETA, independiente del selector
   * de agenda) — alimenta el picker cuando el pedido no trae profesional.
   */
  colegiados?: ProfesionalLite[];
  /** member.id de la sesión — default del picker si es colegiado. */
  sessionMemberId?: string | null;
  /** Filtro `?prof=` activo en la agenda — preferencia del default. */
  profActivo?: string | null;
  /**
   * Escape hatch "crear turno manual": el caller cierra este modal y abre el
   * TurnoCreateModal con pedido.id vinculado (el server confirma el pedido al
   * crear el turno). Sin callback, el link no se renderiza.
   */
  onCrearTurnoManual?: () => void;
  onClose: () => void;
  onResolved: () => void;
}

export function PedidoModal({
  pedido,
  colegiados = [],
  sessionMemberId = null,
  profActivo = null,
  onCrearTurnoManual,
  onClose,
  onResolved,
}: PedidoModalProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "reject" | "horario">("view");
  const [motivo, setMotivo] = useState("");

  // "Aceptar con otro horario": fecha+hora elegidas (datetime-local, misma
  // semántica que TurnoCreateModal) y servicio si el pedido no trae uno
  // (pedidos de WhatsApp llegan con servicio_id null). Los servicios se
  // cargan lazy al entrar al modo.
  const necesitaServicio = pedido.servicioId == null;
  const [inicioLocal, setInicioLocal] = useState<string>(() => isoToLocalDatetime());
  const [servicios, setServicios] = useState<ServicioPedidoPickerRow[] | null>(null);
  const [servicioSel, setServicioSel] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "horario" || !necesitaServicio || servicios != null) return;
    let cancelled = false;
    (async () => {
      const res = await listServiciosActivosAction();
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error.message);
        setServicios([]);
        return;
      }
      setServicios(res.data);
      if (res.data.length > 0) setServicioSel(res.data[0].id);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, necesitaServicio, servicios]);

  // Picker de profesional: solo cuando el pedido no trae uno asignado. El
  // default (decisión pura) prioriza filtro activo > sesión colegiada >
  // primer colegiado; el <select> aparece únicamente con >1 colegiado.
  const necesitaProfesional = pedido.profesionalId == null;
  const picker = resolvePickerProfesional({
    profesionales: colegiados,
    sessionMemberId: sessionMemberId ?? "",
    preferidoId: profActivo,
  });
  const [profesionalSel, setProfesionalSel] = useState<string | null>(
    picker.defaultProfesionalId,
  );
  const profesionalAsignadoNombre = pedido.profesionalId
    ? colegiados.find((c) => c.id === pedido.profesionalId)?.displayName ?? null
    : null;

  // A11y de modal compartida: focus trap + Escape (deshabilitado en submit) +
  // foco inicial + restore focus al cerrar. Ver lib/use-modal-a11y.ts.
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalA11y(dialogRef, { onClose, closeDisabled: pending });

  const handleAccept = () => {
    setError(null);
    startTransition(async () => {
      const result = await aceptarPedidoAction(
        pedido.id,
        // El profesional elegido solo viaja cuando el pedido no trae uno
        // propio; el server lo valida como colegiado activo de la org.
        necesitaProfesional ? profesionalSel ?? undefined : undefined,
      );
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      onResolved();
    });
  };

  const handleReject = () => {
    setError(null);
    if (motivo.trim().length < 5) {
      setError("El motivo necesita al menos 5 caracteres.");
      return;
    }
    startTransition(async () => {
      const result = await rechazarPedidoAction(pedido.id, motivo.trim());
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      onResolved();
    });
  };

  // Submit de "aceptar con otro horario". El server (aceptarPedidoConHorario)
  // re-valida todo: solapamiento del slot nuevo, servicio activo de la org y
  // profesional colegiado — los guards de acá son solo UX.
  const canSubmitHorario =
    !pending &&
    inicioLocal.length > 0 &&
    (!necesitaServicio || servicioSel != null) &&
    (!necesitaProfesional || !picker.pickerVisible || profesionalSel != null);

  const handleAcceptConHorario = () => {
    setError(null);
    if (!canSubmitHorario) return;
    startTransition(async () => {
      const result = await aceptarPedidoConHorarioAction(pedido.id, {
        fechaHora: localDatetimeToIso(inicioLocal),
        // El servicio solo viaja cuando el pedido no trae uno propio.
        servicioId: necesitaServicio ? servicioSel ?? undefined : undefined,
        // Ídem profesional: solo cuando el pedido no trae destino.
        profesionalId: necesitaProfesional ? profesionalSel ?? undefined : undefined,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      onResolved();
    });
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cal-pedido-modal-title"
      tabIndex={-1}
      className="cal-pedido-modal-backdrop a11y-modal-root"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20, 14, 8, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        className="cal-pedido-modal"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 10,
          maxWidth: 480,
          width: "100%",
          padding: "20px 22px",
          boxShadow: "0 24px 80px rgba(0,0,0,0.18)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={{ marginBottom: 14 }}>
          <span className="fi-eyebrow">pedido entrante</span>
          <h2 id="cal-pedido-modal-title" style={{ margin: "4px 0 0", fontSize: 20 }}>
            {pedido.nombre}
          </h2>
          <p style={{ margin: "4px 0 0", color: "var(--ink-3)", fontSize: 13 }}>
            {pedido.canal === "web"
              ? "Pedido por reserva web"
              : `Pedido vía ${pedido.canal}`}
            {" · recibido "}
            {pedido.recibidoHace}
          </p>
        </header>

        <dl
          style={{
            margin: "0 0 14px",
            display: "grid",
            gridTemplateColumns: "minmax(110px, max-content) 1fr",
            rowGap: 6,
            columnGap: 12,
            fontSize: 14,
          }}
        >
          {pedido.fecha && pedido.hora ? (
            <>
              <dt style={{ color: "var(--ink-3)" }}>Fecha</dt>
              <dd style={{ margin: 0 }} className="fm-mono">
                {pedido.fecha} · {pedido.hora}
                {" · "}
                {pedido.dur} min
              </dd>
            </>
          ) : (
            <>
              <dt style={{ color: "var(--ink-3)" }}>Fecha</dt>
              <dd style={{ margin: 0, color: "var(--amber, #92400e)" }}>
                Sin fecha propuesta
              </dd>
            </>
          )}
          <dt style={{ color: "var(--ink-3)" }}>Teléfono</dt>
          <dd style={{ margin: 0 }} className="fm-mono">
            {pedido.tel || "—"}
          </dd>
          {pedido.email ? (
            <>
              <dt style={{ color: "var(--ink-3)" }}>Email</dt>
              <dd style={{ margin: 0 }} className="fm-mono">
                {pedido.email}
              </dd>
            </>
          ) : null}
          {pedido.precio > 0 ? (
            <>
              <dt style={{ color: "var(--ink-3)" }}>Precio</dt>
              <dd style={{ margin: 0 }} className="fm-mono">
                ${pedido.precio.toLocaleString("es-AR")}
              </dd>
            </>
          ) : null}
          {pedido.nuevo ? (
            <>
              <dt style={{ color: "var(--ink-3)" }}>Paciente</dt>
              <dd style={{ margin: 0 }}>Nuevo — se va a crear al aceptar</dd>
            </>
          ) : null}
          {profesionalAsignadoNombre ? (
            <>
              <dt style={{ color: "var(--ink-3)" }}>Profesional</dt>
              <dd style={{ margin: 0 }}>{profesionalAsignadoNombre}</dd>
            </>
          ) : null}
        </dl>

        {/* Picker de profesional (CLINICA-3): el pedido vino sin preferencia
            y la org tiene >1 colegiado — hay que decidir QUIÉN lo atiende.
            Visible también en "otro horario" (mismo destino, otra fecha). */}
        {(mode === "view" || mode === "horario") && necesitaProfesional && picker.pickerVisible ? (
          <label style={{ display: "block", marginBottom: 14 }}>
            <span
              style={{ display: "block", fontSize: 13, color: "var(--ink-3)", marginBottom: 4 }}
            >
              Profesional que lo atiende
            </span>
            <select
              value={profesionalSel ?? ""}
              onChange={(e) => setProfesionalSel(e.target.value || null)}
              disabled={pending}
              style={{
                width: "100%",
                padding: "8px 10px",
                fontSize: 14,
                border: "1px solid var(--line)",
                borderRadius: 6,
                background: "var(--surface)",
                font: "inherit",
              }}
            >
              {colegiados.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {pedido.motivo ? (
          <p
            style={{
              margin: "0 0 14px",
              fontSize: 14,
              lineHeight: 1.5,
              padding: 10,
              background: "var(--surface-soft, #faf8f4)",
              borderLeft: "2px solid var(--accent, #8A6722)",
              borderRadius: 4,
            }}
          >
            {pedido.motivo}
          </p>
        ) : null}

        {error ? (
          <p
            role="alert"
            style={{
              margin: "0 0 12px",
              color: "var(--red, #9B3A2A)",
              fontSize: 13,
            }}
          >
            {error}
          </p>
        ) : null}

        {mode === "view" ? (
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button
              type="button"
              className="fi-btn fi-btn-ghost"
              onClick={onClose}
              disabled={pending}
            >
              Cerrar
            </button>
            <button
              type="button"
              className="fi-btn fi-btn-ghost"
              onClick={() => setMode("reject")}
              disabled={pending}
            >
              Rechazar
            </button>
            {pedido.fecha ? (
              <>
                <button
                  type="button"
                  className="fi-btn fi-btn-ghost"
                  onClick={() => {
                    setError(null);
                    setMode("horario");
                  }}
                  disabled={pending}
                  title="Aceptar el pedido en un horario distinto al propuesto"
                >
                  Otro horario
                </button>
                <button
                  type="button"
                  className="fi-btn fi-btn-primary"
                  onClick={handleAccept}
                  disabled={
                    pending ||
                    (necesitaProfesional && picker.pickerVisible && !profesionalSel)
                  }
                >
                  {pending ? "Aceptando…" : "Aceptar y crear turno"}
                </button>
              </>
            ) : (
              // Sin fecha propuesta (WhatsApp/teléfono): el acepte directo no
              // existe — el camino es elegir horario (y servicio si falta).
              <button
                type="button"
                className="fi-btn fi-btn-primary"
                onClick={() => {
                  setError(null);
                  setMode("horario");
                }}
                disabled={pending}
              >
                Elegir horario y aceptar
              </button>
            )}
          </div>
        ) : mode === "horario" ? (
          <div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: necesitaServicio ? "1fr 1fr" : "1fr",
                gap: 8,
              }}
            >
              <label style={{ display: "block", marginBottom: 10 }}>
                <span
                  style={{ display: "block", fontSize: 13, color: "var(--ink-3)", marginBottom: 4 }}
                >
                  Fecha y hora del turno
                </span>
                <input
                  type="datetime-local"
                  value={inicioLocal}
                  onChange={(e) => setInicioLocal(e.target.value)}
                  disabled={pending}
                  autoFocus
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    fontSize: 14,
                    border: "1px solid var(--line)",
                    borderRadius: 6,
                    background: "var(--surface)",
                    font: "inherit",
                  }}
                />
              </label>
              {necesitaServicio ? (
                <label style={{ display: "block", marginBottom: 10 }}>
                  <span
                    style={{ display: "block", fontSize: 13, color: "var(--ink-3)", marginBottom: 4 }}
                  >
                    Servicio
                  </span>
                  {servicios == null ? (
                    <p style={{ margin: 0, fontSize: 13, color: "var(--ink-3)" }}>Cargando…</p>
                  ) : servicios.length === 0 ? (
                    <p style={{ margin: 0, fontSize: 13, color: "var(--ink-3)" }}>
                      No tenés servicios activos. Crealos desde Configuración.
                    </p>
                  ) : (
                    <select
                      value={servicioSel ?? ""}
                      onChange={(e) => setServicioSel(e.target.value || null)}
                      disabled={pending}
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        fontSize: 14,
                        border: "1px solid var(--line)",
                        borderRadius: 6,
                        background: "var(--surface)",
                        font: "inherit",
                      }}
                    >
                      {servicios.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.nombre} · {s.duracionMin} min
                        </option>
                      ))}
                    </select>
                  )}
                </label>
              ) : null}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
              <button
                type="button"
                className="fi-btn fi-btn-ghost"
                onClick={() => {
                  setError(null);
                  setMode("view");
                }}
                disabled={pending}
              >
                Volver
              </button>
              <button
                type="button"
                className="fi-btn fi-btn-primary"
                onClick={handleAcceptConHorario}
                disabled={!canSubmitHorario}
              >
                {pending ? "Aceptando…" : "Aceptar y crear turno"}
              </button>
            </div>
            {onCrearTurnoManual ? (
              <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--ink-3)", textAlign: "right" }}>
                ¿Preferís cargar todo a mano?{" "}
                <button
                  type="button"
                  onClick={onCrearTurnoManual}
                  disabled={pending}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    font: "inherit",
                    fontSize: 13,
                    color: "var(--accent, #8A6722)",
                    textDecoration: "underline",
                    cursor: "pointer",
                  }}
                >
                  Crear turno manual
                </button>{" "}
                (el pedido queda confirmado al crearlo).
              </p>
            ) : null}
          </div>
        ) : (
          <div>
            <label style={{ display: "block", fontSize: 13, color: "var(--ink-3)", marginBottom: 4 }}>
              Motivo del rechazo (queda en el historial)
            </label>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              maxLength={500}
              autoFocus
              placeholder="Ej.: ya no tomo casos nuevos este mes; horario no disponible…"
              style={{
                width: "100%",
                padding: 8,
                fontSize: 14,
                border: "1px solid var(--line)",
                borderRadius: 6,
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
              <button
                type="button"
                className="fi-btn fi-btn-ghost"
                onClick={() => setMode("view")}
                disabled={pending}
              >
                Volver
              </button>
              <button
                type="button"
                className="fi-btn fi-btn-primary"
                onClick={handleReject}
                disabled={pending}
              >
                {pending ? "Rechazando…" : "Confirmar rechazo"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
