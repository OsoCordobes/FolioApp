/**
 * Folio · Landing · Escena 10:30 — reserva online ("Un día con Folio" · E2).
 *
 * Mockup CSS puro, decorativo (aria-hidden): mini página pública de reservas
 * (card con grilla de horarios, uno seleccionado) + burbuja de WhatsApp con
 * la confirmación ya entregada (check verde). Server component, cero JS;
 * en el modo sticky la burbuja "llega" scrubeada por --fl-day
 * (fl-rsv-wa-in), en base se muestra estática.
 * Clases .fl-rsv-* en public/folio.css (fragmento E2).
 */

import { Check, WhatsApp } from "@/components/icons";

interface Slot {
  time: string;
  state?: "off" | "picked";
}

const SLOTS: Slot[] = [
  { time: "09:30", state: "off" },
  { time: "10:30", state: "picked" },
  { time: "11:30" },
  { time: "12:00" },
  { time: "16:00", state: "off" },
  { time: "17:30" },
];

export function SceneReserva() {
  return (
    <div className="fl-scene-visual" aria-hidden="true">
      <div className="fl-rsv">
        <div className="fl-rsv-card">
          <div className="fl-rsv-head">
            <span className="fl-rsv-url">folio.ar/r/tu-consultorio</span>
            <span className="fl-rsv-title">Elegí un horario · hoy mar 10 jun</span>
          </div>
          <div className="fl-rsv-slots">
            {SLOTS.map((slot) => (
              <span
                key={slot.time}
                className={
                  "fl-rsv-slot" +
                  (slot.state === "off" ? " is-off" : "") +
                  (slot.state === "picked" ? " is-picked" : "")
                }
              >
                {slot.state === "picked" ? <Check size={12} /> : null}
                {slot.time}
              </span>
            ))}
          </div>
        </div>

        <div className="fl-rsv-wa">
          <span className="fl-rsv-wa-icon">
            <WhatsApp size={16} />
          </span>
          <span className="fl-rsv-wa-text">
            Hola Belén — tu turno quedó confirmado para hoy a las 10:30.
            <span className="fl-rsv-wa-meta">✓✓ entregado · 10:31</span>
          </span>
        </div>
      </div>
    </div>
  );
}
