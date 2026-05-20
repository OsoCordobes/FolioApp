"use client";

/**
 * Folio · Auth · Slide 2 (Calendario · "Mientras atendés, la app trabaja por vos")
 *
 * Port fiel de SlideCalendario en folio/auth.jsx (líneas 203-383).
 *
 * Narrativa:
 *   phase 0       T0           card visible, calm week view
 *   phase 1       T700         banner "Mateo A. reservó online" sobre vie 23
 *                              chip de Mateo aparece + totals 7→8 cuentan
 *   phase 2       T2400        toast "Pago recibido" + chip pasa a is-paid
 *                              paid 4→5, amount 186→221 cuentan
 *   phase 3       T4100        WhatsApp card bottom-right (recordatorio auto)
 */

import { useEffect, useState } from "react";

import { usePhaseSequence } from "@/components/auth/use-phase-sequence";

interface Props {
  active: boolean;
}

interface Turn {
  t: string;
  who: string;
  state: "paid" | "pending" | "idle" | "new";
  live?: boolean;
  story?: boolean;
}

const DAYS: { d: string; n: number; today?: boolean; target?: boolean }[] = [
  { d: "L", n: 19 },
  { d: "M", n: 20 },
  { d: "X", n: 21, today: true },
  { d: "J", n: 22 },
  { d: "V", n: 23, target: true },
  { d: "S", n: 24 },
  { d: "D", n: 25 },
];

// Timings idénticos al pre-refactor:
//   700   → banner "Mateo A. reservó" + totals tween 7→8
//   2400  → toast "Pago recibido" + paid 4→5 + amount 186→221
//   4100  → WhatsApp card bottom-right
const PHASES_CALENDARIO = [700, 2400, 4100] as const;

export function SlideCalendario({ active }: Props) {
  const phase = usePhaseSequence(PHASES_CALENDARIO, active);
  const [totalDisp, setTotalDisp] = useState(7);
  const [paidDisp, setPaidDisp] = useState(4);
  const [amountDisp, setAmountDisp] = useState(186);

  useEffect(() => {
    if (!active) {
      setTotalDisp(7);
      setPaidDisp(4);
      setAmountDisp(186);
    }
  }, [active]);

  // Tween imperativo via rAF (ease-out cubic)
  useEffect(() => {
    if (!active) return;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const runs: Array<() => void> = [];
    const animate = (set: (v: number) => void, from: number, to: number, ms: number) => {
      let raf: number;
      let start: number | undefined;
      const step = (ts: number) => {
        if (start == null) start = ts;
        const t = Math.min(1, (ts - start) / ms);
        set(from + (to - from) * ease(t));
        if (t < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      runs.push(() => cancelAnimationFrame(raf));
    };

    if (phase === 1) {
      animate(setTotalDisp, 7, 8, 500);
    } else if (phase === 2) {
      animate(setPaidDisp, 4, 5, 500);
      animate(setAmountDisp, 186, 221, 700);
    }
    return () => runs.forEach((fn) => fn());
  }, [phase, active]);

  const totalStr = Math.round(totalDisp);
  const paidStr = Math.round(paidDisp);
  const amountStr = Math.round(amountDisp);

  const mateoState: Turn["state"] = phase >= 2 ? "paid" : "new";
  const turns: Record<number, Turn[]> = {
    19: [{ t: "10:00", who: "ML", state: "paid" }, { t: "14:30", who: "AR", state: "paid" }],
    20: [{ t: "09:30", who: "JR", state: "paid" }],
    21: [{ t: "10:45", who: "MG", state: "paid", live: true }, { t: "15:30", who: "VC", state: "pending" }],
    22: [{ t: "11:00", who: "LF", state: "pending" }],
    23: [
      ...(phase >= 1 ? [{ t: "10:00", who: "MA", state: mateoState, story: true } as Turn] : []),
      { t: "16:00", who: "CV", state: "idle" },
    ],
    24: [],
    25: [],
  };

  return (
    <>
      <article className={"au2-fg au2-card-cal au2-cal2" + (phase >= 3 ? " is-phase-wa" : "")}>
        <header className="au2-cal2-head">
          <div className="au2-cal2-now">
            <span className="au2-cal2-now-dot" />
            <span className="au2-cal2-now-time">10:12</span>
            <span className="au2-cal2-now-meta">en consulta · mié 21 may</span>
          </div>
          <div className="au2-cal2-meta">
            <span className={"au2-cal2-amount" + (phase >= 2 ? " is-bumped" : "")}>
              <span className="au2-cal2-amount-sym">$</span>
              <span className="au2-cal2-amount-val">{amountStr}k</span>
            </span>
            <span className={"au2-cal2-paid" + (phase >= 2 ? " is-bumped" : "")}>
              <span className="au2-cal2-paid-glyph">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </span>
              <span className="au2-cal2-paid-num">{paidStr}</span>
              <span className="au2-cal2-paid-sep">/</span>
              <span className="au2-cal2-paid-tot">{totalStr}</span>
            </span>
          </div>
        </header>

        <div className="au2-week au2-cal2-week">
          {DAYS.map((day) => (
            <div
              key={day.n}
              className={
                "au2-week-col" +
                (day.today ? " is-today" : "") +
                (day.target && phase >= 1 ? " is-target" : "")
              }
            >
              <div className="au2-week-head">
                <span className="au2-week-d">{day.d}</span>
                <span className="au2-week-n">{day.n}</span>
              </div>
              <div className="au2-week-list">
                {turns[day.n].length === 0 ? (
                  <span className="au2-week-empty">·</span>
                ) : (
                  turns[day.n].map((tu) => (
                    <div
                      key={tu.who + tu.t}
                      className={
                        "au2-week-chip is-" +
                        tu.state +
                        (tu.live ? " is-live" : "") +
                        (tu.story ? " is-story" : "")
                      }
                    >
                      <span className="au2-week-chip-time">{tu.t}</span>
                      <span className="au2-week-chip-who">{tu.who}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>

        <footer className="au2-cal-foot au2-cal2-foot">
          <span className="au2-cal-legend">
            <span className="au2-cal-dot is-paid" />pagado
            <span className="au2-cal-dot is-pending" />pendiente
            <span className="au2-cal-dot is-idle" />sin cobrar
          </span>
          <span className="au2-cal-auto">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.81 1 6.5 2.5L21 8M21 3v5h-5" />
            </svg>
            automatizado
          </span>
        </footer>
      </article>

      <div className={"au2-cal2-banner" + (phase === 1 ? " is-on" : "")} aria-hidden={phase !== 1}>
        <span className="au2-cal2-banner-glyph">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </span>
        <div className="au2-cal2-banner-body">
          <b>Mateo A. reservó online</b>
          <span className="au2-cal2-banner-meta">vie 23 · 10:00 · primera</span>
        </div>
        <span className="au2-cal2-banner-tail" aria-hidden="true" />
      </div>

      <div className={"au2-cal2-toast" + (phase === 2 ? " is-on" : "")} aria-hidden={phase !== 2}>
        <span className="au2-cal2-toast-glyph">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
        <div className="au2-cal2-toast-body">
          <b>Pago recibido</b>
          <span className="au2-cal2-toast-meta">Mateo A. · $35.000 · Mercado Pago</span>
        </div>
      </div>

      <div className={"au2-cal2-wa" + (phase >= 3 ? " is-on" : "")} aria-hidden={phase < 3}>
        <span className="au2-cal2-wa-icon">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.6 6.32A7.85 7.85 0 0 0 12.05 4a7.94 7.94 0 0 0-6.88 11.9L4 20l4.2-1.1a7.93 7.93 0 0 0 3.84.98h.01a7.94 7.94 0 0 0 7.94-7.94 7.9 7.9 0 0 0-2.4-5.6zM12.05 18.5a6.6 6.6 0 0 1-3.36-.92l-.24-.14-2.5.65.67-2.43-.16-.25a6.6 6.6 0 1 1 5.6 3.1zm3.62-4.94c-.2-.1-1.18-.58-1.36-.65-.18-.07-.32-.1-.45.1-.13.2-.5.65-.62.78-.11.13-.23.15-.43.05-.2-.1-.85-.31-1.61-1-.6-.53-1-1.19-1.12-1.39-.12-.2-.01-.31.09-.41.09-.09.2-.23.3-.35.1-.12.13-.2.2-.33.07-.13.03-.25-.02-.35-.05-.1-.45-1.08-.62-1.48-.16-.39-.33-.34-.45-.34h-.38a.74.74 0 0 0-.54.25c-.18.2-.7.69-.7 1.67 0 .99.71 1.94.82 2.07.1.13 1.4 2.14 3.38 3 .47.2.84.32 1.13.41.47.15.9.13 1.24.08.38-.06 1.18-.48 1.34-.95.17-.46.17-.86.12-.95-.05-.09-.18-.13-.38-.23z" />
          </svg>
        </span>
        <div className="au2-cal2-wa-body">
          <span className="au2-cal2-wa-from">recordatorio · enviado auto</span>
          <span className="au2-cal2-wa-text">&ldquo;Hola Mateo 👋 te esperamos viernes 23 a las 10:00.&rdquo;</span>
        </div>
      </div>
    </>
  );
}
