/**
 * Folio · Landing · Escena 10:30 — reserva online ("Un día con Folio" · E2/R2).
 *
 * Mockup CSS puro, decorativo (aria-hidden): la página pública de reservas
 * en miniatura — header del consultorio (avatar con iniciales + nombre + URL
 * mono), selector de servicio, grilla de horarios con el de Belén
 * seleccionado y botón Confirmar — compuesta en capas como el hero: una
 * card trasera desenfocada detrás y la notificación de WhatsApp superpuesta
 * en la esquina (hora + doble check). Server component, cero JS; en el modo
 * sticky la burbuja "llega" scrubeada por --fl-day (fl-rsv-wa-in, range
 * contain 6%–16% intacto), en base se muestra estática.
 * Clases .fl-rsv-* en public/folio.css (fragmento E2 + refinamiento R2).
 */

import { Check, WhatsApp } from "@/components/icons";

interface Slot {
  time: string;
  state?: "off" | "picked";
}

const SLOTS: Slot[] = [
  { time: "09:00", state: "off" },
  { time: "10:00", state: "picked" },
  { time: "11:00" },
  { time: "12:00" },
  { time: "16:00", state: "off" },
  { time: "17:30" },
];

export function SceneReserva() {
  return (
    <div className="fl-scene-visual" aria-hidden="true">
      <div className="fl-rsv">
        {/* capa trasera — la misma página un paso antes, desenfocada */}
        <div className="fl-rsv-card fl-rsv-back">
          <div className="fl-rsv-top">
            <span className="fl-rsv-avatar">CA</span>
            <span className="fl-rsv-org">
              <span className="fl-rsv-name">Consultorio Anchorena</span>
              <span className="fl-rsv-url">folio.ar/r/anchorena</span>
            </span>
          </div>
          <div className="fl-rsv-back-lines">
            <span />
            <span />
          </div>
        </div>

        {/* capa frontal — la página pública en miniatura */}
        <div className="fl-rsv-card fl-rsv-front">
          <header className="fl-rsv-top">
            <span className="fl-rsv-avatar">CA</span>
            <span className="fl-rsv-org">
              <span className="fl-rsv-name">Consultorio Anchorena</span>
              <span className="fl-rsv-url">folio.ar/r/anchorena</span>
            </span>
            <span className="fl-rsv-open">
              <span className="fl-rsv-open-dot" />
              reservas abiertas
            </span>
          </header>

          <div className="fl-rsv-field">
            <span className="fl-rsv-field-label">servicio</span>
            <div className="fl-rsv-services">
              <span className="fl-rsv-service is-on">Kinesiología · consulta</span>
              <span className="fl-rsv-service">RPG · sesión</span>
            </div>
          </div>

          <div className="fl-rsv-field">
            <span className="fl-rsv-field-label">mañana · mié 11 jun</span>
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

          <footer className="fl-rsv-confirm">
            <span className="fl-rsv-confirm-note">a nombre de Belén M.</span>
            <span className="fl-rsv-confirm-btn">Confirmar · mañana 10:00</span>
          </footer>
        </div>

        {/* notificación superpuesta — el WhatsApp ya salió */}
        <div className="fl-rsv-wa">
          <span className="fl-rsv-wa-icon">
            <WhatsApp size={16} />
          </span>
          <span className="fl-rsv-wa-text">
            <span className="fl-rsv-wa-head">
              <b>WhatsApp</b>
              <span className="fl-rsv-wa-time">10:31</span>
            </span>
            Belén, tu turno quedó confirmado: Kinesiología · consulta — mié 11
            jun, 10:00.
            <span className="fl-rsv-wa-meta">✓✓ entregado</span>
          </span>
        </div>
      </div>
    </div>
  );
}
