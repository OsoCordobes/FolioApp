"use client";

/**
 * Folio · Auth · panel izquierdo "vivo" v2.
 *
 * Orchestrator del SideArt: state (idx, paused, hidden, direction, clock),
 * data del CAROUSEL, lazy mount window [prev, current, next], delegación a
 * <SideArtShell /> + <SideArtStage /> para JSX.
 *
 * Diferencias clave vs v1:
 *   1. Transición direction-aware con crossfade + scale + blur + spring x
 *      (vía SideArtStage + framer-motion). Forward y backward son
 *      visualmente distintos. Wraparound 4→0 es forward.
 *   2. Entry animation propia del SideArt al montar (translate desde la
 *      izquierda + fade del glow).
 *   3. Pause indicator visible con debounce 240ms en hover (NO flickerea
 *      en passes rápidos).
 *   4. Dots con progress fill animado CSS-only (var --slide-dur).
 *   5. Lazy mount [prev, current, next] reduce 5 → 3 slides montados.
 *
 * Pausa por hover sostenido + tab visibility. Auto-rotation con dur por slide.
 */

import { LazyMotion, domMax } from "framer-motion";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";

import { MAside, MDiv } from "@/components/motion/m";
import { SideArtShell } from "@/components/auth/side-art-shell";
import { useReducedMotion } from "@/components/auth/use-reduced-motion";
import { SideArtStage } from "@/components/auth/side-art-stage";
import { tintClassFor } from "@/components/auth/side-art-tints";
import { SlideAgenda } from "@/components/auth/slide-agenda";
import { SlideCalendario } from "@/components/auth/slide-calendario";
import { SlideFinanzas } from "@/components/auth/slide-finanzas";
import { SlideIA } from "@/components/auth/slide-ia";
import { SlideReagenda } from "@/components/auth/slide-reagenda";

const SLIDE_MS = 5000;
const SLIDE_MS_LONG = 6500;
const SLIDE_MS_XLONG = 7500;
const PAUSE_INDICATOR_DELAY_MS = 240;

interface SlideDef {
  id: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  comp: ComponentType<{ active: boolean }>;
  dur: number;
  plus?: boolean;
}

const CAROUSEL: SlideDef[] = [
  {
    id: "agenda",
    eyebrow: "08:30 · antes del primer turno",
    title: "Tu día ya está ordenado antes de que llegues.",
    subtitle: "Folio prepara la agenda y las fichas mientras dormís. Vos abrís la app y empezás.",
    comp: SlideAgenda,
    dur: SLIDE_MS_LONG,
  },
  {
    id: "calendario",
    eyebrow: "10:12 · mientras atendés",
    title: "Mientras atendés, la app trabaja por vos.",
    subtitle: "Reservas online, cobros y recordatorios — todo en background.",
    comp: SlideCalendario,
    dur: SLIDE_MS_LONG,
  },
  {
    id: "finanzas",
    eyebrow: "19:40 · al cierre del día",
    title: "Tu mes en una mirada.",
    subtitle: "Recaudado, turnos atendidos y tu mejor día — al cerrar el consultorio.",
    comp: SlideFinanzas,
    dur: SLIDE_MS_XLONG,
  },
  {
    id: "reagenda",
    eyebrow: "11:20 · antes de cerrar el turno",
    title: "Reagendá el próximo turno en 2 clics.",
    subtitle: "Sin levantarte de la consulta. El recordatorio queda programado solo, antes de que tu paciente salga.",
    comp: SlideReagenda,
    dur: SLIDE_MS_LONG,
  },
  {
    id: "ia",
    eyebrow: "durante toda tu jornada · próximamente",
    title: "Tu copiloto clínico",
    subtitle: "Conoce a cada paciente, te avisa lo importante y te ayuda a crecer.",
    comp: SlideIA,
    dur: 7000, // C11: comprimido de 15000 a 7000 — 7 beats con FM stagger en bullets
    plus: true,
  },
];

export function SideArt() {
  const [now, setNow] = useState<Date | null>(null);
  const [idx, setIdx] = useState(0);
  const [prevIdx, setPrevIdx] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [pauseIndicatorVisible, setPauseIndicatorVisible] = useState(false);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedMotion = useReducedMotion();

  // Clock (postmount + tick cada 30s para evitar hydration mismatch)
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30 * 1000);
    return () => clearInterval(id);
  }, []);

  // Pausa global cuando la tab no está visible
  useEffect(() => {
    if (typeof document === "undefined") return;
    setHidden(document.hidden);
    const onVis = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Auto-rotation con duración por slide
  useEffect(() => {
    if (paused || hidden) return;
    const dur = CAROUSEL[idx]?.dur ?? SLIDE_MS;
    const id = setTimeout(() => {
      // auto-rotate: siempre forward (incluso wraparound 4→0)
      setDirection(1);
      setPrevIdx(idx);
      setIdx((i) => (i + 1) % CAROUSEL.length);
    }, dur);
    return () => clearTimeout(id);
  }, [idx, paused, hidden]);

  // Pause indicator: debounce 240ms para evitar flicker en hover passes rápidos
  useEffect(() => {
    if (pauseTimerRef.current) {
      clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }
    if (paused) {
      pauseTimerRef.current = setTimeout(() => {
        setPauseIndicatorVisible(true);
      }, PAUSE_INDICATOR_DELAY_MS);
    } else {
      setPauseIndicatorVisible(false);
    }
    return () => {
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    };
  }, [paused]);

  // Navigation helpers — calculan direction antes de setIdx, trackean prevIdx
  const goTo = (target: number) => {
    const n = CAROUSEL.length;
    const next = ((target % n) + n) % n;
    if (next === idx) return;
    // Direction = camino más corto en el carousel circular
    const forwardDist = (next - idx + n) % n;
    const backwardDist = (idx - next + n) % n;
    setDirection(forwardDist <= backwardDist ? 1 : -1);
    setPrevIdx(idx);
    setIdx(next);
  };
  const goPrev = () => {
    setDirection(-1);
    setPrevIdx(idx);
    setIdx((i) => (i - 1 + CAROUSEL.length) % CAROUSEL.length);
  };
  const goNext = () => {
    setDirection(1);
    setPrevIdx(idx);
    setIdx((i) => (i + 1) % CAROUSEL.length);
  };

  // Lazy mount: solo renderizamos [prev, current, next] (3 de 5)
  const visibleSet = useMemo(() => {
    const n = CAROUSEL.length;
    return new Set([(idx - 1 + n) % n, idx, (idx + 1) % n]);
  }, [idx]);

  const hh = now ? String(now.getHours()).padStart(2, "0") : "--";
  const mm = now ? String(now.getMinutes()).padStart(2, "0") : "--";
  const clock = `${hh}:${mm}`;

  const current = CAROUSEL[idx];
  const Active = current.comp;
  const tintClass = tintClassFor(idx);

  return (
    <MAside
      className={
        "au2-art " +
        tintClass +
        (paused ? " is-paused" : "") +
        (hidden ? " is-hidden" : "")
      }
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.72, ease: [0, 0, 0.2, 1], delay: 0.06 }}
    >
      <div className="au2-art-bg" aria-hidden="true">
        <div className="au2-art-grid" />
        <MDiv
          className="au2-art-glow"
          initial={{ opacity: 0, scale: 1.4 }}
          animate={{ opacity: 0.6, scale: 1 }}
          transition={{ duration: 1.2, ease: [0, 0, 0.2, 1], delay: 0.18 }}
        />
      </div>

      <SideArtShell
        current={current}
        idx={idx}
        total={CAROUSEL.length}
        slides={CAROUSEL}
        clock={clock}
        paused={paused}
        pauseIndicatorVisible={pauseIndicatorVisible}
        onPrev={goPrev}
        onNext={goNext}
        onGoTo={goTo}
      >
        <SideArtStage
          slideKey={current.id}
          direction={direction}
          fromIdx={prevIdx}
          toIdx={idx}
          reducedMotion={reducedMotion}
        >
          <div className="au2-slide-inner">
            <header className="au2-slide-head">
              <span className="au2-slide-eyebrow">{current.eyebrow}</span>
              <h3 className="au2-slide-title">
                {current.title}
                {current.plus ? <span className="au2-plus-badge au2-plus-badge--title">Plus</span> : null}
              </h3>
              <p className="au2-slide-sub">{current.subtitle}</p>
            </header>
            <div className="au2-slide-mockup">
              {/* Lazy mount window: solo monto slides en visibleSet, pero el activo
                  se renderiza siempre acá (es current.comp). Los otros 2 (prev y
                  next) se montan invisibles abajo para que sus useEffects estén
                  vivos antes de que se transicione a ellos (preempt timers).
                  Optimización futura: pasar Active prop al wrapper en vez de
                  current.comp para reusar instancia. */}
              <Active active={true} />
            </div>
          </div>
        </SideArtStage>

        {/* Preempt slides: prev + next montados sin transition wrapper, hidden
            visualmente pero su lógica corre (countdowns 30s, etc están listos
            cuando el user llegue a ese slide). Su `active=false` no dispara
            las animaciones internas. */}
        {CAROUSEL.map((c, i) => {
          if (i === idx) return null;
          if (!visibleSet.has(i)) return null;
          const Comp = c.comp;
          return (
            <div key={`preempt-${c.id}`} style={{ display: "none" }} aria-hidden>
              <Comp active={false} />
            </div>
          );
        })}
      </SideArtShell>
    </MAside>
  );
}

// Re-export LazyMotion + domMax para tree-shake check (NO debería ser
// importado fuera de motion-provider.tsx, pero en caso de necesidad ad-hoc
// de un sub-tree con su propio LazyMotion).
export { LazyMotion, domMax };
