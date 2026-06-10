"use client";

/**
 * Folio · Landing — carousel del showcase de producto (Fase B · B3).
 *
 * Island PESADO (framer-motion + slides au2 del SideArt de auth). NO
 * importarlo estático desde server components: lo monta product-showcase.tsx
 * vía next/dynamic({ ssr: false }) recién cuando la sección se acerca al
 * viewport, para que framer-motion nunca cargue antes del LCP.
 *
 * Reusa los mockups cinemáticos del login (components/auth/slide-*.tsx):
 * aceptan `{ active: boolean }`, sus phases internas (usePhaseSequence /
 * useCountUp) ya respetan prefers-reduced-motion y sus overlays flotantes
 * (toasts, banner, WhatsApp card) se posicionan contra el ancestro
 * posicionado más cercano — acá, `.fl-showcase-mock` (replica el contrato de
 * `.au2-slide-mockup`). El backdrop grid+glow reacciona a `--slide-tint`,
 * definida por vista en .fl-showcase-stage[data-view] (fragmento B3 de CSS).
 *
 * Transición entre vistas: crossfade + blur + micro-scale con los valores de
 * los tokens del design system espejados como constantes FM (framer-motion
 * no lee CSS vars en transition):
 *   - duración 0.32s  = --dur-moderate
 *   - ease [.32,.72,0,1] = --ease-emphasized   (exit: --ease-emphasized-in)
 *   - blur 6px/4px    = --motion-blur-base / --motion-blur-soft
 *
 * A11y: tablist/tab/tabpanel con roving tabindex + flechas/Home/End.
 * Auto-advance cada ~6s, pausado en hover/focus-within/tab oculta; una
 * interacción manual (click/teclado en un tab) lo apaga definitivamente.
 * Botón visible Pausar/Reanudar (.fl-showcase-pause, WCAG 2.2.2): pausa
 * explícita con aria-pressed; "Reanudar" rehabilita el autoplay aunque
 * hubiera habido interacción manual previa.
 * MotionConfig reducedMotion="user" llega vía MotionProvider.
 */

import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

import { AnimatePresence, MDiv } from "@/components/motion/m";
import { MotionProvider } from "@/components/motion/motion-provider";
import { SlideAgenda } from "@/components/auth/slide-agenda";
import { SlideCalendario } from "@/components/auth/slide-calendario";
import { SlideFinanzas } from "@/components/auth/slide-finanzas";
import { useReducedMotion } from "@/components/auth/use-reduced-motion";

import {
  SHOWCASE_AUTO_ADVANCE_MS,
  SHOWCASE_VIEWS,
  type ShowcaseViewId,
} from "./showcase-views";

const SLIDE_BY_ID: Record<ShowcaseViewId, ComponentType<{ active: boolean }>> = {
  agenda: SlideAgenda,
  calendario: SlideCalendario,
  finanzas: SlideFinanzas,
};

/* Espejo de tokens (ver doc-comment): --dur-moderate / --ease-emphasized(-in). */
const DUR_MODERATE_S = 0.32;
const EASE_EMPHASIZED = [0.32, 0.72, 0, 1] as const;
const EASE_EMPHASIZED_IN = [0.4, 0, 1, 1] as const;

export function ProductShowcaseCarousel() {
  const [idx, setIdx] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [interacted, setInteracted] = useState(false);
  const [manuallyPaused, setManuallyPaused] = useState(false);
  const reduced = useReducedMotion();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Pausa global cuando la tab del browser no está visible.
  useEffect(() => {
    if (typeof document === "undefined") return;
    setHidden(document.hidden);
    const onVis = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const autoplaying =
    !hovered && !focused && !hidden && !interacted && !manuallyPaused && !reduced;

  // Auto-advance suave cada ~6s. El timer se reinicia completo al despausar,
  // consistente con el progress fill CSS (que también arranca de 0).
  useEffect(() => {
    if (!autoplaying) return;
    const id = setTimeout(() => {
      setIdx((i) => (i + 1) % SHOWCASE_VIEWS.length);
    }, SHOWCASE_AUTO_ADVANCE_MS);
    return () => clearTimeout(id);
  }, [idx, autoplaying]);

  // Selección manual: apaga el auto-advance (interacción explícita del user).
  const select = (target: number, focusTab: boolean) => {
    const n = SHOWCASE_VIEWS.length;
    const next = ((target % n) + n) % n;
    setInteracted(true);
    setIdx(next);
    if (focusTab) tabRefs.current[next]?.focus();
  };

  // Tablist keyboard nav: flechas + Home/End, selection follows focus.
  const onTablistKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let target: number | null = null;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        target = idx + 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        target = idx - 1;
        break;
      case "Home":
        target = 0;
        break;
      case "End":
        target = SHOWCASE_VIEWS.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    select(target, true);
  };

  // Pausa/reanuda explícita (WCAG 2.2.2). "Reanudar" también limpia el
  // apagado por interacción manual: el control del user manda.
  const togglePaused = () => {
    setManuallyPaused((paused) => {
      if (paused) setInteracted(false);
      return !paused;
    });
  };

  const view = SHOWCASE_VIEWS[idx];
  const ActiveSlide = SLIDE_BY_ID[view.id];

  return (
    <MotionProvider>
      <div
        className="fl-showcase"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={(e) => {
          // Solo despausar si el focus salió del showcase completo.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setFocused(false);
          }
        }}
      >
        <div
          className="fl-showcase-stage"
          data-view={view.id}
          role="tabpanel"
          id="fl-showcase-panel"
          aria-labelledby={`fl-showcase-tab-${view.id}`}
          tabIndex={0}
        >
          <div className="fl-showcase-bg" aria-hidden="true">
            <div className="fl-showcase-grid" />
            <div className="fl-showcase-glow" />
          </div>

          <AnimatePresence mode="popLayout" initial={false}>
            <MDiv
              key={view.id}
              className="fl-showcase-slide"
              initial={{ opacity: 0, scale: 0.985, filter: "blur(6px)" }}
              animate={{
                opacity: 1,
                scale: 1,
                filter: "blur(0px)",
                transition: {
                  opacity: { duration: DUR_MODERATE_S, ease: EASE_EMPHASIZED },
                  scale: { duration: DUR_MODERATE_S * 1.3, ease: EASE_EMPHASIZED },
                  filter: { duration: DUR_MODERATE_S, ease: "easeOut" as const },
                },
              }}
              exit={{
                opacity: 0,
                scale: 0.985,
                filter: "blur(4px)",
                transition: { duration: 0.24, ease: EASE_EMPHASIZED_IN },
              }}
            >
              <div className="fl-showcase-mock">
                <ActiveSlide active={true} />
              </div>
            </MDiv>
          </AnimatePresence>
        </div>

        <div
          className="fl-showcase-tabs"
          role="tablist"
          aria-label="Vistas del producto"
          onKeyDown={onTablistKeyDown}
        >
          {SHOWCASE_VIEWS.map((v, i) => {
            const isActive = i === idx;
            return (
              <button
                key={v.id}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`fl-showcase-tab-${v.id}`}
                aria-selected={isActive}
                aria-controls="fl-showcase-panel"
                tabIndex={isActive ? 0 : -1}
                className={
                  "fl-showcase-tab" +
                  (isActive ? " is-active" : "") +
                  (isActive && autoplaying ? " is-advancing" : "")
                }
                style={{ "--fl-adv-ms": `${SHOWCASE_AUTO_ADVANCE_MS}ms` } as CSSProperties}
                onClick={() => select(i, false)}
              >
                <span className="fl-showcase-tab-label">{v.tab}</span>
                <span className="fl-showcase-tab-caption">{v.caption}</span>
              </button>
            );
          })}
        </div>

        <div className="fl-showcase-controls">
          <button
            type="button"
            className="fl-showcase-pause"
            aria-pressed={manuallyPaused}
            onClick={togglePaused}
          >
            {manuallyPaused ? "Reanudar" : "Pausar"}
          </button>
        </div>
      </div>
    </MotionProvider>
  );
}

export default ProductShowcaseCarousel;
