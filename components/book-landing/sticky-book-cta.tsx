"use client";

/**
 * Folio · StickyBookCta · barra fija inferior (solo mobile) para /book/[slug].
 *
 * Aparece después del hero y se retira mientras el formulario está visible.
 * Es solo navegación:
 * ancla al catálogo o a #reservar, sin tocar el estado del wizard. En desktop nunca se ve
 * (CSS). Respeta reduce-motion (la transición la gatea folio.css).
 */

import { useEffect, useRef, useState } from "react";

export function StickyBookCta({ label, targetId = "reservar" }: { label: string; targetId?: "reservar" | "servicios" }) {
  const [pastHero, setPastHero] = useState(false);
  const [bookingVisible, setBookingVisible] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const shown = pastHero && !bookingVisible;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    // Observar todo el hero también detecta un salto directo al formulario;
    // un sentinel de 1px puede saltarse por completo al navegar por teclado.
    const hero = el.closest(".bl-root")?.querySelector(".bl-hero") ?? el;
    const io = new IntersectionObserver(
      ([entry]) => setPastHero(!entry.isIntersecting && entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? 80)),
      { rootMargin: "-80px 0px 0px 0px" },
    );
    io.observe(hero);
    const booking = document.getElementById(targetId);
    const bookingObserver = new IntersectionObserver(
      ([entry]) => setBookingVisible(entry.isIntersecting),
      { rootMargin: "-64px 0px -80px 0px" },
    );
    if (booking) bookingObserver.observe(booking);
    return () => { io.disconnect(); bookingObserver.disconnect(); };
  }, [targetId]);

  return (
    <>
      <div ref={sentinelRef} aria-hidden className="bl-sticky-sentinel" />
      <div className={`bl-sticky-cta${shown ? " is-shown" : ""}`}>
        <a
          href={`#${targetId}`}
          className="fi-btn fi-btn-primary bl-sticky-btn"
          tabIndex={shown ? 0 : -1}
          aria-hidden={!shown}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
            const heading = document.querySelector<HTMLElement>(targetId === "servicios" ? "#servicios h3" : "#bk-flow h2");
            if (!heading) return;
            event.preventDefault();
            heading.focus({ preventScroll: true });
            document.getElementById(targetId)?.scrollIntoView({
              behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
              block: "start",
            });
          }}
        >
          {label}
        </a>
      </div>
    </>
  );
}
