/**
 * Folio · Landing — sección Bento (#producto) (Rediseño E4).
 *
 * Server component. Reemplaza a Features: grid bento 6×n con mini-demos
 * animadas por CSS (animation-timeline: view() propio de cada celda) y
 * casi cero texto (label ≤4 palabras + sublabel mono opcional por celda).
 * Las demos son decorativas (`aria-hidden`); el significado lo lleva el
 * label. Sin view() o con reduced-motion, el CSS base muestra el estado
 * FINAL de cada demo. Entrada de las cards vía `.fl-reveal` (la define B1)
 * + stagger con revealRange(i).
 */

import { Check, Lock, WhatsApp } from "@/components/icons";
import { revealRange } from "../reveal";

/** Slots de la mini página de reservas — `fill` marca los que se "llenan"
 *  en secuencia (1 → 2 → 3) al scrollear. */
const SLOTS: { time: string; fill?: 1 | 2 | 3 }[] = [
  { time: "09:00" },
  { time: "09:30", fill: 1 },
  { time: "10:00" },
  { time: "10:30" },
  { time: "11:00", fill: 2 },
  { time: "11:30" },
  { time: "12:00" },
  { time: "12:30", fill: 3 },
];

export function Bento() {
  return (
    <section id="producto" className="fl-section fl-bento" data-fl-section="bento">
      <h2 className="fl-bento-title fl-reveal">Todo tu consultorio, en un solo lugar.</h2>

      <div className="fl-bento-grid">
        {/* 1 · Reservas online — celda grande (4×2) */}
        <article className="fl-bento-cell fl-bento-cell--lg fl-reveal" style={revealRange(0)}>
          <div className="fl-bento-demo fl-bbook" aria-hidden="true">
            <div className="fl-bbook-head">
              <span className="fl-bbook-day">Jueves 12 · mañana</span>
              <span className="fl-bbook-badge">
                <span className="fl-bbook-dot" />
                Confirmado
              </span>
            </div>
            <div className="fl-bbook-slots">
              {SLOTS.map((s) => (
                <span
                  key={s.time}
                  className={`fl-bbook-slot${s.fill ? ` is-fill fl-bbook-slot--f${s.fill}` : ""}`}
                >
                  {s.time}
                </span>
              ))}
            </div>
          </div>
          <h3 className="fl-bento-label">Reservan solos</h3>
          <p className="fl-bento-sub">folio.ar/tu-consultorio</p>
        </article>

        {/* 2 · WhatsApp */}
        <article className="fl-bento-cell fl-reveal" style={revealRange(1)}>
          <div className="fl-bento-demo fl-bwa" aria-hidden="true">
            <span className="fl-bwa-app">
              <WhatsApp size={14} />
            </span>
            <span className="fl-bwa-bubble">
              Te esperamos mañana 10:00
              <span className="fl-bwa-meta">
                18:32 <span className="fl-bwa-ticks">✓✓</span>
              </span>
            </span>
          </div>
          <h3 className="fl-bento-label">WhatsApp automático</h3>
          <p className="fl-bento-sub">recordatorio 24 h antes</p>
        </article>

        {/* 3 · Ingresos del mes */}
        <article className="fl-bento-cell fl-reveal" style={revealRange(2)}>
          <div className="fl-bento-demo fl-bnum" aria-hidden="true">
            <span className="fl-bnum-figure">$ 482.500</span>
            <span className="fl-bnum-bars">
              <i className="fl-bnum-bar fl-bnum-bar--1" />
              <i className="fl-bnum-bar fl-bnum-bar--2" />
              <i className="fl-bnum-bar fl-bnum-bar--3" />
              <i className="fl-bnum-bar fl-bnum-bar--4" />
            </span>
          </div>
          <h3 className="fl-bento-label">El mes, en números</h3>
          <p className="fl-bento-sub">sin planillas</p>
        </article>

        {/* 4 · Google Calendar */}
        <article className="fl-bento-cell fl-reveal" style={revealRange(3)}>
          <div className="fl-bento-demo fl-bcal" aria-hidden="true">
            <span className="fl-bcal-card">Folio</span>
            <span className="fl-bcal-track">
              <i className="fl-bcal-dot" />
            </span>
            <span className="fl-bcal-card">
              Google
              <span className="fl-bcal-check">
                <Check size={12} />
              </span>
            </span>
          </div>
          <h3 className="fl-bento-label">Google Calendar, espejado</h3>
          <p className="fl-bento-sub">dos vías, nada se pisa</p>
        </article>

        {/* 5 · Cifrado */}
        <article className="fl-bento-cell fl-reveal" style={revealRange(4)}>
          <div className="fl-bento-demo fl-bcif" aria-hidden="true">
            <span className="fl-bcif-lock">
              <Lock size={16} />
            </span>
            <span className="fl-bcif-lines">
              <span className="fl-bcif-plain">
                Dolor lumbar, mejora
                <br />
                continuar ejercicios
              </span>
              <span className="fl-bcif-cipher">
                f3a1 · 9c4e · 22b7
                <br />
                08d6 · e1a9 · 5cb0
              </span>
            </span>
          </div>
          <h3 className="fl-bento-label">Bajo llave</h3>
          <p className="fl-bento-sub">cifrado AES-256</p>
        </article>

        {/* 6 · Equipo */}
        <article className="fl-bento-cell fl-reveal" style={revealRange(5)}>
          <div className="fl-bento-demo fl-bteam" aria-hidden="true">
            <span className="fl-bteam-ava fl-bteam-ava--1">LF</span>
            <span className="fl-bteam-ava fl-bteam-ava--2">MR</span>
            <span className="fl-bteam-ava fl-bteam-ava--3">AC</span>
          </div>
          <h3 className="fl-bento-label">Equipo con roles</h3>
          <p className="fl-bento-sub">admin · médica · recepción</p>
        </article>
      </div>
    </section>
  );
}
