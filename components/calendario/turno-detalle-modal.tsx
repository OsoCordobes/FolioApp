"use client";

/**
 * Folio · TurnoDetalleModal · detalle de un turno al hacer click en su bloque.
 *
 * Triggereado por click en una cal-turno del Calendario (semana o mes). Muestra
 * la info ya RESUELTA del turno — fecha/hora, servicio, estado (con su punto de
 * color), origen, profesional, teléfono — más la nota de reserva (motivo del
 * booking, M56) cuando el rol tiene acceso clínico. Sin acciones de estado: solo
 * información + "Ver ficha" + "Cerrar". Las acciones (Reagendar/Cancelar) las
 * dueña otro workstream a través del menú ⋮.
 *
 * Clona la estructura de pedido-modal.tsx (role="dialog" aria-modal, useModalA11y,
 * tokens de folio.css, bloque de nota con borde-acento). Las props son campos de
 * display ya armados server-side; el modal no descifra nada ni toca la DB — así
 * tanto el Calendario (TurnoSemana) como un futuro caller en /hoy lo pueden
 * construir desde sus propios datos.
 */

import Link from "next/link";
import { useRef } from "react";

import { TURNO_STATE_CONF } from "@/lib/turno-states";
import type { EstadoTurno, OrigenTurno } from "@/lib/types";
import { useModalA11y } from "@/lib/use-modal-a11y";

// Etiqueta legible del origen del turno (mismo universo que OrigenTurno).
const ORIGEN_LABEL: Record<OrigenTurno, string> = {
  google: "Google Calendar",
  manual: "Carga manual",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  web: "Reserva web",
  walk_in: "Sin turno (walk-in)",
};

export interface TurnoDetalleModalProps {
  /** Nombre del paciente (ya desencriptado server-side). */
  pacienteNombre: string;
  /** id del paciente — destino del "Ver ficha". */
  pacienteId: string;
  /** "YYYY-MM-DD" en TZ de la org. */
  fecha: string;
  /** "HH:MM" en TZ de la org. */
  hora: string;
  /** Duración en minutos. */
  dur: number;
  servicio: string;
  estado: EstadoTurno;
  origen?: OrigenTurno;
  /** Display name del profesional asignado (null = sin atribución/Solo). */
  profesionalNombre?: string | null;
  /** Teléfono del paciente (ya desencriptado server-side). */
  telefono?: string | null;
  /**
   * Motivo del booking (M56), ya desencriptado server-side y SOLO presente para
   * roles clínicos. null/vacío → se muestra el placeholder "Sin nota de reserva".
   */
  notaReserva?: string | null;
  onClose: () => void;
}

export function TurnoDetalleModal({
  pacienteNombre,
  pacienteId,
  fecha,
  hora,
  dur,
  servicio,
  estado,
  origen,
  profesionalNombre = null,
  telefono = null,
  notaReserva = null,
  onClose,
}: TurnoDetalleModalProps) {
  // A11y de modal compartida: focus trap + Escape + foco inicial + restore.
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalA11y(dialogRef, { onClose });

  const estadoConf = TURNO_STATE_CONF[estado];
  const origenLabel = origen ? ORIGEN_LABEL[origen] : null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cal-turno-modal-title"
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
          <span className="fi-eyebrow">detalle del turno</span>
          <h2 id="cal-turno-modal-title" style={{ margin: "4px 0 0", fontSize: 20 }}>
            {pacienteNombre}
          </h2>
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
          <dt style={{ color: "var(--ink-3)" }}>Fecha</dt>
          <dd style={{ margin: 0 }} className="fm-mono">
            {fecha} · {hora} · {dur} min
          </dd>

          <dt style={{ color: "var(--ink-3)" }}>Servicio</dt>
          <dd style={{ margin: 0 }}>{servicio}</dd>

          <dt style={{ color: "var(--ink-3)" }}>Estado</dt>
          <dd style={{ margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: estadoConf.dot,
              }}
            />
            {estadoConf.label}
          </dd>

          {origenLabel ? (
            <>
              <dt style={{ color: "var(--ink-3)" }}>Origen</dt>
              <dd style={{ margin: 0 }}>{origenLabel}</dd>
            </>
          ) : null}

          {profesionalNombre ? (
            <>
              <dt style={{ color: "var(--ink-3)" }}>Profesional</dt>
              <dd style={{ margin: 0 }}>{profesionalNombre}</dd>
            </>
          ) : null}

          <dt style={{ color: "var(--ink-3)" }}>Teléfono</dt>
          <dd style={{ margin: 0 }} className="fm-mono">
            {telefono || "—"}
          </dd>
        </dl>

        {/* Nota de reserva (M56): el motivo/aclaraciones del booking. Mismo
            estilo de cita con borde-acento que el motivo del PedidoModal. */}
        {notaReserva && notaReserva.trim() ? (
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
            {notaReserva}
          </p>
        ) : (
          <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--ink-3)" }}>
            Sin nota de reserva.
          </p>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="fi-btn fi-btn-ghost" onClick={onClose}>
            Cerrar
          </button>
          <Link href={`/pacientes/${pacienteId}`} className="fi-btn fi-btn-primary">
            Ver ficha
          </Link>
        </div>
      </div>
    </div>
  );
}
