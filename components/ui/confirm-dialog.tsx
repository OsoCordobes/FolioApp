"use client";

/**
 * Folio · ConfirmDialog · reemplazo con diseño de window.confirm (C4).
 *
 * El diálogo nativo del browser rompía el tema brass/cream justo en las
 * acciones más delicadas del flujo (cancelar turno, no-asistió, WhatsApp
 * masivo). Este modal chico clona el patrón de estructura + a11y de
 * components/calendario/turno-detalle-modal.tsx: useModalA11y (focus trap +
 * Escape + restore focus), backdrop clickeable, card con tokens.
 *
 * Detalles:
 *  - role="alertdialog": es una confirmación que interrumpe.
 *  - El PRIMER focusable es "Volver" (cancel): Enter apurado no ejecuta la
 *    acción destructiva — hay que tabular o clickear el botón de confirmar.
 *  - variant="danger" pinta el confirm con .fi-btn-danger (ya existe en
 *    folio.css) para cancelaciones/acciones sin vuelta atrás.
 *  - stopPropagation en backdrop y card: el dialog puede montarse dentro de
 *    filas clickeables (TurnoRow abre la ficha con onClick) sin dispararlas.
 */

import { useRef, type ReactNode } from "react";

import { useModalA11y } from "@/lib/use-modal-a11y";

export interface ConfirmDialogProps {
  titulo: string;
  /** Cuerpo opcional del diálogo (string o nodos). */
  mensaje?: ReactNode;
  /** Label del botón que ejecuta la acción. Default "Confirmar". */
  confirmLabel?: string;
  /** Label del botón que cierra sin ejecutar. Default "Volver". */
  cancelLabel?: string;
  /** "danger" pinta el confirm en rojo (.fi-btn-danger). */
  variant?: "default" | "danger";
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  titulo,
  mensaje,
  confirmLabel = "Confirmar",
  cancelLabel = "Volver",
  variant = "default",
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalA11y(dialogRef, { onClose });

  return (
    <div
      ref={dialogRef}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="fi-confirm-title"
      aria-describedby={mensaje ? "fi-confirm-msg" : undefined}
      tabIndex={-1}
      className="a11y-modal-root"
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
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 10,
          maxWidth: 420,
          width: "100%",
          padding: "20px 22px",
          boxShadow: "0 24px 80px rgba(0,0,0,0.18)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={{ marginBottom: mensaje ? 8 : 14 }}>
          <span className="fi-eyebrow">confirmar</span>
          <h2 id="fi-confirm-title" style={{ margin: "4px 0 0", fontSize: 18, lineHeight: 1.3 }}>
            {titulo}
          </h2>
        </header>

        {mensaje ? (
          <p
            id="fi-confirm-msg"
            style={{ margin: "0 0 14px", fontSize: 14, lineHeight: 1.5, color: "var(--ink-2)" }}
          >
            {mensaje}
          </p>
        ) : null}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          {/* Orden en el DOM: cancel primero → foco inicial en la opción segura. */}
          <button type="button" className="fi-btn fi-btn-ghost" onClick={onClose}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={"fi-btn " + (variant === "danger" ? "fi-btn-danger" : "fi-btn-primary")}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
