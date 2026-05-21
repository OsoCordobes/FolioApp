"use client";

import { useEffect, useState } from "react";

/**
 * Folio · <StickyMiniHeader>
 *
 * Mobile-only fixed top bar that emerges when the public-card hero on
 * /book/[slug] scrolls past the viewport top. Uses IntersectionObserver
 * on a 1×1 px sentinel rendered above the PublicCard.
 *
 * Motion: fpc-sticky-mini-emerge beat (opacity 0→1 + translateY -8→0,
 * 320 ms --ease-emphasized-out). Reduce-motion strips the translate;
 * opacity transition retained for state legibility.
 *
 * Hidden on viewports ≥ 768 px (full hero stays visible at desktop sizes).
 */

export interface StickyMiniHeaderProps {
  sentinelRef: React.RefObject<HTMLDivElement | null>;
  name: string;
  logoUrl?: string | null;
  initials: string;
  accentHex: string;
  onReserveClick: () => void;
}

export function StickyMiniHeader({
  sentinelRef,
  name,
  logoUrl,
  initials,
  accentHex,
  onReserveClick,
}: StickyMiniHeaderProps) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => {
        // Show the mini only when the sentinel has scrolled ABOVE the top
        // edge (rect.top < 0) — not when it sits below the viewport at
        // initial paint (rect.top > viewport.height). The unaugmented
        // `isIntersecting` flag fires false on both sides; the rect check
        // disambiguates.
        const rect = entry.boundingClientRect;
        setShown(!entry.isIntersecting && rect.top < 0);
      },
      { rootMargin: "-56px 0px 0px 0px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [sentinelRef]);

  return (
    <div
      className={`bk-mini ${shown ? "is-shown" : ""}`.trim()}
      aria-hidden={!shown}
    >
      <span className="bk-mini-avatar" aria-hidden style={{ background: accentHex }}>
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" width={28} height={28} />
        ) : (
          <span>{initials}</span>
        )}
      </span>
      <span className="bk-mini-name">{name}</span>
      <button
        type="button"
        className="bk-mini-cta"
        onClick={onReserveClick}
        style={{ background: accentHex }}
      >
        Reservar
      </button>
    </div>
  );
}
