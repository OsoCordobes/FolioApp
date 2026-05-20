"use client";

/**
 * Folio · SideArt v3 · Slide 4 "7s"
 *
 * Manifest del alivio activo. "7s" 110px (núcleo "7" + suffix "s" weight
 * 400 --ink-3) acompañado de una barra cronómetro de EXACTAMENTE 7000ms
 * (linear). Cuando la barra se completa, "7s" cross-fade a "✓" en --accent.
 * Comunica dolor #7 (cobrar humilla) + #2 (no-shows).
 *
 * **Crítico**: durante los 7000ms del cronómetro, el slide entero está
 * en silencio (sin micro-animaciones, sin pulsos). El silencio ES el
 * contenido — "esto es todo el tiempo que toma cobrar".
 *
 * Coreografía (PHASES_SIETE):
 *   t=0–280   reveal eyebrow + divisor + relevo + sub. "7s" estático en
 *             tamaño final desde t=0 (sin count-up — el contador es la barra).
 *   t=280–7280 draw barra cronómetro 7000ms linear (animation CSS).
 *   t=7280–7700 cross-fade "7s" → "✓" + reveal timestamp.
 *
 * Total slide: 7700ms — rompe regla ≤7s exactos porque la duración ES el
 * contenido. CAROUSEL[3].dur = 7700.
 */

import { usePhaseSequence } from "@/components/auth/use-phase-sequence";

interface Props {
  active: boolean;
}

const PHASES_SIETE = [280, 7280, 7700] as const;

export function SlideSiete({ active }: Props) {
  const phase = usePhaseSequence(PHASES_SIETE, active);
  // El cronómetro arranca con el draw (CSS animation) cuando phase >= 1.
  const meterRunning = active && phase >= 1;
  const checkedDone = phase >= 2;  // a t=7280, "7s" → "✓"

  return (
    <article className="au2-typo au2-siete" data-slide="siete">
      <span className={"au2-typo-eyebrow" + (phase >= 1 ? " is-on" : "")}>
        11:47 · ENTRE DOS PACIENTES
      </span>
      <div className={"au2-typo-divider" + (phase >= 1 ? " is-on" : "")} aria-hidden="true" />

      <h1
        className={"au2-typo-hero-numeric au2-siete-hero" + (phase >= 1 ? " is-settled" : "")}
        aria-label={checkedDone ? "cobrado" : "siete segundos"}
      >
        {checkedDone ? (
          <span className="au2-siete-check">✓</span>
        ) : (
          <>
            7<span className="au2-typo-s-suffix">s</span>
          </>
        )}
      </h1>

      <div className="au2-siete-meter" aria-hidden="true">
        <div className={"au2-siete-meter-fill" + (meterRunning ? " is-running" : "")} />
      </div>

      <p className={"au2-typo-relevo" + (phase >= 1 ? " is-on" : "")}>
        para cobrar el próximo turno.
      </p>

      <p className={"au2-typo-sub" + (phase >= 1 ? " is-on" : "")}>
        Folio manda el link de pago al WhatsApp del paciente. Vos seguís con el siguiente.
      </p>

      <p className={"au2-typo-timestamp" + (checkedDone ? " is-on" : "")}>
        enviado · 11:47:38 · whatsapp
      </p>
    </article>
  );
}
