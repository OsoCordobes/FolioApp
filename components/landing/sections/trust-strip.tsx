/**
 * Folio · Landing · TrustStrip (Fase B1 · server component)
 *
 * Franja de confianza honesta (sin testimonios inventados ni logos falsos):
 * especialidades reales que cubre el producto + 3 badges verificables
 * (cifrado AES-256, Ley 25.326 de Protección de Datos Personales, hecho
 * en Argentina). El Sol para "Hecho en Argentina" guiña al Sol de Mayo.
 */

import { Check, Lock, Sun } from "@/components/icons";

const ESPECIALIDADES = [
  "Quiropraxia",
  "Kinesiología",
  "Psicología",
  "Cardiología",
  "Nutrición",
  "Fonoaudiología",
] as const;

export function TrustStrip() {
  return (
    <section data-fl-section="trust" className="fl-section fl-trust">
      <div className="fl-trust-inner fl-reveal">
        <h2 className="fl-trust-label">Pensado para la consulta real</h2>
        <ul className="fl-trust-specialties" aria-label="Especialidades para las que está pensado Folio">
          {ESPECIALIDADES.map((esp) => (
            <li key={esp} className="fl-trust-specialty">
              {esp}
            </li>
          ))}
        </ul>
        <ul className="fl-trust-badges" aria-label="Compromisos de Folio">
          <li className="fl-trust-badge">
            <Lock size={14} aria-hidden />
            Cifrado AES-256
          </li>
          <li className="fl-trust-badge">
            <Check size={14} aria-hidden />
            Ley 25.326
          </li>
          <li className="fl-trust-badge">
            <Sun size={14} aria-hidden />
            Hecho en Argentina
          </li>
        </ul>
      </div>
    </section>
  );
}
