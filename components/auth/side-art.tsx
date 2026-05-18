"use client";

/**
 * Folio · Auth · panel izquierdo "vivo".
 *
 * Port simplificado de SideArt en folio/auth.jsx (líneas 1042-1173).
 *
 * En F1 renderizamos solo SlideAgenda (primer slide). El carrusel
 * con auto-rotation entre 5 slides + count-down + transición se
 * agrega en F11 (polish). Los 5 dots y el counter "01 / 05" se
 * mantienen para preservar el layout pixel-perfect del prototipo,
 * pero las flechas de nav son no-op (decorativas).
 *
 * Reloj header: dinámico con `new Date()`. Playwright (visual regression)
 * mockea el clock para que sea determinístico entre corridas.
 */

import { useEffect, useState } from "react";

import { FolioMark } from "@/components/folio-mark";
import { SlideAgenda } from "@/components/auth/slide-agenda";

const TOTAL_SLIDES = 5;

export function SideArt() {
  const [now, setNow] = useState<Date | null>(null);

  // Diferimos el primer Date hasta post-mount para evitar hydration mismatch.
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30 * 1000);
    return () => clearInterval(id);
  }, []);

  const hh = now ? String(now.getHours()).padStart(2, "0") : "--";
  const mm = now ? String(now.getMinutes()).padStart(2, "0") : "--";

  // idx es 0 en F1 (sin rotación). En F11 vuelve a useState + setInterval.
  const idx = 0;

  return (
    <aside className="au2-art">
      <div className="au2-art-bg" aria-hidden="true">
        <div className="au2-art-grid" />
        <div className="au2-art-glow" />
      </div>

      <header className="au2-head">
        <div className="au2-head-brand">
          <FolioMark size={26} />
          <span className="au2-logo">folio</span>
          <span className="au2-head-meta">
            {hh}:{mm} · alta gracia
          </span>
        </div>
        <div className="au2-head-status">
          <span className="au2-head-ver">v0.9</span>
          <span className="au2-head-live">
            <span className="au2-status-dot" />
            en vivo
          </span>
        </div>
      </header>

      <div className="au2-stage">
        <div className="au2-slide is-active" aria-hidden={false}>
          <div className="au2-slide-inner">
            <header className="au2-slide-head">
              <span className="au2-slide-eyebrow">08:30 · antes del primer turno</span>
              <h3 className="au2-slide-title">Tu día ya está ordenado antes de que llegues.</h3>
              <p className="au2-slide-sub">
                Folio prepara la agenda y las fichas mientras dormís. Vos abrís la app y empezás.
              </p>
            </header>
            <div className="au2-slide-mockup">
              <SlideAgenda active={true} />
            </div>
          </div>
        </div>

        {/* Flechas sutiles — decorativas en F1, funcionales en F11 */}
        <button className="au2-nav au2-nav--prev" type="button" aria-label="Anterior" disabled>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <button className="au2-nav au2-nav--next" type="button" aria-label="Siguiente" disabled>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </div>

      <footer className="au2-foot">
        <div className="au2-foot-counter">
          <span className="fm-mono au2-counter-val">{String(idx + 1).padStart(2, "0")}</span>
          <span className="au2-counter-sep">/</span>
          <span className="fm-mono au2-counter-total">{String(TOTAL_SLIDES).padStart(2, "0")}</span>
        </div>
        <div className="au2-foot-dots" role="tablist" aria-label="Vista del producto">
          {Array.from({ length: TOTAL_SLIDES }).map((_, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === idx}
              aria-label={`Vista ${i + 1}`}
              className={"au2-dot" + (i === idx ? " is-active" : "")}
              disabled
            />
          ))}
        </div>
      </footer>
    </aside>
  );
}
