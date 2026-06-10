/**
 * Folio · Landing — sección FAQ (#faq) (Fase B · B2).
 *
 * Server component, cero JS de cliente: <details>/<summary> nativos con
 * marker custom (chevron que rota vía CSS). Cada <details> lleva
 * data-fl-faq={index} para analytics por delegación de eventos.
 * Datos en components/landing/faq-data.ts (compartidos con el JSON-LD, Fase C).
 */

import type { CSSProperties } from "react";
import { ChevronDown } from "@/components/icons";
import { FAQ_ITEMS } from "../faq-data";

function revealDelay(index: number): CSSProperties {
  return { "--fl-reveal-delay": `${index * 50}ms` } as CSSProperties;
}

export function Faq() {
  return (
    <section id="faq" className="fl-section fl-faq" data-fl-section="faq">
      <h2 className="fl-faq-title fl-reveal">Preguntas frecuentes</h2>
      <div className="fl-faq-list">
        {FAQ_ITEMS.map((item, i) => (
          <details
            key={item.q}
            className="fl-faq-item fl-reveal"
            data-fl-faq={i}
            style={revealDelay(i)}
          >
            <summary className="fl-faq-q">
              <span className="fl-faq-q-text">{item.q}</span>
              <span className="fl-faq-chevron" aria-hidden="true">
                <ChevronDown size={18} />
              </span>
            </summary>
            <p className="fl-faq-a">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
