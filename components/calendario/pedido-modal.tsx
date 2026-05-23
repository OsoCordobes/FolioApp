"use client";

/**
 * Folio · PedidoModal · UI para aceptar/rechazar un pedido pendiente.
 *
 * Triggereado por click en una pedido-ghost-card en /calendario o por click en
 * una fila de la bandeja. Muestra los datos del pedido (nombre, contacto,
 * fecha/hora propuesta, motivo) y deja al profesional:
 *   - Aceptar → crea paciente si hace falta + crea turno CONFIRMADO + marca
 *     el pedido como CONFIRMADO. Server action: aceptarPedidoAction.
 *   - Rechazar → pide un motivo y marca el pedido como RECHAZADO. Server
 *     action: rechazarPedidoAction.
 *
 * Si el pedido no tiene fecha_propuesta, el accept devuelve error y la UI
 * sugiere crear turno manual desde el calendario (post P0 #4).
 */

import { useEffect, useState, useTransition } from "react";

import {
  aceptarPedidoAction,
  rechazarPedidoAction,
} from "@/app/(app)/calendario/actions";
import type { Pedido } from "@/lib/types";

interface PedidoModalProps {
  pedido: Pedido;
  onClose: () => void;
  onResolved: () => void;
}

export function PedidoModal({ pedido, onClose, onResolved }: PedidoModalProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "reject">("view");
  const [motivo, setMotivo] = useState("");

  // Escape cierra el modal (UX estándar). Solo cuando no estamos en medio
  // de un submit — para no interrumpir una operación en vuelo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  const handleAccept = () => {
    setError(null);
    startTransition(async () => {
      const result = await aceptarPedidoAction(pedido.id);
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cal-pedido-modal-title"
      className="cal-pedido-modal-backdrop"
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
        </dl>

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
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
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
            <button
              type="button"
              className="fi-btn fi-btn-primary"
              onClick={handleAccept}
              disabled={pending || !pedido.fecha}
              title={
                !pedido.fecha
                  ? "Sin fecha propuesta — el aceptar necesita fecha y hora"
                  : undefined
              }
            >
              {pending ? "Aceptando…" : "Aceptar y crear turno"}
            </button>
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
