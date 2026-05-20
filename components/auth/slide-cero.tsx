"use client";

/**
 * Folio · SideArt v3 · Slide 1 "Cero"
 *
 * Manifest: el número 0 monumental (220px slashed-zero) sostenido por
 * "whatsapps sin responder." 38px. Comunica el dolor #3 (WhatsApp
 * infinito) + #8 (sin registro) con UN solo gesto tipográfico.
 *
 * Coreografía (PHASES_CERO):
 *   t=0–280   reveal eyebrow + divisor (verb: reveal)
 *   t=280–900 settle "0" + count-down 9→0 (verbs: settle + count)
 *             — micro-pulse al llegar a 0 (verb: pulse 1×)
 *   t=900–1450 reveal relevo + sub (stagger)
 *   t=4200+    reveal timestamp anchored bottom (verb: reveal)
 *
 * Total slide: 6500ms (CAROUSEL[0].dur).
 *
 * Reduce-motion: usePhaseSequence skip-to-end + useCountUp respeta reduced;
 * el "0" aparece estático directo en su tamaño final.
 */

import { useCountUp } from "@/components/auth/use-count-up";
import { usePhaseSequence } from "@/components/auth/use-phase-sequence";

interface Props {
  active: boolean;
}

const PHASES_CERO = [280, 900, 1450, 4200] as const;

export function SlideCero({ active }: Props) {
  const phase = usePhaseSequence(PHASES_CERO, active);
  // Count-down inverso: empieza en 9, baja a 0 en 600ms.
  // useCountUp tween de 0 a 9 + lo invertimos visualmente (9 - valor).
  const counterUp = useCountUp(9, 600, active && phase >= 2);
  const visibleNumber = active && phase >= 2 ? Math.max(0, Math.round(9 - counterUp)) : 9;
  // Cuando el counterUp llega a 9 (al final del tween), mostramos 0 final.
  const arrivedAtZero = active && phase >= 2 && counterUp >= 8.95;

  return (
    <article className="au2-typo au2-cero" data-slide="cero">
      <span className={"au2-typo-eyebrow" + (phase >= 1 ? " is-on" : "")}>
        08:30 · LUNES
      </span>
      <div className={"au2-typo-divider" + (phase >= 1 ? " is-on" : "")} aria-hidden="true" />

      <h1
        className={
          "au2-typo-hero-monumental" +
          (phase >= 2 ? " is-settled" : "") +
          (arrivedAtZero ? " is-arrived" : "")
        }
        data-shadow={String(visibleNumber)}
        aria-label="cero"
      >
        {visibleNumber}
      </h1>

      <p className={"au2-typo-relevo-strong" + (phase >= 3 ? " is-on" : "")}>
        whatsapps sin responder.
      </p>

      <p className={"au2-typo-sub" + (phase >= 3 ? " is-on" : "")}>
        Folio confirmó los 7 turnos de hoy ayer a la noche. Vos llegás y empezás.
      </p>

      <p className={"au2-typo-timestamp" + (phase >= 4 ? " is-on" : "")}>
        firmado · folio · 06:14 am
      </p>
    </article>
  );
}
