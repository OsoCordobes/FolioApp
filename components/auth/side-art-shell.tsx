"use client";

/**
 * Folio · SideArt · Shell
 *
 * JSX puro del envoltorio del SideArt: header (mark + clock + status),
 * stage (delegado al padre via children), footer (counter + dots con
 * progress fill + nav arrows), pause indicator (overlay top-right).
 *
 * Sin lógica de orchestration — todo el state vive en side-art.tsx.
 * Recibe callbacks y props.
 */

import { AnimatePresence } from "framer-motion";
import type { CSSProperties, ReactNode } from "react";

import { MDiv } from "@/components/motion/m";
import { FolioMark } from "@/components/folio-mark";

interface SlideMeta {
  id: string;
  title: string;
  dur: number;
}

interface SideArtShellProps {
  /** Slide actual (para meta del dot activo + key de progress fill). */
  current: SlideMeta;
  /** Índice del slide actual. */
  idx: number;
  /** Total de slides (para counter "01/05"). */
  total: number;
  /** Lista de todos los slides (para los dots). */
  slides: readonly SlideMeta[];
  /** Hora actual (h:mm) — el padre la actualiza cada 30s. */
  clock: string;
  /** Si el carousel está pausado por hover o tab hidden. */
  paused: boolean;
  /** Si el indicador "pausado" overlay debe ser visible (delayed hover). */
  pauseIndicatorVisible: boolean;
  /** Children = el contenido del stage (slides renderizados). */
  children: ReactNode;
  /** Callbacks de nav. */
  onPrev: () => void;
  onNext: () => void;
  onGoTo: (idx: number) => void;
}

export function SideArtShell({
  current,
  idx,
  total,
  slides,
  clock,
  paused,
  pauseIndicatorVisible,
  children,
  onPrev,
  onNext,
  onGoTo,
}: SideArtShellProps) {
  const counter = String(idx + 1).padStart(2, "0");
  const totalStr = String(total).padStart(2, "0");

  return (
    <>
      <header className="au2-head">
        <div className="au2-head-brand">
          <FolioMark size={26} />
          <span className="au2-logo">folio</span>
          <span className="au2-head-meta">
            {clock} · alta gracia
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
        {children}

        <button className="au2-nav au2-nav--prev" type="button" onClick={onPrev} aria-label="Anterior">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <button className="au2-nav au2-nav--next" type="button" onClick={onNext} aria-label="Siguiente">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </div>

      <footer className="au2-foot">
        <div className="au2-foot-counter">
          <span className="fm-mono au2-counter-val">{counter}</span>
          <span className="au2-counter-sep">/</span>
          <span className="fm-mono au2-counter-total">{totalStr}</span>
        </div>
        <div className="au2-foot-dots" role="tablist" aria-label="Vista del producto">
          {slides.map((c, i) => {
            const isActive = i === idx;
            return (
              <button
                key={isActive ? `${c.id}-${idx}-active` : c.id}
                role="tab"
                aria-selected={isActive}
                aria-label={c.title}
                className={"au2-dot" + (isActive ? " is-active" : "")}
                style={isActive ? ({ "--slide-dur": `${current.dur}ms` } as CSSProperties) : undefined}
                onClick={() => onGoTo(i)}
              />
            );
          })}
        </div>
      </footer>

      {/* Pause indicator overlay top-right (delayed hover 240ms) */}
      <AnimatePresence>
        {pauseIndicatorVisible && paused ? (
          <MDiv
            className="au2-pause-indicator"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.14, ease: [0.32, 0.72, 0, 1] }}
            aria-hidden
          >
            <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden>
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
            <span>pausado</span>
          </MDiv>
        ) : null}
      </AnimatePresence>
    </>
  );
}
