"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { transitionTurnoAction, resolveTurnoCloseAction, getTurnoCloseStatusAction, getTurnoCloseReceiptAction, marcarPagoCobradoAgendaAction } from "@/app/(app)/hoy/actions";
import { closeReceiptSchema, closeStatusSchema, settlementReceiptSchema, validCloseReceipt, validCloseStatus, type CloseReceiptRequest, type CloseStatus, type CloseDecision } from "@/lib/turnos/close-contract";
import { closeDuration } from "@/lib/hoy/close-operation";
import { formatArs, MONTO_MAX_PESOS } from "@/lib/format/currency";
import { useModalA11y } from "@/lib/use-modal-a11y";
import type { Turno } from "@/lib/types";

type Phase = "editing" | "pending" | "uncertain" | "rejected" | "review" | "confirmed";
type Attempt = CloseReceiptRequest | { action: "SETTLE"; turnoId: string; pagoId: string };
const METHODS = [["EFECTIVO", "Efectivo"], ["TRANSFERENCIA", "Transferencia"], ["MERCADOPAGO", "Mercado Pago"], ["TARJETA", "Tarjeta"], ["OBRA_SOCIAL", "Obra social"]] as const;
export interface CobroCierreDialogProps {
  turno: Turno; mode: "CLOSE" | "RESOLVE"; pacienteNombre: string; canRegistrarCobro: boolean;
  financialObservation: number;
  getObservation: () => number; onConfirmed: (status: CloseStatus, readObservation?: number) => void; onClose: () => void;
}

/** Dashboard owns this dialog; an immutable attempt outlives every row/SSR grouping. */
export function CobroCierreDialog(props: CobroCierreDialogProps) {
  const { turno, pacienteNombre, canRegistrarCobro } = props;
  const live = useRef(props); live.current = props;
  const [monto, setMonto] = useState(String(turno.precio ?? 0));
  const [metodo, setMetodo] = useState<(typeof METHODS)[number][0]>("EFECTIVO");
  const [debiendo, setDebiendo] = useState(false);
  const [duration, setDuration] = useState(() => String(closeDuration(turno)));
  const [phase, setPhase] = useState<Phase>("editing");
  const [acceptedStatus, setStatus] = useState<CloseStatus | null>(null);
  const statusObservation = useRef(props.financialObservation);
  // Later contradictory observations of this appointment invalidate authority,
  // while the immutable attempt and entered fields remain available for recovery.
  const status = statusObservation.current === props.financialObservation ? acceptedStatus : null;
  const statusOutdated = acceptedStatus !== null && status === null;
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const attempt = useRef<Attempt | null>(null);
  const busy = useRef(false), sequence = useRef(0);
  const openingRead = useRef<{ key: string; promise: Promise<CloseStatus | null> } | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const locked = phase === "pending" || phase === "uncertain";
  useModalA11y(dialogRef, { onClose: () => { if (!busy.current && !attempt.current) live.current.onClose(); }, closeDisabled: locked || loading });

  async function readStatus(): Promise<CloseStatus | null> {
    const seq = ++sequence.current, observation = live.current.getObservation();
    try {
      const result = await getTurnoCloseStatusAction(turno.id);
      if (seq !== sequence.current) return null;
      const parsed = result.ok ? closeStatusSchema.safeParse(result.data) : null;
      if (!parsed?.success || parsed.data.turnoId !== turno.id || !validCloseStatus(parsed.data)) { setStatus(null); return null; }
      const currentObservation = observation === live.current.getObservation();
      live.current.onConfirmed(parsed.data, observation);
      // A newer SSR observation overtook this read. Keep its evidence for the
      // row merge, but do not present it as current authority in this dialog.
      if (!currentObservation) { setStatus(null); return null; }
      statusObservation.current = live.current.financialObservation;
      setStatus(parsed.data);
      return parsed.data;
    } catch { if (seq === sequence.current) setStatus(null); return null; }
  }
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    // A role change invalidates the permission used to edit. Historical receipts never restore it.
    setStatus(null);
    const key = `${turno.id}:${canRegistrarCobro}`;
    if (openingRead.current?.key !== key) openingRead.current = { key, promise: readStatus() };
    void openingRead.current.promise.then(value => { if (!disposed) {
      setLoading(false);
      if (!value) setMessage("No pudimos leer el estado actual. Actualizalo antes de continuar.");
    } });
    return () => { disposed = true; };
    // Only appointment/role identity owns this read, never changing render callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turno.id, canRegistrarCobro]);

  async function confirm(receipt: CloseStatus) {
    live.current.onConfirmed(receipt);
    attempt.current = null;
    setPhase("confirmed");
    setMessage("El cambio quedó confirmado.");
    const current = await readStatus();
    if (!current) setMessage("El cambio quedó confirmado. No pudimos actualizar el cobro; revisalo antes de otra operación.");
  }
  async function execute(snapshot: Attempt, probe = false) {
    if (busy.current) return;
    // A new rejection only describes this retry, never the lost earlier response.
    const recovering = probe || phase === "uncertain";
    if (!probe && (snapshot.action === "SETTLE" || snapshot.cobro) && !live.current.canRegistrarCobro) return;
    busy.current = true; setPhase("pending"); setMessage(probe ? "Comprobando la operación…" : "Guardando el cambio…");
    try {
      if (snapshot.action === "SETTLE" && probe) {
        const current = await readStatus();
        if (current?.pago?.id === snapshot.pagoId && current.pago.estado === "PAGADO") await confirm(current);
        else { setPhase("uncertain"); setMessage("Todavía no pudimos confirmar el cobro. Conservamos la misma solicitud."); }
        return;
      }
      if (snapshot.action === "SETTLE") {
        const result = await marcarPagoCobradoAgendaAction({ turnoId: snapshot.turnoId, pagoId: snapshot.pagoId });
        if (result.ok) {
          // The adapter validates payment identity and timestamps; refresh current status before offering more actions.
          const current = acceptedStatus;
          if (!current || !settlementReceiptSchema.safeParse(result.data).success || result.data.turnoId !== turno.id || result.data.pago.id !== snapshot.pagoId) throw Error("Unconfirmed receipt");
          await confirm({ ...current, pago: result.data.pago, clasificacion: "REGISTRADO" });
        } else fail(result.error, recovering);
        return;
      }
      const { action, ...request } = snapshot;
      const result = probe ? await getTurnoCloseReceiptAction(snapshot) : action === "CLOSE"
        ? await transitionTurnoAction({ ...request, to: "cerrado" }) : await resolveTurnoCloseAction({ turnoId: request.turnoId, operacionId: request.operacionId, cobro: request.cobro! });
      if (!result.ok) { fail(result.error, recovering); return; }
      const data = probe ? result.data : action === "CLOSE" ? (result.data as { cierre?: unknown }).cierre : result.data;
      if (data === null && probe) { setPhase("uncertain"); setMessage("Aún no hay un recibo. Eso no confirma que la operación haya fallado; conservamos tu solicitud."); return; }
      const parsed = closeReceiptSchema.safeParse(data);
      if (!parsed.success || !validCloseReceipt(parsed.data, snapshot)) throw Error("Unconfirmed receipt");
      await confirm(parsed.data);
    } catch { setPhase("uncertain"); setMessage("Se interrumpió la respuesta. Conservamos tu decisión; comprobá el resultado o reintentá la misma solicitud."); }
    finally { busy.current = false; }
  }
  function fail(error: { message: string; mutationOutcome?: string }, probe: boolean) {
    if (probe || !["rejected", "review_required"].includes(error.mutationOutcome ?? "")) setPhase("uncertain");
    else { attempt.current = null; setPhase(error.mutationOutcome === "review_required" ? "review" : "rejected"); }
    setMessage(error.message);
  }
  const closed = status?.estado === "CERRADO";
  const financial = canRegistrarCobro && status?.puedeRegistrar === true;
  const registration = financial && !status?.pago && status?.clasificacion !== "SIN_CARGO" && status?.clasificacion !== "REGISTRADO";
  const amount = Number(monto), minutes = Number(duration);
  const validAmount = /^\d+$/.test(monto) && Number.isSafeInteger(amount * 100) && amount >= 0 && amount <= MONTO_MAX_PESOS;
  const validDuration = /^\d+$/.test(duration) && Number.isInteger(minutes) && minutes >= 0 && minutes <= 480;
  const editable = !locked && !loading && phase !== "confirmed" && phase !== "review";
  function edit(change: () => void) { if (!busy.current && !attempt.current && editable) change(); }
  const canSubmit = editable && status && (closed ? registration : props.mode === "CLOSE" && status.estado === "ATENDIENDO") && (closed || validDuration) && (!registration || validAmount);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || busy.current || attempt.current) return;
    const cobro: CloseDecision | undefined = registration ? amount === 0 ? { montoCents: 0 } : { montoCents: amount * 100, metodo, pagado: !debiendo } : undefined;
    const base = { turnoId: turno.id, operacionId: crypto.randomUUID(), ...(cobro ? { cobro: Object.freeze(cobro) } : {}) };
    const snapshot: Attempt = closed ? { ...base, action: "RESOLVE", cobro: cobro! } : { ...base, action: "CLOSE", duracionRealMin: minutes };
    attempt.current = Object.freeze(snapshot); void execute(snapshot);
  }
  async function refresh() {
    if (busy.current || attempt.current) return;
    busy.current = true; setLoading(true);
    const value = await readStatus();
    if (value) { setPhase("editing"); setMessage(null); } else setMessage("No pudimos leer el estado actual. Conservá esta revisión y volvé a comprobar.");
    setLoading(false); busy.current = false;
  }
  function settle() {
    if (!financial || !closed || !status?.pago || status.pago.estado === "PAGADO" || busy.current || attempt.current) return;
    const snapshot: Attempt = Object.freeze({ action: "SETTLE", turnoId: turno.id, pagoId: status.pago.id });
    attempt.current = snapshot; void execute(snapshot);
  }
  // An exact retry keeps the already submitted decision; it is not a new
  // financial choice. Current role changes still revoke monetary retries.
  const retryAllowed = attempt.current && (attempt.current.action !== "SETTLE" && !attempt.current.cobro
    || canRegistrarCobro && acceptedStatus?.puedeRegistrar === true);
  return <div ref={dialogRef} role="dialog" aria-modal="true" aria-busy={phase === "pending" || loading} aria-labelledby="fi-cobro-title" tabIndex={-1} className="a11y-modal-root"
    style={{ position: "fixed", inset: 0, background: "rgba(20,14,8,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}
    onClick={event => { event.stopPropagation(); if (!locked && !loading && !busy.current && !attempt.current) props.onClose(); }}>
    <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, maxWidth: 440, width: "100%", padding: "20px 22px", boxShadow: "0 24px 80px rgba(0,0,0,0.18)", maxHeight: "calc(100dvh - 32px)", overflowY: "auto" }} onClick={event => event.stopPropagation()}>
      <header><span className="fi-eyebrow">{props.mode === "CLOSE" ? "cierre de atención" : "registro del cobro"}</span>
        <h2 id="fi-cobro-title" style={{ margin: "4px 0 12px", fontSize: 18 }}>{props.mode === "CLOSE" ? "Cerrar turno de" : "Revisar cobro de"} {pacienteNombre}</h2></header>
      {loading ? <p role="status">Consultando el estado actual…</p> : null}
      {statusOutdated ? <p role="alert">Hay información nueva del cobro. {locked ? "Conservamos tu solicitud para comprobar el resultado." : "Actualizá el estado antes de continuar."}</p> : null}
      {message ? <p role={phase === "confirmed" || phase === "pending" ? "status" : "alert"}>{message}</p> : null}
      {status?.origen === "HISTORICO" ? <p>Atención histórica: la fecha de cierre no está registrada.</p> : null}
      {closed && status?.clasificacion === "REQUIERE_REGISTRO" ? <p>Registro por revisar. Todavía no hay un cobro ni una decisión sin cargo.</p> : null}
      {closed && status?.clasificacion === "SIN_CARGO" ? <p>Sin cargo confirmado.</p> : null}
      {closed && status?.clasificacion === "REGISTRADO" && (!financial || !status.pago) ? <p>Registro existente. Sus datos requieren permiso de cobros.</p> : null}
      {financial && status?.pago ? <p>Pago registrado: {formatArs(status.pago.montoCents / 100)} · {status.pago.estado === "PAGADO" ? "Cobrado" : "Pendiente"} · {status.pago.metodo}</p> : null}
      <form onSubmit={submit}>
        {(!closed || attempt.current?.action === "CLOSE") && props.mode === "CLOSE" ? <label className="fi-cobro-field"><span className="fi-cobro-lbl">Duración real (min)</span>
          <span className="fi-cobro-monto"><input aria-label="Duración real (min)" inputMode="numeric" value={duration} disabled={!editable} onChange={e => edit(() => setDuration(e.target.value))} aria-invalid={!validDuration}/></span>
          {!validDuration ? <span role="alert">Revisá la duración: ingresá entre 0 y 480 minutos antes de cerrar.</span> : null}</label> : null}
        {canRegistrarCobro && (registration || !!(attempt.current && attempt.current.action !== "SETTLE" && attempt.current.cobro)) ? <>
          <label className="fi-cobro-field"><span className="fi-cobro-lbl">Monto</span><span className="fi-cobro-monto"><span aria-hidden>$</span><input aria-label="Monto en pesos" inputMode="numeric" value={monto} disabled={!editable} onChange={e => edit(() => setMonto(e.target.value.replace(/[^\d]/g,"")))}/></span></label>
          {!validAmount ? <p role="alert">Ingresá un monto entre $0 y {formatArs(MONTO_MAX_PESOS)}.</p> : null}
          <div className="fi-cobro-field" role="group" aria-label="Método de pago"><span className="fi-cobro-lbl">Método</span><div className="fi-cobro-metodos">{METHODS.map(([id,label]) => <button key={id} type="button" className={"fi-cobro-metodo"+(metodo===id?" is-active":"")} aria-pressed={metodo===id} disabled={!editable} onClick={()=>edit(()=>setMetodo(id))}>{label}</button>)}</div></div>
          <label className="fi-cobro-deuda"><input type="checkbox" checked={debiendo} disabled={!editable} onChange={e=>edit(()=>setDebiendo(e.target.checked))}/><span>Quedó debiendo<small>El pago se registra como pendiente.</small></span></label>
        </> : null}
        {props.mode === "CLOSE" && status && !financial && !closed ? <p>Se cerrará la atención sin registrar un cobro.</p> : null}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" className="fi-btn fi-btn-ghost" disabled={locked || loading} onClick={()=>{if(!busy.current&&!attempt.current)props.onClose();}}>{phase==="confirmed"?"Listo":"Volver"}</button>
          {phase === "uncertain" ? <><button type="button" className="fi-btn fi-btn-secondary" onClick={()=>{if(attempt.current)void execute(attempt.current,true);}}>Comprobar resultado</button><button type="button" className="fi-btn fi-btn-primary" disabled={!retryAllowed} onClick={()=>{if(attempt.current)void execute(attempt.current);}}>Reintentar misma solicitud</button></> : null}
          {!locked && (!status || phase === "review" || phase === "confirmed") ? <button type="button" className="fi-btn fi-btn-secondary" disabled={loading} onClick={()=>void refresh()}>Actualizar estado</button> : null}
          {editable && financial && closed && status?.pago && status.pago.estado !== "PAGADO" ? <button type="button" className="fi-btn fi-btn-primary" onClick={settle}>Marcar cobrado</button> : null}
          {phase !== "confirmed" && phase !== "review" && status && (!closed || registration) ? <button type="submit" className="fi-btn fi-btn-primary" disabled={!canSubmit}>{closed ? "Registrar decisión" : !financial || !registration ? "Cerrar sin registrar cobro" : debiendo ? "Cerrar con deuda" : amount>0 ? "Cobrar y cerrar" : "Cerrar sin cargo"}</button> : null}
        </div>
      </form>
    </div>
  </div>;
}
