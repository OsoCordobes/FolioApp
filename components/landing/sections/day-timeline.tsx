/**
 * Folio · Landing — sección "Un día con Folio" (#dia) · escenas 10:30 → 14:00 → 20:00.
 *
 * Server component, CERO JS. Continúa el día que abre el hero (08:00) y
 * desemboca en la bóveda de seguridad. Mecánica 100 % CSS (fragmento E2 en
 * public/folio.css):
 *   — BASE (mobile / sin animation-timeline / reduced-motion): escenas
 *     apiladas en flujo normal, siempre legibles; entrada suave con
 *     `.fl-reveal` (B1). Los mockups se muestran en estado final
 *     (la nota YA cifrada, candado visible).
 *   — ENHANCED (≥768px + motion ok + @supports view()): `.fl-day` mide 320vh
 *     y nombra la view-timeline `--fl-day`; `.fl-day-stage` queda sticky bajo
 *     el header y las 3 escenas se scrubean en crossfade. El ciphertext de la
 *     escena 14:00 se revela con un clip-path sweep dentro de su ventana.
 *
 * El copy vive siempre en el DOM (las escenas inactivas se ocultan solo por
 * opacity); los mockups son decorativos (aria-hidden) y no hay ningún
 * elemento interactivo dentro de las escenas.
 */

import type { ReactNode } from "react";

import { SceneCierre } from "../scenes/scene-cierre";
import { SceneCifrado } from "../scenes/scene-cifrado";
import { SceneReserva } from "../scenes/scene-reserva";

interface DayScene {
  /** Sufijo de la clase de escena (`fl-scene--a/b/c`) — define su keyframe. */
  id: "a" | "b" | "c";
  hour: string;
  text: string;
  visual: ReactNode;
}

const SCENES: DayScene[] = [
  {
    id: "a",
    hour: "10:30",
    text: "Belén reservó sola desde tu página. El WhatsApp de confirmación ya salió.",
    visual: <SceneReserva />,
  },
  {
    id: "b",
    hour: "14:00",
    text: "Cerrás la nota. Se cifra antes de tocar la base de datos.",
    visual: <SceneCifrado />,
  },
  {
    id: "c",
    hour: "20:00",
    text: "Día cerrado: 6 pacientes, $96.000 registrados, 0 planillas.",
    visual: <SceneCierre />,
  },
];

export function DayTimeline() {
  return (
    <section id="dia" className="fl-day" data-fl-section="day">
      <div className="fl-day-stage">
        <header className="fl-day-head fl-reveal">
          <p className="fl-day-eyebrow">Un día con Folio</p>
          <span className="fl-day-rail" aria-hidden="true">
            <span className="fl-day-rail-fill" />
          </span>
        </header>

        <ol className="fl-day-scenes" aria-label="Un día con Folio, hora por hora">
          {SCENES.map((scene) => (
            <li key={scene.id} className={`fl-scene fl-scene--${scene.id} fl-reveal`}>
              <div className="fl-scene-copy">
                <span className="fl-scene-hour">{scene.hour}</span>
                <p className="fl-scene-text">{scene.text}</p>
              </div>
              {scene.visual}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
