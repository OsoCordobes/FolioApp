"use client";

import React, { useEffect, useState } from "react";

import { createCallerPairAction, listCallerScreensAction, revokeCallerScreenAction } from "@/app/(app)/configuracion/pantallas/actions";
import type { listCallerScreens } from "@/lib/db/caller";

type InventoryResult = Awaited<ReturnType<typeof listCallerScreens>>;
type Screen = Extract<InventoryResult, { ok: true }>["data"]["screens"][number];

const statusLabel: Record<Screen["status"], string> = {
  pendiente: "Pendiente de vincular", activa: "Activa", vencida: "Vencida", revocada: "Desconectada",
};

export function CallerScreensPanel({ initial }: { initial: InventoryResult }) {
  const [screens, setScreens] = useState<Screen[]>(initial.ok ? initial.data.screens : []);
  const [nextCursor, setNextCursor] = useState<{ createdAt: string; screenId: string } | null>(initial.ok ? initial.data.nextCursor : null);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [pairExpires, setPairExpires] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState(initial.ok ? "" : initial.error.message);

  useEffect(() => { setReady(true); }, []);

  async function reload() {
    const result = await listCallerScreensAction(null);
    if (result.ok) { setScreens(result.data.screens); setNextCursor(result.data.nextCursor); }
    else setMessage(result.error.message);
  }
  async function createPair() {
    if (busy) return;
    setBusy(true); setMessage(""); setPairCode(null); setPairExpires(null);
    try {
      const result = await createCallerPairAction(crypto.randomUUID());
      if (result.ok && result.data.pairCode) {
        setPairCode(result.data.pairCode); setPairExpires(result.data.expiresAt ?? null);
        setMessage("Ingresá este código en la pantalla. Vence en cinco minutos y se usa una sola vez.");
      } else setMessage(result.ok ? "El código ya se emitió. Generá uno nuevo." : result.error.message);
      await reload();
    } catch { setMessage("No pudimos confirmar la vinculación. Generá un código nuevo; el anterior quedará invalidado."); }
    finally { setBusy(false); }
  }
  async function revoke(screen: Screen) {
    if (busy || !window.confirm("¿Desconectar esta pantalla? Dejará de recibir nuevos llamados.")) return;
    setBusy(true); setMessage("");
    try {
      const result = await revokeCallerScreenAction(screen.screenId);
      if (!result.ok) setMessage(result.error.message);
      else setMessage("Pantalla desconectada.");
      await reload();
    } catch { setMessage("No pudimos confirmar la desconexión. Actualizá la lista para comprobarla."); }
    finally { setBusy(false); }
  }
  async function loadMore() {
    if (busy || nextCursor === null) return;
    setBusy(true);
    try {
      const result = await listCallerScreensAction(nextCursor);
      if (result.ok) { setScreens(current => [...current, ...result.data.screens]); setNextCursor(result.data.nextCursor); }
      else setMessage(result.error.message);
    } catch { setMessage("No pudimos cargar más pantallas."); }
    finally { setBusy(false); }
  }

  return <div className="caller-settings-grid">
    <section className="caller-settings-card" aria-labelledby="caller-link-title">
      <h2 id="caller-link-title">Vincular una pantalla</h2>
      <p>En el televisor o monitor, abrí{" "}<a href="/pantalla" target="_blank" rel="noopener noreferrer">folio · Pantalla de espera ↗</a>. Después generá el código temporal acá.</p>
      <button type="button" className="fi-btn fi-btn-primary" disabled={!ready || busy} onClick={() => void createPair()}>{busy ? "Preparando…" : "Generar código de vinculación"}</button>
      {pairCode ? <div className="caller-settings-code" role="status"><span>Código temporal</span><strong>{pairCode}</strong>
        {pairExpires ? <small>Vence a las {new Date(pairExpires).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</small> : null}
      </div> : null}
    </section>
    <section className="caller-settings-card" aria-labelledby="caller-screens-title">
      <h2 id="caller-screens-title">Pantallas vinculadas</h2>
      {screens.length ? <ul className="caller-settings-list">{screens.map(screen => <li key={screen.screenId}>
        <div><strong>Pantalla del {new Date(screen.createdAt).toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" })}</strong>
          <span>{statusLabel[screen.status]}</span></div>
        {screen.status !== "revocada" ? <button type="button" className="fi-btn fi-btn-secondary" disabled={!ready || busy} onClick={() => void revoke(screen)}>Desconectar</button> : null}
      </li>)}</ul> : <p>Por ahora no hay pantallas para este consultorio.</p>}
      {nextCursor !== null ? <button type="button" className="fi-btn fi-btn-secondary" disabled={!ready || busy} onClick={() => void loadMore()}>Ver más</button> : null}
    </section>
    {message ? <p role="status" className="caller-settings-message">{message}</p> : null}
  </div>;
}
