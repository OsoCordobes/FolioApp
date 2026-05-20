"use client";

/**
 * Folio · SideArt v3 · Slide 3 "$312.000"
 *
 * Manifest del clímax (tensión 8/10). El número $312.000 sube en count-up
 * 1400ms acumulándose visiblemente — la pérdida se siente como cifra real
 * que crece. Dos barras 20% vs 4% argumentan la solución sin gritar verde.
 * Comunica dolor #2 (no-shows) + #1 (prepagas).
 *
 * Tratamiento tipográfico: "$" weight 400 + --ink-3 (soporte sintáctico,
 * margin-right -0.04em para kerning óptico); "312.000" weight 600 + --ink
 * (núcleo). Separador AR punto. Tabular-nums para que el count-up no
 * salte de ancho.
 *
 * Coreografía (PHASES_PLATA):
 *   t=0–280     reveal eyebrow + divisor
 *   t=280–1700  settle hero + count-up $0 → $312.000 (1400ms)
 *               + reveal relevo a t=1400
 *   t=1700–3200 reveal tag + draw barra #1 (20%) sin label hasta t=3200
 *   t=3200–4700 draw barra #2 (4% con folio)
 *   t=4700+     reveal sub + disclaimer
 *
 * Total slide: 7500ms (clímax merece extra).
 */

import { useCountUp } from "@/components/auth/use-count-up";
import { usePhaseSequence } from "@/components/auth/use-phase-sequence";

interface Props {
  active: boolean;
}

const PHASES_PLATA = [280, 1700, 3200, 4700] as const;

// Formato AR: separador miles con punto, sin decimales
function formatARS(n: number): string {
  return new Intl.NumberFormat("es-AR", {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(n);
}

export function SlidePlata({ active }: Props) {
  const phase = usePhaseSequence(PHASES_PLATA, active);
  const count = useCountUp(312000, 1400, active && phase >= 2);
  const amount = Math.round(count);

  return (
    <article className="au2-typo au2-plata" data-slide="plata">
      <span className={"au2-typo-eyebrow" + (phase >= 1 ? " is-on" : "")}>
        LO QUE TE COSTÓ EL AÑO PASADO
      </span>
      <div className={"au2-typo-divider" + (phase >= 1 ? " is-on" : "")} aria-hidden="true" />

      <h1 className={"au2-typo-hero-editorial au2-plata-hero" + (phase >= 2 ? " is-settled" : "")}>
        <span className="au2-typo-dollar">$</span>{formatARS(amount)}
      </h1>

      <p className={"au2-typo-relevo" + (phase >= 2 ? " is-on" : "")}>
        en turnos que nunca llegaron.
      </p>

      <p className={"au2-typo-tag is-upper" + (phase >= 3 ? " is-on" : "")}>
        BASADO EN 20% NO-SHOWS · TICKET $46.000 · 34 SEMANAS
      </p>

      <div className="au2-plata-bars" style={{ marginTop: 32 }}>
        <div className="au2-plata-bar-row">
          <div className="au2-plata-bar-track">
            <div
              className={"au2-plata-bar-fill" + (phase >= 3 ? " is-on" : "")}
              style={{ "--fill": "0.20" } as React.CSSProperties}
            />
          </div>
          <span className="au2-plata-bar-label">20% no-show</span>
        </div>
        <div className="au2-plata-bar-row">
          <div className="au2-plata-bar-track">
            <div
              className={"au2-plata-bar-fill" + (phase >= 4 ? " is-on" : "")}
              style={{ "--fill": "0.04" } as React.CSSProperties}
            />
          </div>
          <span className="au2-plata-bar-label">con folio · 4%</span>
        </div>
      </div>

      <p className={"au2-typo-sub" + (phase >= 4 ? " is-on" : "")}>
        Con seña obligatoria por Mercado Pago, los no-shows caen del 20% al 4%. Tu margen vuelve.
      </p>

      <p className={"au2-typo-disclaimer" + (phase >= 4 ? " is-on" : "")}>
        estimado sector · reducción típica con seña obligatoria
      </p>
    </article>
  );
}
