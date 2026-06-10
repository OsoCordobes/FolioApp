"use client";

/**
 * Folio · Landing — sección Showcase (#showcase) (Fase B · B3).
 *
 * Wrapper LIVIANO del showcase. Este archivo no importa framer-motion ni los
 * slides au2: el carousel pesado (product-showcase-carousel.tsx) entra al
 * bundle como chunk separado vía next/dynamic({ ssr: false }) y se monta
 * recién cuando la sección se acerca al viewport (IntersectionObserver con
 * rootMargin generoso) — framer-motion nunca compite con el LCP del hero.
 *
 * CLS ~0: mientras el carousel no montó (y mientras carga el chunk) se
 * renderiza <ShowcaseSkeleton />, que usa exactamente las mismas clases
 * (.fl-showcase-stage con altura fija por CSS + .fl-showcase-tabs con los
 * mismos labels/captions de showcase-views.ts) → el swap no mueve un píxel.
 */

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import { SHOWCASE_VIEWS } from "./showcase-views";

/** Margen para pre-montar el carousel antes de que el user llegue scrolleando. */
const PREMOUNT_ROOT_MARGIN = "600px 0px";

function ShowcaseSkeleton() {
  // Placeholder decorativo con la MISMA geometría que el carousel real.
  // aria-hidden: no hay contenido útil todavía (y los "tabs" son divs inertes).
  return (
    <div className="fl-showcase" aria-hidden="true">
      <div className="fl-showcase-stage" data-view="agenda">
        <div className="fl-showcase-bg">
          <div className="fl-showcase-grid" />
          <div className="fl-showcase-glow" />
        </div>
      </div>
      <div className="fl-showcase-tabs">
        {SHOWCASE_VIEWS.map((v, i) => (
          <div
            key={v.id}
            className={"fl-showcase-tab" + (i === 0 ? " is-active" : "")}
          >
            <span className="fl-showcase-tab-label">{v.tab}</span>
            <span className="fl-showcase-tab-caption">{v.caption}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const ProductShowcaseCarousel = dynamic(
  () => import("./product-showcase-carousel"),
  {
    ssr: false,
    // Mientras baja el chunk, misma geometría → cero shift.
    loading: () => <ShowcaseSkeleton />,
  },
);

export function ProductShowcase() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    if (near) return;
    const el = hostRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      // Fallback sin IO (browsers viejos / entornos raros): montar directo.
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: PREMOUNT_ROOT_MARGIN },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  return (
    <section id="showcase" className="fl-section fl-showcase-section" data-fl-section="showcase">
      <h2 className="fl-showcase-title fl-reveal">Así se siente un día con Folio</h2>
      <p className="fl-showcase-sub fl-reveal">
        Tres momentos reales de tu jornada — la agenda lista a la mañana, el
        consultorio trabajando solo mientras atendés y el cierre del mes sin planillas.
      </p>
      <div ref={hostRef} className="fl-showcase-host">
        {near ? <ProductShowcaseCarousel /> : <ShowcaseSkeleton />}
      </div>
    </section>
  );
}
