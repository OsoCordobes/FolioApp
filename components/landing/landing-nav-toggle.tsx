"use client";

/**
 * Folio · Landing · LandingNavToggle (Fase B1)
 *
 * Único client component del shell del landing: botón hamburguesa accesible
 * que abre/cierra el panel de navegación mobile (#fl-mobile-nav, renderizado
 * server-side en LandingHeader). Togglea la clase `is-open` en el panel,
 * cierra con Escape (devolviendo el foco al botón) y al clickear un link.
 * Sin dependencias nuevas.
 */

import { useEffect, useRef, useState } from "react";

interface LandingNavToggleProps {
  /** id del panel mobile que controla (default: "fl-mobile-nav") */
  targetId?: string;
}

export function LandingNavToggle({ targetId = "fl-mobile-nav" }: LandingNavToggleProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const panel = document.getElementById(targetId);
    if (!panel) return;

    panel.classList.toggle("is-open", open);
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      btnRef.current?.focus();
    };
    // Cierre al navegar: cualquier click sobre un <a> del panel colapsa el menú.
    const onPanelClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("a")) setOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    panel.addEventListener("click", onPanelClick);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      panel.removeEventListener("click", onPanelClick);
    };
  }, [open, targetId]);

  return (
    <button
      ref={btnRef}
      type="button"
      className={"fl-nav-toggle" + (open ? " is-open" : "")}
      aria-expanded={open}
      aria-controls={targetId}
      aria-label={open ? "Cerrar menú de navegación" : "Abrir menú de navegación"}
      onClick={() => setOpen((v) => !v)}
    >
      <span className="fl-nav-toggle-bar" aria-hidden />
      <span className="fl-nav-toggle-bar" aria-hidden />
      <span className="fl-nav-toggle-bar" aria-hidden />
    </button>
  );
}
