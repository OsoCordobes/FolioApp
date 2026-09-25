"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { FolioMark } from "@/components/folio-mark";
import type { z } from "zod";
import { callerSnapshot } from "@/lib/caller/screen-http";
import { callerRetryDelay, shouldPlayCallTone } from "@/lib/caller/screen-poll";

type Snapshot = z.infer<typeof callerSnapshot>;
type ScreenStatus = "loading" | "pair" | "active" | "offline";

function playCallTone(ctx: AudioContext) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = 660;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.14, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(); oscillator.stop(ctx.currentTime + 0.32);
}

export function CallerScreen() {
  const [status, setStatus] = useState<ScreenStatus>("loading");
  const [calls, setCalls] = useState<Snapshot["snapshot"]>([]);
  const [pairCode, setPairCode] = useState("");
  const [pairBusy, setPairBusy] = useState(false);
  const [pairError, setPairError] = useState("");
  const [soundOn, setSoundOn] = useState(false);
  const cursorRef = useRef<number | null>(null);
  const baselineRef = useRef(false);
  const soundRef = useRef(false);
  const audioRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const failuresRef = useRef(0);

  useEffect(() => { soundRef.current = soundOn; }, [soundOn]);
  useEffect(() => {
    let disposed = false;
    const clear = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      requestRef.current?.abort(); requestRef.current = null;
    };
    const schedule = (ms: number) => {
      if (!disposed && !document.hidden) timerRef.current = setTimeout(() => { void poll(); }, ms);
    };
    async function poll() {
      if (disposed || document.hidden || requestRef.current) return;
      const request = new AbortController(); requestRef.current = request;
      try {
        const cursor = cursorRef.current;
        const path = `/api/caller/screen${cursor === null ? "" : `?cursor=${cursor}`}`;
        const response = await fetch(path, { cache: "no-store", credentials: "same-origin",
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]) });
        if (request.signal.aborted || disposed || document.hidden) return;
        if (response.status === 401 || response.status === 403) {
          cursorRef.current = null; baselineRef.current = false; setCalls([]); setStatus("pair"); return;
        }
        if (!response.ok) {
          failuresRef.current++;
          baselineRef.current = false; setCalls([]); setStatus("offline");
          schedule(callerRetryDelay(response.headers.get("Retry-After"), failuresRef.current));
          return;
        }
        const parsed = callerSnapshot.safeParse(await response.json());
        if (!parsed.success) throw new Error("invalid_snapshot");
        if (request.signal.aborted || disposed || document.hidden) return;
        const next = parsed.data;
        if (shouldPlayCallTone(next, cursorRef.current, baselineRef.current, soundRef.current) && audioRef.current) {
          try { playCallTone(audioRef.current); } catch { /* Visual call remains authoritative. */ }
        }
        cursorRef.current = next.cursor; baselineRef.current = true; failuresRef.current = 0;
        setCalls(next.snapshot); setStatus("active"); schedule(5000);
      } catch {
        if (!request.signal.aborted) {
          failuresRef.current++; baselineRef.current = false; setCalls([]); setStatus("offline");
          schedule(callerRetryDelay(null, failuresRef.current));
        }
      } finally { if (requestRef.current === request) requestRef.current = null; }
    }
    const visibility = () => {
      clear(); baselineRef.current = false; setCalls([]);
      if (!document.hidden) { setStatus("loading"); void poll(); }
    };
    document.addEventListener("visibilitychange", visibility);
    void poll();
    return () => { disposed = true; clear(); document.removeEventListener("visibilitychange", visibility); void audioRef.current?.close(); audioRef.current = null; };
  }, []);

  async function pair(event: FormEvent) {
    event.preventDefault();
    if (pairBusy) return;
    setPairBusy(true); setPairError("");
    try {
      const response = await fetch("/api/caller/screen/pair", { method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "same-origin", cache: "no-store", body: JSON.stringify({ code: pairCode.trim().toLowerCase() }) });
      if (!response.ok) { setPairError("El código venció o ya se usó. Pedí uno nuevo."); return; }
      window.location.reload();
    } catch { setPairError("No hay conexión. Revisala y probá de nuevo."); }
    finally { setPairBusy(false); }
  }

  async function toggleSound() {
    if (soundOn) { setSoundOn(false); return; }
    try {
      const ctx = audioRef.current ?? new window.AudioContext();
      await ctx.resume();
      audioRef.current = ctx;
      setSoundOn(true);
    } catch { setSoundOn(false); }
  }

  return <main className="caller-screen">
    <header className="caller-screen-head">
      <div className="caller-brand"><FolioMark size={36} /><span>folio<span aria-hidden="true">.</span></span></div>
      <div className="caller-screen-head-meta"><span>Turnos en espera</span><strong>Atención</strong></div>
    </header>
    {status === "pair" ? <section className="caller-pair" aria-labelledby="caller-pair-title">
      <span className="caller-eyebrow">Pantalla de recepción</span>
      <h1 id="caller-pair-title">Vinculá esta pantalla</h1>
      <p>Pedí un código temporal en Configuración → Pantallas. Se usa una sola vez.</p>
      <form onSubmit={pair}>
        <label htmlFor="caller-code">Código de vinculación</label>
        <input id="caller-code" autoComplete="off" autoCapitalize="none" spellCheck={false} inputMode="text" maxLength={16}
          value={pairCode} onChange={e => setPairCode(e.target.value)} placeholder="16 caracteres" required />
        <button type="submit" className="fi-btn fi-btn-primary" disabled={pairBusy || !/^[a-fA-F0-9]{16}$/.test(pairCode.trim())}>{pairBusy ? "Vinculando…" : "Vincular pantalla"}</button>
      </form>
      {pairError ? <p role="alert" className="caller-error">{pairError}</p> : null}
    </section> : <>
      <div className="caller-screen-tools">
        <span aria-live="polite">{status === "offline" ? "Sin conexión · Reintentando" : status === "loading" ? "Conectando…" : "Pantalla activa"}</span>
        <button type="button" className="caller-sound" aria-pressed={soundOn} onClick={() => void toggleSound()}>{soundOn ? "Sonido activado" : "Activar sonido"}</button>
      </div>
      {calls.length ? <ol className="caller-call-list" aria-label="Llamados recientes">{calls.map((call, index) => <li key={call.cursor} className={index === 0 ? "is-latest" : ""}>
        <span className="caller-call-code">{call.code}</span><span className="caller-call-destination">{call.destination}</span>
      </li>)}</ol> : <div className="caller-empty"><h1>{status === "offline" ? "Conexión interrumpida" : "Esperando llamados"}</h1><p>{status === "offline" ? "Los llamados volverán cuando se restablezca la conexión." : "El próximo código aparecerá acá."}</p></div>}
    </>}
  </main>;
}
