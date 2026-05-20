"use client";

/**
 * Folio · SideArt v3 · Slide 2 "15 horas"
 *
 * Manifest: el costo invisible de la admin. "15 horas" 96px (núcleo en
 * --ink, "horas" en --ink-3 modifier) conectado por barra vertical brass
 * 1px × 56px a la línea de impacto "= 6 consultas perdidas al mes." en
 * --accent. 6 puntitos representan las consultas; 5 se apagan, queda 1.
 * Comunica dolor #4 (admin AFIP) + #6 (burnout).
 *
 * Coreografía (PHASES_HORAS):
 *   t=0–280     reveal eyebrow + divisor
 *   t=280–1900  settle "15 horas" + count(0→15, 700ms) + reveal relevo
 *   t=1900–3000 draw barra brass vertical + reveal línea impacto (flash)
 *   t=3000–4400 reveal 6 puntitos stagger 40ms
 *   t=4400+     dim 5 puntitos secuencial 80ms (queda solo 1)
 *
 * Total slide: 6500ms.
 */

import { useEffect, useState } from "react";

import { useCountUp } from "@/components/auth/use-count-up";
import { usePhaseSequence } from "@/components/auth/use-phase-sequence";

interface Props {
  active: boolean;
}

const PHASES_HORAS = [280, 1200, 2400, 4400] as const;

export function SlideHoras({ active }: Props) {
  const phase = usePhaseSequence(PHASES_HORAS, active);
  const count = useCountUp(15, 700, active && phase >= 2);
  const horas = Math.round(count);

  // Dim secuencial de 5 puntitos: arranca a los 4400ms, stagger 80ms.
  // Estados: 0 puntitos faded → 1 → 2 → ... → 5 puntitos faded.
  const [fadedCount, setFadedCount] = useState(0);
  useEffect(() => {
    if (!active || phase < 4) {
      setFadedCount(0);
      return;
    }
    const timers = Array.from({ length: 5 }, (_, i) =>
      window.setTimeout(() => setFadedCount(i + 1), 80 * (i + 1)),
    );
    return () => timers.forEach(clearTimeout);
  }, [active, phase]);

  return (
    <article className="au2-typo au2-horas" data-slide="horas">
      <span className={"au2-typo-eyebrow" + (phase >= 1 ? " is-on" : "")}>
        LA CUENTA QUE NADIE TE HACE
      </span>
      <div className={"au2-typo-divider" + (phase >= 1 ? " is-on" : "")} aria-hidden="true" />

      <h1
        className={"au2-typo-hero-editorial" + (phase >= 2 ? " is-settled" : "")}
        style={{ marginTop: "40px" }}
      >
        {horas}
        <span className="au2-typo-hero-unit">&nbsp;horas</span>
      </h1>

      <div className={"au2-horas-bar" + (phase >= 3 ? " is-on" : "")} aria-hidden="true" />

      <p className={"au2-typo-impact" + (phase >= 3 ? " is-on" : "")}>
        = 6 consultas perdidas al mes.
      </p>

      <p className={"au2-typo-relevo" + (phase >= 2 ? " is-on" : "")}>
        por semana de admin.
      </p>

      <div className="au2-horas-dots" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <span
            key={i}
            className={
              "au2-horas-dot" +
              (phase >= 4 ? " is-on" : "") +
              // El primer puntito (i === 0) NO se fadea — es el único que queda.
              (i > 0 && i <= fadedCount ? " is-faded" : "")
            }
            style={{
              transitionDelay: phase >= 4 ? `${i * 40}ms` : "0ms",
            }}
          />
        ))}
      </div>

      <p className={"au2-typo-sub" + (phase >= 2 ? " is-on" : "")}>
        Folio te las devuelve. Facturación AFIP, recordatorios y cobros: automáticos.
      </p>

      <p className={"au2-typo-disclaimer" + (phase >= 4 ? " is-on" : "")}>
        promedio sector · profesionales independientes salud AR
      </p>
    </article>
  );
}
