"use client";

/**
 * Folio · SideArt v3 · Slide 5 "3ª sesión" (Plus / Próximamente)
 *
 * Manifest premium del copiloto. Tratamiento editorial estilo NYT:
 * comillas tipográficas grandes (U+201C/D) 88px --accent como bookmark,
 * cita italic 24px que se escribe palabra por palabra, attribution
 * monoespaciada con em-dash y timeline 1ª·2ª·3ª inline.
 *
 * Diferenciador anti-cliché: la frase la escribió el profesional, Folio
 * solo la trae. Sin sparkle ✦, sin bubble de chat, sin gradiente azul-IA.
 * Comunica dolor #8 (sin registro) + #6 (carga cognitiva burnout).
 *
 * Coreografía (PHASES_TERCERA):
 *   t=0–280   reveal eyebrow + divisor + glifo " (settle lento 600ms)
 *   t=280–1900 reveal hero "3ª sesión." (settle)
 *   t=1900–3000 cita word-by-word — 8 palabras × 110ms = ~880ms cadenciado
 *   t=3000–3500 reveal attribution + timeline + pulse 1× nodo 3 (--accent)
 *   t=3500+    reveal sub
 *
 * Total slide: 7500ms (subido de 7000 según plan S5 — cierre del loop merece HOLD extra).
 */

import { useEffect, useState } from "react";

import { usePhaseSequence } from "@/components/auth/use-phase-sequence";

interface Props {
  active: boolean;
}

const PHASES_TERCERA = [280, 1900, 3000, 3500] as const;

const CITA_WORDS = ["Las", "horas", "sentada", "me", "están", "matando", "la", "espalda."];
const WORD_INTERVAL_MS = 110;

export function SlideTercera({ active }: Props) {
  const phase = usePhaseSequence(PHASES_TERCERA, active);
  // Typing palabra por palabra cada 110ms a partir de phase 2 (t=1900ms).
  const [wordsVisible, setWordsVisible] = useState(0);
  useEffect(() => {
    if (!active || phase < 2) {
      setWordsVisible(0);
      return;
    }
    const timers = CITA_WORDS.map((_, i) =>
      window.setTimeout(() => setWordsVisible(i + 1), i * WORD_INTERVAL_MS),
    );
    return () => timers.forEach(clearTimeout);
  }, [active, phase]);

  // Pulse del nodo 3 al llegar a phase 3 (1 sola vez).
  const [nodePulsed, setNodePulsed] = useState(false);
  useEffect(() => {
    if (!active || phase < 3) {
      setNodePulsed(false);
      return;
    }
    setNodePulsed(true);
    const t = window.setTimeout(() => setNodePulsed(false), 360);
    return () => clearTimeout(t);
  }, [active, phase]);

  return (
    <article className="au2-typo au2-tercera" data-slide="tercera">
      <span className={"au2-typo-eyebrow" + (phase >= 1 ? " is-on" : "")}>
        EN LA SALA · PRÓXIMO TURNO
      </span>
      <div className={"au2-typo-divider" + (phase >= 1 ? " is-on" : "")} aria-hidden="true" />

      <div className={"au2-tercera-quote-glyph" + (phase >= 1 ? " is-on" : "")} aria-hidden="true">
        &ldquo;
      </div>

      <h1 className={"au2-typo-hero-editorial" + (phase >= 2 ? " is-settled" : "")}>
        <span className="au2-typo-quote-open" aria-hidden="true">&ldquo;</span>3&ordf; sesi&oacute;n.<span className="au2-typo-quote-close" aria-hidden="true">&rdquo;</span>
      </h1>

      <p className={"au2-typo-cite" + (phase >= 2 ? " is-on" : "")} aria-label="cita de paciente">
        &ldquo;{CITA_WORDS.slice(0, wordsVisible).join(" ")}
        {wordsVisible > 0 && wordsVisible < CITA_WORDS.length ? <span className="au2-tercera-caret">&nbsp;</span> : null}
        &rdquo;
      </p>

      <p className={"au2-typo-attribution" + (phase >= 3 ? " is-on" : "")}>
        <span aria-hidden="true">&mdash;</span>
        <span>hace 21 d&iacute;as</span>
        <span aria-hidden="true">·</span>
        <span className="au2-tercera-timeline" aria-label="tercera sesión">
          <span className="au2-tercera-node" aria-hidden="true" />
          <span className="au2-tercera-node" aria-hidden="true" />
          <span className={"au2-tercera-node is-current" + (nodePulsed ? " is-pulsed" : "")} aria-hidden="true" />
        </span>
        <span>escrito por vos · recordado por folio</span>
        <span className="au2-tercera-arrow" aria-hidden="true">&rarr;</span>
      </p>

      <p className={"au2-typo-sub" + (phase >= 4 ? " is-on" : "")}>
        No te lo dice cualquier IA: te lo dice tu propio registro, en el momento exacto.
      </p>
    </article>
  );
}
