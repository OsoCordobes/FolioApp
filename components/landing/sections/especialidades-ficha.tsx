/**
 * Folio · Landing — sección "Ficha clínica por especialidad".
 *
 * El diferenciador contra el software genérico de agenda: cada especialidad
 * trae SU herramienta clínica real (instrumentos, escalas y guías de
 * lib/especialidades/*), no una ficha genérica. Va después de la ficha mock
 * (#ficha) — primero "así se ve adentro", después "y esto trae la tuya".
 * Server component, cero JS; data en ../especialidades-ficha-data.ts.
 * Clases .fl-esp-* al final de public/folio.css.
 */

import { ESPECIALIDADES_FICHA } from "../especialidades-ficha-data";
import { revealRange } from "../reveal";

export function EspecialidadesFicha() {
  return (
    <section
      className="fl-section fl-esp"
      data-fl-section="especialidades-ficha"
      aria-labelledby="fl-esp-title"
    >
      <h2 id="fl-esp-title" className="fl-esp-title fl-reveal">
        Nada de fichas genéricas.
      </h2>
      <p className="fl-esp-lead fl-reveal">
        Cada especialidad trae sus instrumentos, escalas y guías listos para usar
        desde la primera sesión.
      </p>
      <div className="fl-esp-grid">
        {ESPECIALIDADES_FICHA.map((esp, i) => (
          <article key={esp.nombre} className="fl-esp-card fl-reveal" style={revealRange(i)}>
            <h3 className="fl-esp-name">{esp.nombre}</h3>
            <p className="fl-esp-desc">{esp.desc}</p>
            <ul className="fl-esp-tools" aria-label={`Instrumentos de ${esp.nombre}`}>
              {esp.instrumentos.map((tool) => (
                <li key={tool} className="fl-esp-tool">
                  {tool}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
