/**
 * Folio · Landing — sección Testimonios (social proof honesta).
 *
 * Cards quote/nombre/especialidad/localidad sobre ../testimonials-data.ts.
 * Se renderiza SOLO si hay testimonios cargados: con el array vacío devuelve
 * null y la landing no muestra ni sección ni placeholder — la prueba social
 * llega cuando existan quotes reales con permiso escrito, nunca antes.
 * Server component, cero JS. Clases .fl-testi-* al final de public/folio.css.
 */

import { TESTIMONIAL_ITEMS } from "../testimonials-data";
import { revealRange } from "../reveal";

export function Testimonials() {
  if (TESTIMONIAL_ITEMS.length === 0) return null;

  return (
    <section
      className="fl-section fl-testi"
      data-fl-section="testimonials"
      aria-labelledby="fl-testi-title"
    >
      <h2 id="fl-testi-title" className="fl-testi-title fl-reveal">
        Profesionales que ya arman su día con Folio.
      </h2>
      <div className="fl-testi-grid">
        {TESTIMONIAL_ITEMS.map((t, i) => (
          <figure key={`${t.nombre}-${t.localidad}`} className="fl-testi-card fl-reveal" style={revealRange(i)}>
            <blockquote className="fl-testi-quote">
              <p>“{t.quote}”</p>
            </blockquote>
            <figcaption className="fl-testi-who">
              <span className="fl-testi-name">{t.nombre}</span>
              <span className="fl-testi-meta">
                {t.especialidad} · {t.localidad}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
