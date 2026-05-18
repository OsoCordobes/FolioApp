"use client";

/**
 * Folio · Auth · Slide 1 (Agenda calma)
 *
 * Port fiel de SlideAgenda en folio/auth.jsx (líneas 94-188).
 *
 * Narrativa de 3 beats:
 *   beat 0  T0–700ms     card + 4 rows entran (stagger 60ms)
 *   beat 1  T900–1800ms  ✓ FICHA cascada en las 4 rows
 *                        T1800–2600ms HOLD lectura
 *   beat 2  T2600–3200ms footer chip "Folio armó tu día a las 06:14"
 *                        T3200–4000ms HOLD
 *   beat 3  T4000ms+     countdown empieza a tickear (sensación de live)
 *
 * Las className `au2-ag2-*` viven en folio.css y se conservan intactas.
 */

import { useEffect, useState } from "react";

interface SlideAgendaProps {
  active: boolean;
}

const TURNOS = [
  { time: "10:00", initials: "CV", name: "Carlos Vega",     motivo: "consulta · 1ª" },
  { time: "11:00", initials: "MG", name: "María González",  motivo: "control · 12ª" },
  { time: "12:00", initials: "AR", name: "Ana Romero",      motivo: "seguimiento · 4ª" },
  { time: "16:30", initials: "VC", name: "Valentina Cruz",  motivo: "consulta · 1ª" },
];

export function SlideAgenda({ active }: SlideAgendaProps) {
  // step encadena los checks (1→2→3→4) + reveal del status pill + footer + tick
  const [step, setStep] = useState(0);
  const [seconds, setSeconds] = useState(30 * 60); // 30:00 hasta primer turno

  useEffect(() => {
    if (!active) {
      setStep(0);
      setSeconds(30 * 60);
      return;
    }
    const timers = [
      setTimeout(() => setStep(1),  900),  // row 1 ✓
      setTimeout(() => setStep(2), 1200),  // row 2 ✓
      setTimeout(() => setStep(3), 1500),  // row 3 ✓
      setTimeout(() => setStep(4), 1800),  // row 4 ✓ + status pill "todo listo"
      setTimeout(() => setStep(5), 2700),  // footer chip
      setTimeout(() => setStep(6), 4000),  // countdown empieza a tickear
    ];
    return () => timers.forEach((t) => clearTimeout(t));
  }, [active]);

  // Countdown tickea 1s después de step 6 (sutil sensación de vida)
  useEffect(() => {
    if (!active || step < 6) return;
    const id = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [active, step]);

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <article className="au2-fg au2-ag2">
      <header className="au2-ag2-head">
        <span className="au2-ag2-date">
          <span>mar 14 may</span>
          <span className="au2-ag2-sep">·</span>
          <span className="au2-ag2-date-time">08:30</span>
        </span>
        <span className={"au2-ag2-status" + (step >= 4 ? " is-on" : "")}>
          <span className="au2-ag2-status-dot" />
          <span>todo listo</span>
        </span>
      </header>

      <div className="au2-ag2-hero">
        <div className="au2-ag2-hero-l">
          <span className="au2-ag2-hero-label">primer turno en</span>
          <span className="au2-ag2-hero-count">
            <span className="au2-ag2-hero-mm">{mm}</span>
            <span className="au2-ag2-hero-colon">:</span>
            <span className="au2-ag2-hero-ss">{ss}</span>
          </span>
        </div>
        <div className="au2-ag2-hero-r">
          <span className="au2-ag2-hero-time">10:00 · sala 1</span>
          <span className="au2-ag2-hero-who">Carlos Vega · consulta 1ª</span>
        </div>
      </div>

      <ul className="au2-ag2-list">
        {TURNOS.map((t, i) => {
          const checked = step >= (i + 1);
          return (
            <li key={t.time} className={"au2-ag2-row" + (checked ? " is-checked" : "")}>
              <span className="au2-ag2-row-time">{t.time}</span>
              <span className="au2-ag2-row-avatar">{t.initials}</span>
              <div className="au2-ag2-row-body">
                <span className="au2-ag2-row-name">{t.name}</span>
                <span className="au2-ag2-row-motivo">{t.motivo}</span>
              </div>
              <span className="au2-ag2-row-check" aria-label={checked ? "ficha lista" : "preparando ficha"}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                <span>ficha</span>
              </span>
            </li>
          );
        })}
      </ul>

      <footer className={"au2-ag2-foot" + (step >= 5 ? " is-on" : "")}>
        <span className="au2-ag2-foot-glyph">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.81 1 6.5 2.5L21 8M21 3v5h-5" />
          </svg>
        </span>
        <span className="au2-ag2-foot-text">
          <b>Folio armó tu día</b> a las 06:14 · 4 fichas precargadas
        </span>
      </footer>
    </article>
  );
}
