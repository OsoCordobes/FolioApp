"use client";

/**
 * Folio · mini-diálogo de cobro al cerrar un turno (E1 · finanzas).
 *
 * Hasta este PR todo cierre registraba el pago hardcodeado como
 * Efectivo/PAGADO: la columna Método de /finanzas siempre decía "Efectivo" y
 * no existían deudores. Este diálogo compacto intercepta el "Cerrar turno" de
 * /hoy y deja elegir:
 *   - monto (precargado con el precio del turno, editable),
 *   - método (Efectivo / Transferencia / Mercado Pago / Tarjeta / Obra social),
 *   - "quedó debiendo" → el pago se crea PENDIENTE (deuda visible en /finanzas).
 *
 * El camino rápido de siempre se preserva: el foco inicial cae en el botón de
 * confirmar, así "Cerrar turno" → Enter cierra cobrando efectivo PAGADO por el
 * precio del turno (comportamiento histórico, ahora explícito).
 *
 * Patrón de estructura + a11y clonado de components/ui/confirm-dialog.tsx
 * (useModalA11y: focus trap + Escape + restore focus; stopPropagation para no
 * disparar el onClick de la fila que abre la ficha).
 */

import { useRef, useState, type FormEvent } from "react";

import { useModalA11y } from "@/lib/use-modal-a11y";

import type { CobroCierreActionInput } from "@/app/(app)/hoy/actions";

const METODOS: Array<[CobroCierreActionInput["metodo"], string]> = [
  ["EFECTIVO", "Efectivo"],
  ["TRANSFERENCIA", "Transferencia"],
  ["MERCADOPAGO", "Mercado Pago"],
  ["TARJETA", "Tarjeta"],
  ["OBRA_SOCIAL", "Obra social"],
];

export interface CobroCierreDialogProps {
  pacienteNombre: string;
  /** Precio del turno en PESOS enteros (Turno.precio) — precarga del monto. */
  precioPesos: number;
  onConfirm: (cobro: CobroCierreActionInput) => void;
  onClose: () => void;
}

export function CobroCierreDialog({ pacienteNombre, precioPesos, onConfirm, onClose }: CobroCierreDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalA11y(dialogRef, { onClose });

  const [montoStr, setMontoStr] = useState(precioPesos > 0 ? String(precioPesos) : "");
  const [metodo, setMetodo] = useState<CobroCierreActionInput["metodo"]>("EFECTIVO");
  const [debiendo, setDebiendo] = useState(false);

  const montoPesos = Number(montoStr.replace(/[^\d]/g, "")) || 0;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onConfirm({ montoCents: montoPesos * 100, metodo, pagado: !debiendo });
    onClose();
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="fi-cobro-title"
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
          maxWidth: 440,
          width: "100%",
          padding: "20px 22px",
          boxShadow: "0 24px 80px rgba(0,0,0,0.18)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={{ marginBottom: 12 }}>
          <span className="fi-eyebrow">cobro</span>
          <h2 id="fi-cobro-title" style={{ margin: "4px 0 0", fontSize: 18, lineHeight: 1.3 }}>
            Cerrar turno de {pacienteNombre}
          </h2>
        </header>

        <form onSubmit={handleSubmit}>
          <label className="fi-cobro-field">
            <span className="fi-cobro-lbl">Monto</span>
            <span className="fi-cobro-monto">
              <span aria-hidden>$</span>
              <input
                inputMode="numeric"
                pattern="[0-9]*"
                value={montoStr}
                onChange={(e) => setMontoStr(e.target.value.replace(/[^\d]/g, ""))}
                aria-label="Monto en pesos"
                placeholder="0"
              />
            </span>
          </label>

          <div className="fi-cobro-field" role="group" aria-label="Método de pago">
            <span className="fi-cobro-lbl">Método</span>
            <div className="fi-cobro-metodos">
              {METODOS.map(([id, lbl]) => (
                <button
                  key={id}
                  type="button"
                  className={"fi-cobro-metodo" + (metodo === id ? " is-active" : "")}
                  aria-pressed={metodo === id}
                  onClick={() => setMetodo(id)}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          <label className="fi-cobro-deuda">
            <input
              type="checkbox"
              checked={debiendo}
              onChange={(e) => setDebiendo(e.target.checked)}
            />
            <span>
              Quedó debiendo
              <small>El pago se registra como pendiente y aparece en «Por cobrar».</small>
            </span>
          </label>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <button type="button" className="fi-btn fi-btn-ghost" onClick={onClose}>
              Volver
            </button>
            {/* autoFocus: Enter directo = confirmar con los defaults (efectivo
                pagado por el precio del turno) — el camino de 1 tap de siempre. */}
            <button type="submit" className="fi-btn fi-btn-primary" autoFocus>
              {debiendo ? "Cerrar con deuda" : montoPesos > 0 ? "Cobrar y cerrar" : "Cerrar sin cargo"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
