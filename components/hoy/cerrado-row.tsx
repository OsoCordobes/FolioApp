"use client";

/**
 * Folio · Dashboard · fila compacta de un turno cerrado.
 *
 * Port de `CerradoRow` en folio/dashboard.jsx (líneas 224-253).
 */

import * as I from "@/components/icons";
import { nombreCortoProfesional } from "@/lib/agenda/profesional";
import { fmtMoney } from "@/lib/dashboard-helpers";
import { montoRegistradoCents } from "@/lib/hoy/kpi-cobro";
import type { Paciente, Turno } from "@/lib/types";

interface CerradoRowProps {
  turno: Turno;
  paciente: Paciente;
  onOpenFicha: (id: string) => void;
}

export function CerradoRow({ turno, paciente, onOpenFicha }: CerradoRowProps) {
  const hasImportante = (paciente.notasImportantes ?? "").trim().length > 0;
  // Importe REGISTRADO en `pago`, no el precio de lista: el profesional pudo
  // editarlo o marcar "quedó debiendo" al cerrar (PR #118). Mostrar el precio
  // acá, en verde y sin marca, hacía pasar una deuda por cobro hecho.
  const montoCents = montoRegistradoCents(turno);
  const debe = montoCents != null && turno.cobro?.estado !== "pagado";
  return (
    <div className="fi-cerrado-row" onClick={() => onOpenFicha(turno.id)}>
      <div className="fi-t-time">
        <b>{turno.hora}</b>
      </div>
      <span className="fi-t-dot-wrap">
        <span className="fi-t-dot" style={{ background: "var(--green)" }} aria-hidden />
        {/* A11y: el estado se comunicaba solo con el dot verde (WCAG 1.4.1).
            .sr-only es position:absolute — cero impacto visual. */}
        <span className="sr-only">Turno cerrado</span>
      </span>
      <div className="fi-t-who">
        <div className="fi-t-name-row">
          <b className="fi-t-name">{paciente.nombre}</b>
          {hasImportante ? (
            <span className="fi-t-flag fi-t-flag--warn" title={paciente.notasImportantes}>
              <I.Alert size={11} />
            </span>
          ) : null}
        </div>
        <div className="fi-t-meta">
          <span>{turno.servicio}</span>
          {/* Atribución multi-profesional: solo en vista "Todos" multi-colegiado. */}
          {turno.profesionalNombre ? (
            <span className="fi-t-prof" title={turno.profesionalNombre}>
              {nombreCortoProfesional(turno.profesionalNombre)}
            </span>
          ) : null}
          {turno.postVisita?.guardada ? (
            <span className="fi-t-pv fi-t-pv--ok">
              <I.Check size={10} /> post-visita
            </span>
          ) : (
            <span className="fi-t-pv fi-t-pv--mute">sin post-visita</span>
          )}
        </div>
      </div>
      <div className="fi-cerrado-amount">
        {montoCents == null ? (
          // Cerrado sin cargo: el server no crea `pago` con monto 0. No es $0
          // cobrado ni deuda — es que no se cobró nada.
          <span className="fi-cerrado-sincargo">sin cargo</span>
        ) : (
          <>
            <span className="fi-mono">{fmtMoney(Math.round(montoCents / 100))}</span>
            {debe ? <span className="fi-cerrado-debe">debe</span> : null}
          </>
        )}
      </div>
      <div className="fi-cerrado-cta">
        <span className="fi-btn fi-btn-ghost">
          Ver ficha <I.ArrowRight size={11} />
        </span>
      </div>
    </div>
  );
}
