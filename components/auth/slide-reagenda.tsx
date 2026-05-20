"use client";

/**
 * Folio · Auth · Slide 4 (Reagenda · "La IA propone, vos confirmás")
 *
 * Port fiel de SlideReagenda en folio/auth.jsx (líneas 600-719).
 *
 * Beats:
 *   T0–400      consult anchor visible (María G. en sala 1, 38m)
 *               3 step-shells idle.
 *   T400        Step 1 activa · "IA sugiere" + slot data
 *   T1100       Step 1 ✓
 *   T1500       Cursor entra desde abajo-derecha, viaja al botón
 *   T2100       Cursor sobre botón, click ripple, botón press
 *   T2400       Step 2 ✓, cursor fade out
 *   T2800       Step 3 activa · "Folio programa" + WhatsApp glyph
 *   T3500       Step 3 ✓
 *   T3900       Bottom banner sube · "próxima cita queda lista"
 */

import { GhostCalendar } from "@/components/auth/ghost-art";
import { usePhaseSequence } from "@/components/auth/use-phase-sequence";

interface Props {
  active: boolean;
}

function Check() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// Timings idénticos al pre-refactor — 7 beats:
//   400  → step 1 activa "IA sugiere"
//   1100 → step 1 ✓
//   1500 → cursor entra desde abajo-derecha
//   2500 → step 2 ✓ (click ripple + button press)
//   2900 → step 3 activa "Folio programa" + WhatsApp glyph
//   3600 → step 3 ✓
//   4000 → bottom banner "próxima cita queda lista" sube
const PHASES_REAGENDA = [400, 1100, 1500, 2500, 2900, 3600, 4000] as const;

export function SlideReagenda({ active }: Props) {
  const phase = usePhaseSequence(PHASES_REAGENDA, active);

  const step1Done = phase >= 2;
  const step2Done = phase >= 4;
  const step3Done = phase >= 6;
  const step1Active = phase >= 1 && !step1Done;
  const step2Active = phase >= 2 && !step2Done;
  const step3Active = phase >= 5 && !step3Done;

  return (
    <article className={"au2-fg au2-rea2 phase-" + phase}>
      {/* C14: ghost calendar layer detrás del wizard de reagenda. Comunica
          "esto pasa sobre la vista calendario del app real". */}
      <GhostCalendar />
      <header className="au2-rea2-head">
        <span className="au2-rea2-pulse">
          <span className="au2-rea2-pulse-dot" />
          <span className="au2-rea2-pulse-time">11:20</span>
        </span>
        <span className="au2-rea2-who">
          <span className="au2-rea2-who-name">María G.</span>
          <span className="au2-rea2-who-meta">control 12ª · sala 1 · 38m en consulta</span>
        </span>
        <span className="au2-rea2-tag">por cerrar</span>
      </header>

      <ol className="au2-rea2-steps">
        <li className={"au2-rea2-step" + (step1Active ? " is-active" : "") + (step1Done ? " is-done" : "")}>
          <span className="au2-rea2-step-n" aria-hidden="true">
            {step1Done ? <Check /> : <span>1</span>}
          </span>
          <div className="au2-rea2-step-body">
            <span className="au2-rea2-step-actor">
              <span className="au2-rea2-step-actor-glyph">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <path d="M16 2v4M8 2v4M3 10h18" />
                </svg>
              </span>
              <span>próximo turno</span>
            </span>
            <span className="au2-rea2-step-content">
              <span className="au2-rea2-mono">MAR 20 MAY · 10:00</span>
              <span className="au2-rea2-step-meta">sala 1 · 7 días · slot libre</span>
            </span>
          </div>
        </li>

        <li className={"au2-rea2-step" + (step2Active ? " is-active" : "") + (step2Done ? " is-done" : "")}>
          <span className="au2-rea2-step-n" aria-hidden="true">
            {step2Done ? <Check /> : <span>2</span>}
          </span>
          <div className="au2-rea2-step-body">
            <span className="au2-rea2-step-actor">
              <span>vos confirmás</span>
            </span>
            <div className="au2-rea2-btn-wrap">
              <button className="au2-rea2-btn" type="button" tabIndex={-1}>
                <span>confirmar turno</span>
              </button>
              <span className={"au2-rea2-cursor" + (phase >= 3 && phase < 5 ? " is-on" : "")} aria-hidden="true">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="var(--ink)" stroke="var(--surface)" strokeWidth="1.6">
                  <path d="M4.7 3.3a.9.9 0 0 0-1.4 1l4.9 16.4c.3.9 1.5.9 1.7-.1l1.4-5.6 5.6-1.4c1-.2 1-1.4.1-1.7L4.7 3.3z" />
                </svg>
              </span>
            </div>
          </div>
        </li>

        <li className={"au2-rea2-step" + (step3Active ? " is-active" : "") + (step3Done ? " is-done" : "")}>
          <span className="au2-rea2-step-n" aria-hidden="true">
            {step3Done ? <Check /> : <span>3</span>}
          </span>
          <div className="au2-rea2-step-body">
            <span className="au2-rea2-step-actor">
              <span className="au2-rea2-step-actor-glyph au2-rea2-step-wa">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.6 6.3A7.85 7.85 0 0 0 12 4a7.94 7.94 0 0 0-6.88 11.9L4 20l4.2-1.1a7.93 7.93 0 0 0 3.84.98 7.94 7.94 0 0 0 7.94-7.94 7.9 7.9 0 0 0-2.4-5.6z" />
                </svg>
              </span>
              <span>folio programa</span>
            </span>
            <span className="au2-rea2-step-content">
              <span>recordatorio por WhatsApp</span>
              <span className="au2-rea2-step-meta">24h antes · auto</span>
            </span>
          </div>
        </li>
      </ol>

      <footer className={"au2-rea2-foot" + (phase >= 7 ? " is-on" : "")} aria-hidden={phase < 7}>
        <span className="au2-rea2-foot-check">
          <Check />
        </span>
        <span className="au2-rea2-foot-text">
          <b>Próxima cita lista</b>
          <span>mar 20 may · 10:00 · sala 1</span>
        </span>
      </footer>
    </article>
  );
}
