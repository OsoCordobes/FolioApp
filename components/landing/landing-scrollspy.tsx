/**
 * Folio · Landing · LandingScrollspy (client island, render-null)
 *
 * En un scroll de página única, marcar la sección activa separa una landing
 * premium de un folleto. IntersectionObserver mantiene `.is-active` y
 * `aria-current` en los enlaces de escritorio y móvil de la sección visible.
 * La banda se calcula con la altura disponible y se reconstruye al redimensionar.
 *
 * Alinea con el patrón `aria-current` que la app ya usa en su sidebar.
 */

"use client";

import { useEffect } from "react";

/** IDs de sección que el nav referencia, en orden de scroll del DOM. */
const SECTION_IDS = ["producto", "dia", "precios"] as const;

export function LandingScrollspy() {
  useEffect(() => {
    const links = new Map<string, HTMLAnchorElement[]>();
    document.querySelectorAll<HTMLAnchorElement>(".fl-nav-link, .fl-mobile-link").forEach((a) => {
      const href = a.getAttribute("href");
      if (!href?.startsWith("#")) return;
      const id = href.slice(1);
      links.set(id, [...(links.get(id) ?? []), a]);
    });

    const sections = SECTION_IDS.map((id) => document.getElementById(id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (sections.length === 0 || links.size === 0) return;

    let current: string | null = null;
    const setActive = (id: string) => {
      if (id === current) return;
      current = id;
      links.forEach((group, key) => {
        const on = key === id;
        group.forEach((a) => {
          a.classList.toggle("is-active", on);
          if (on) a.setAttribute("aria-current", "location");
          else a.removeAttribute("aria-current");
        });
      });
    };

    let observer: IntersectionObserver | undefined;
    let resizeFrame: number | undefined;
    let disposed = false;
    const connect = () => {
      observer?.disconnect();
      const visible = new Set<Element>();
      const height = window.innerHeight;
      const nextObserver = new IntersectionObserver((entries) => {
        if (disposed || observer !== nextObserver) return;
        // Each batch contains changes, not every currently intersecting section.
        entries.forEach((entry) => {
          if (entry.isIntersecting) visible.add(entry.target);
          else visible.delete(entry.target);
        });
        setActive(sections.find((section) => visible.has(section))?.id ?? "");
      }, {
        rootMargin: `-${Math.floor(height * .45)}px 0px -${Math.floor(height * .5)}px 0px`,
        threshold: 0,
      });
      observer = nextObserver;
      sections.forEach((section) => observer!.observe(section));
    };
    const onResize = () => {
      if (resizeFrame !== undefined) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = undefined;
        connect();
      });
    };
    setActive("");
    connect();
    window.addEventListener("resize", onResize);
    return () => {
      disposed = true;
      window.removeEventListener("resize", onResize);
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      observer?.disconnect();
      setActive("");
    };
  }, []);

  return null;
}
