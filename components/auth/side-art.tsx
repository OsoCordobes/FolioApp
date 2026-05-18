"use client";

/**
 * Folio · Auth · panel izquierdo "vivo".
 *
 * Port simplificado de SideArt en folio/auth.jsx (líneas 1042-1173).
 *
 * Carousel con auto-rotation entre los 5 slides del prototipo (textos
 * idénticos). El mockup interno reutiliza SlideAgenda para los 5 hasta
 * portar los componentes específicos (SlideCalendario/Finanzas/Reagenda/IA).
 * La rotación, los dots y las flechas SÍ funcionan — el polish del mockup
 * por slide queda como mejora visual incremental.
 *
 * Pausa cuando el mouse está encima o cuando la tab está hidden.
 */

import { useEffect, useState } from "react";

import { FolioMark } from "@/components/folio-mark";
import { SlideAgenda } from "@/components/auth/slide-agenda";

const SLIDE_MS = 5000;
const SLIDE_MS_LONG = 6500;
const SLIDE_MS_XLONG = 7500;

interface SlideDef {
  id: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  dur: number;
  plus?: boolean;
}

const CAROUSEL: SlideDef[] = [
  {
    id: "agenda",
    eyebrow: "08:30 · antes del primer turno",
    title: "Tu día ya está ordenado antes de que llegues.",
    subtitle: "Folio prepara la agenda y las fichas mientras dormís. Vos abrís la app y empezás.",
    dur: SLIDE_MS_LONG,
  },
  {
    id: "calendario",
    eyebrow: "10:12 · mientras atendés",
    title: "Mientras atendés, la app trabaja por vos.",
    subtitle: "Reservas online, cobros y recordatorios — todo en background.",
    dur: SLIDE_MS_LONG,
  },
  {
    id: "finanzas",
    eyebrow: "19:40 · al cierre del día",
    title: "Tu mes en una mirada.",
    subtitle: "Recaudado, turnos atendidos y tu mejor día — al cerrar el consultorio.",
    dur: SLIDE_MS_XLONG,
  },
  {
    id: "reagenda",
    eyebrow: "11:20 · antes de cerrar el turno",
    title: "Reagendá el próximo turno en 2 clics.",
    subtitle: "Sin levantarte de la consulta. El recordatorio queda programado solo, antes de que tu paciente salga.",
    dur: SLIDE_MS_LONG,
  },
  {
    id: "ia",
    eyebrow: "durante toda tu jornada · próximamente",
    title: "Tu copiloto clínico",
    subtitle: "Conoce a cada paciente, te avisa lo importante y te ayuda a crecer.",
    dur: 15000,
    plus: true,
  },
];

export function SideArt() {
  const [now, setNow] = useState<Date | null>(null);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);

  // Diferimos el primer Date hasta post-mount para evitar hydration mismatch.
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

  // Auto-rotation con duración por slide (idéntica al prototipo)
  useEffect(() => {
    if (paused || hidden) return;
    const dur = CAROUSEL[idx]?.dur ?? SLIDE_MS;
    const id = setTimeout(() => {
      setIdx((i) => (i + 1) % CAROUSEL.length);
    }, dur);
    return () => clearTimeout(id);
  }, [idx, paused, hidden]);

  const hh = now ? String(now.getHours()).padStart(2, "0") : "--";
  const mm = now ? String(now.getMinutes()).padStart(2, "0") : "--";

  const goTo = (i: number) => setIdx(((i % CAROUSEL.length) + CAROUSEL.length) % CAROUSEL.length);
  const goPrev = () => goTo(idx - 1);
  const goNext = () => goTo(idx + 1);

  return (
    <aside
      className={"au2-art" + (paused ? " is-paused" : "") + (hidden ? " is-hidden" : "")}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
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
        {CAROUSEL.map((c, i) => {
          const isActive = i === idx;
          return (
            <div
              key={c.id}
              className={"au2-slide" + (isActive ? " is-active" : "")}
              aria-hidden={!isActive}
            >
              <div className="au2-slide-inner">
                <header className="au2-slide-head">
                  <span className="au2-slide-eyebrow">{c.eyebrow}</span>
                  <h3 className="au2-slide-title">
                    {c.title}
                    {c.plus ? <span className="au2-plus-badge au2-plus-badge--title">Plus</span> : null}
                  </h3>
                  <p className="au2-slide-sub">{c.subtitle}</p>
                </header>
                <div className="au2-slide-mockup">
                  <SlideAgenda active={isActive} />
                </div>
              </div>
            </div>
          );
        })}

        <button className="au2-nav au2-nav--prev" type="button" onClick={goPrev} aria-label="Anterior">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <button className="au2-nav au2-nav--next" type="button" onClick={goNext} aria-label="Siguiente">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </div>

      <footer className="au2-foot">
        <div className="au2-foot-counter">
          <span className="fm-mono au2-counter-val">{String(idx + 1).padStart(2, "0")}</span>
          <span className="au2-counter-sep">/</span>
          <span className="fm-mono au2-counter-total">{String(CAROUSEL.length).padStart(2, "0")}</span>
        </div>
        <div className="au2-foot-dots" role="tablist" aria-label="Vista del producto">
          {CAROUSEL.map((c, i) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={i === idx}
              aria-label={c.title}
              className={"au2-dot" + (i === idx ? " is-active" : "")}
              onClick={() => goTo(i)}
            />
          ))}
        </div>
      </footer>
    </aside>
  );
}
