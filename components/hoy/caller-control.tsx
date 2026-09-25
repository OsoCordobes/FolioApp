"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { callWaitingCodeAction, issueCallerCodeAction } from "@/app/(app)/hoy/caller-actions";
import { pendingAfterAttempt, type PendingCall } from "@/lib/caller/pending-call";

type Destination = "RECEPCION" | "CONSULTORIO";

export function CallerControl({ turnoId, identity }: { turnoId: string; identity: { userId: string; organizationId: string } }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [destination, setDestination] = useState<Destination>("CONSULTORIO");
  const [room, setRoom] = useState(1);
  const [pendingCall, setPendingCall] = useState<PendingCall | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const storageKey = `folio.caller.pending.v1:${identity.userId}:${identity.organizationId}:${turnoId}`;
  const clearStoredIntent = () => { try { sessionStorage.removeItem(storageKey); } catch { /* Confirmed DB result remains authoritative. */ } };

  // The issue button disappears when the code arrives; keep focus inside the
  // active panel so Escape affects only this row, not a different dialog.
  useEffect(() => { if (open) closeRef.current?.focus(); }, [open, code]);
  function closePanel() { setOpen(false); toggleRef.current?.focus(); }
  function panelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closePanel(); }
  }

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as PendingCall;
      if (!/^[0-9a-f-]{36}$/i.test(saved.operationId) || !["RECEPCION", "CONSULTORIO"].includes(saved.destination) ||
          (saved.destination === "RECEPCION" ? saved.room !== null : !Number.isInteger(saved.room) || saved.room! < 1 || saved.room! > 99)) return;
      setPendingCall(saved);
      setMessage("Hay un llamado por comprobar. Recuperá el código y comprobalo antes de emitir otro.");
    } catch { /* Unavailable storage leaves the safe in-memory path. */ }
  }, [storageKey]);

  async function issue() {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const result = await issueCallerCodeAction(turnoId);
      if (result.ok) { setCode(result.data.code); setMessage("Código listo para entregar."); }
      else setMessage(result.error.message);
    } catch { setMessage("No pudimos confirmar el código. Actualizá la vista y volvé a comprobarlo."); }
    finally { setBusy(false); }
  }

  async function call() {
    if (busy || !code) return;
    const intent = pendingCall ?? { operationId: crypto.randomUUID(), destination, room: destination === "RECEPCION" ? null : room };
    if (!pendingCall) {
      try { sessionStorage.setItem(storageKey, JSON.stringify(intent)); }
      catch { setMessage("No pudimos conservar este intento en el navegador. No se emitió el llamado."); return; }
    }
    setPendingCall(intent); setBusy(true); setMessage("");
    try {
      const result = await callWaitingCodeAction({ turnoId, ...intent });
      if (result.ok) {
        setMessage(`${result.data.code} · ${result.data.destination}. Llamado confirmado.`);
        setPendingCall(pendingAfterAttempt(intent, true));
        clearStoredIntent();
      } else {
        setMessage(result.error.message);
        setPendingCall(pendingAfterAttempt(intent, false));
      }
    } catch {
      setPendingCall(pendingAfterAttempt(intent, false));
      setMessage("No pudimos confirmar el llamado. Usá «Comprobar llamado» antes de emitir otro.");
    }
    finally { setBusy(false); }
  }

  return <div className="caller-control" onClick={event => event.stopPropagation()}>
    <button ref={toggleRef} type="button" className="caller-control-toggle" aria-label="Código de espera y llamado" aria-expanded={open} onClick={() => setOpen(value => !value)}>Llamar</button>
    {open ? <div className="caller-control-panel" role="group" aria-label="Código de espera y llamado" onKeyDown={panelKeyDown}>
      <div className="caller-control-panel-head"><strong>Llamado</strong><button ref={closeRef} type="button" onClick={closePanel} aria-label="Cerrar panel de llamado">Cerrar</button></div>
      {code ? <div className="caller-control-code"><span>Código de espera</span><strong>{code}</strong></div>
        : <button type="button" className="fi-btn fi-btn-secondary" disabled={busy} onClick={() => void issue()}>{busy ? "Comprobando…" : "Entregar código"}</button>}
      {code ? <div className="caller-control-destination">
        <label>Destino
          <select value={pendingCall?.destination ?? destination} disabled={busy || !!pendingCall} onChange={e => setDestination(e.target.value as Destination)}>
            <option value="CONSULTORIO">Consultorio</option><option value="RECEPCION">Recepción</option>
          </select>
        </label>
        {(pendingCall?.destination ?? destination) === "CONSULTORIO" ? <label>Número
          <input type="number" min="1" max="99" value={pendingCall?.room ?? room} disabled={busy || !!pendingCall} onChange={e => setRoom(Number(e.target.value))} />
        </label> : null}
        <button type="button" className="fi-btn fi-btn-primary" disabled={busy || (!pendingCall && destination === "CONSULTORIO" && (!Number.isInteger(room) || room < 1 || room > 99))} onClick={() => void call()}>
          {busy ? "Comprobando…" : pendingCall ? "Comprobar llamado" : "Llamar código"}
        </button>
      </div> : null}
      {message ? <p role="status">{message}</p> : null}
    </div> : null}
  </div>;
}
