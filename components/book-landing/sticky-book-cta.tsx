"use client";

/**
 * Folio · StickyBookCta · barra fija inferior (solo mobile) para /book/[slug].
 *
 * Aparece cuando el hero sale de vista (IntersectionObserver sobre un sentinel
 * en flujo, mismo patrón que el viejo StickyMiniHeader). Es solo navegación:
 * ancla a #reservar, sin tocar el estado del wizard. En desktop nunca se ve
 * (CSS). Respeta reduce-motion (la transición la gatea folio.css).
 */

import { useEffect, useRef, useState } from "react";

export function StickyBookCta({ label }: { label: string }) {
  const [shown, setShown] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setShown(!entry.isIntersecting),
      { rootMargin: "-80px 0px 0px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinelRef} aria-hidden className="bl-sticky-sentinel" />
      <div className={`bl-sticky-cta${shown ? " is-shown" : ""}`}>
        <a
          href="#reservar"
          className="fi-btn fi-btn-primary bl-sticky-btn"
          tabIndex={shown ? 0 : -1}
          aria-hidden={!shown}
        >
          {label}
        </a>
      </div>
    </>
  );
}
