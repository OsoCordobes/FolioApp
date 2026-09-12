"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { CalendarDay, Check, Users, Wallet, Lock, ChevronRight } from "@/components/icons";

type View = "agenda" | "historia" | "cobros";
const VIEWS: { id: View; label: string; description: string }[] = [
  { id: "agenda", label: "La agenda", description: "Sabé quién viene, quién llegó y a quién estás atendiendo. Cada turno conserva su estado." },
  { id: "historia", label: "La historia clínica", description: "Los antecedentes, las notas y los estudios del paciente, juntos para dar continuidad a la atención." },
  { id: "cobros", label: "Los cobros", description: "Registrá lo cobrado y distinguí los pagos de los saldos pendientes. Cerrá el día con información clara." },
];

/** Illustrative product views. Controls only switch the illustration, never imply a clinical write. */
export function ProductPreview({ compact = false }: { compact?: boolean }) {
  const [view, setView] = useState<View>(compact ? "agenda" : "historia");
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = VIEWS.find((item) => item.id === view)!;
  const prefix = compact ? "hero-product" : "product-tour";
  const ScreenTitle = compact ? "h2" : "h3";

  function onKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let target: number;
    if (event.key === "ArrowRight") target = (index + 1) % VIEWS.length;
    else if (event.key === "ArrowLeft") target = (index + VIEWS.length - 1) % VIEWS.length;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = VIEWS.length - 1;
    else return;
    event.preventDefault();
    setView(VIEWS[target].id);
    buttons.current[target]?.focus();
  }

  return (
    <div className={`fx-preview${compact ? " fx-preview--hero" : ""}`}>
      {!compact && <div className="fx-tour-tabs" role="tablist" aria-label="Recorrer las funciones de Folio" style={{ "--fx-tab-index": VIEWS.findIndex((item) => item.id === view) } as CSSProperties}>
        {VIEWS.map((item, index) => <button key={item.id} id={`${prefix}-${item.id}`} role="tab" type="button"
          aria-selected={view === item.id} aria-controls={`${prefix}-panel`} tabIndex={view === item.id ? 0 : -1}
          ref={(node) => { buttons.current[index] = node; }} onKeyDown={(event) => onKey(event, index)} onClick={() => setView(item.id)}>
          {item.label}
        </button>)}
      </div>}
      <figure className="fx-product-figure">
        <div className="fx-product-window" id={`${prefix}-panel`} role={compact ? undefined : "tabpanel"}
          aria-labelledby={compact ? undefined : `${prefix}-${view}`} tabIndex={compact ? undefined : 0}>
          <div className="fx-window-bar"><span className="fx-window-dots" aria-hidden="true"><i /><i /><i /></span><span>Folio · Consultorio de ejemplo</span><Lock size={12} aria-hidden="true" /></div>
          <div className="fx-product-body">
            <aside className="fx-product-rail" aria-hidden="true">
              <span className="fx-product-wordmark">folio<span>.</span></span>
              <span className={view === "agenda" ? "is-current" : ""}><CalendarDay size={16} /> Hoy</span>
              <span className={view === "historia" ? "is-current" : ""}><Users size={16} /> Pacientes</span>
              <span className={view === "cobros" ? "is-current" : ""}><Wallet size={16} /> Finanzas</span>
              <span className="fx-rail-profile"><b>LM</b> Lucía Molina</span>
            </aside>
            <div className="fx-product-screens">
            {(compact ? VIEWS.slice(0, 1) : VIEWS).map(({ id: screenView }) => <div className="fx-product-screen" key={screenView} data-visible={view === screenView} aria-hidden={view !== screenView}>
              {screenView === "agenda" && <>
                <div className="fx-screen-heading"><div><span>Martes 15 de septiembre</span><ScreenTitle>Tu agenda hoy</ScreenTitle></div><span className="fx-person">LM</span></div>
                <div className="fx-day-summary"><span><b>4</b> turnos</span><span><b>1</b> en espera</span><span><b>1</b> atendido</span></div>
                <div className="fx-agenda-heading"><strong>Esta mañana</strong><span>Consultorio 1</span></div>
                <div className="fx-appointment"><time>09:00</time><span className="fx-patient-initials is-mint">MR</span><div><strong>Martina Ríos</strong><small>Consulta de seguimiento</small></div><span className="fx-status is-complete"><Check size={11} /> Atendida</span></div>
                <div className="fx-appointment is-attending"><time>09:30</time><span className="fx-patient-initials">TA</span><div><strong>Tomás Acosta</strong><small>Primera consulta</small></div><span className="fx-status is-active">En consulta</span></div>
                <div className="fx-appointment"><time>10:00</time><span className="fx-patient-initials is-peach">EV</span><div><strong>Elena Vidal</strong><small>Control clínico</small></div><span className="fx-status is-waiting">En espera</span></div>
                <div className="fx-break"><time>10:30</time><span>Pausa</span></div>
                <div className="fx-appointment"><time>11:00</time><span className="fx-patient-initials is-blue">NP</span><div><strong>Nicolás Peralta</strong><small>Consulta de seguimiento</small></div><span className="fx-status">Confirmado</span></div>
                <div className="fx-screen-footer"><Check size={14} /><span>La consulta de Martina quedó registrada.</span></div>
              </>}
              {screenView === "historia" && <>
                <div className="fx-screen-heading"><div><span>Pacientes / Historia clínica</span><h3>Martina Ríos</h3></div><span className="fx-person is-mint">MR</span></div>
                <div className="fx-record-tags"><span>38 años</span><span>Seguimiento</span><span><Lock size={11} /> Historia cifrada</span></div>
                <div className="fx-record-alert"><strong>Alergias</strong><span>Sin datos registrados</span></div>
                <div className="fx-record-note"><span className="fx-note-date">15 septiembre 2026 · Lucía Molina</span><h4>Consulta de seguimiento</h4><p>Se revisan los estudios aportados y la evolución desde la última consulta.</p><h5>Plan de seguimiento</h5><p>Se registra el plan acordado para el próximo encuentro.</p><span className="fx-record-saved"><Check size={13} /> Nota guardada</span></div>
                <div className="fx-record-previous"><span>18 agosto 2026</span><strong>Control clínico</strong><ChevronRight size={15} aria-hidden="true" /></div>
              </>}
              {screenView === "cobros" && <>
                <div className="fx-screen-heading"><div><span>Martes 15 de septiembre</span><h3>Los números del día</h3></div><span className="fx-person"><Wallet size={20} /></span></div>
                <div className="fx-payment-summary"><div><span>Cobrado</span><strong>$ 45.000</strong><small>2 pagos registrados</small></div><div><span>Pendiente</span><strong>$ 20.000</strong><small>1 saldo por cobrar</small></div></div>
                <div className="fx-agenda-heading"><strong>Movimientos</strong><span>Importes en ARS</span></div>
                {[{name:"Martina Ríos",method:"Transferencia",amount:"$ 25.000",paid:true},{name:"Gabriel Soria",method:"Efectivo",amount:"$ 20.000",paid:true},{name:"Valeria Costa",method:"Saldo de la consulta",amount:"$ 20.000",paid:false}].map((item) => <div className="fx-payment-row" key={item.name}><span><strong>{item.name}</strong><small>{item.method}</small></span><b>{item.amount}</b><span className={`fx-status ${item.paid ? "is-complete" : "is-waiting"}`}>{item.paid ? "Cobrado" : "Pendiente"}</span></div>)}
                <div className="fx-screen-footer"><Wallet size={14} /><span>Los cobros se registran en tu consultorio.</span></div>
              </>}
            </div>)}
            </div>
          </div>
        </div>
        <figcaption>Vista ilustrativa de Folio. Personas y datos ficticios.</figcaption>
      </figure>
      {!compact && <p className="fx-tour-description" aria-live="polite">{selected.description}</p>}
    </div>
  );
}
