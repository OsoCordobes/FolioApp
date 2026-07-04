/**
 * Folio · Landing · LandingScrollspy (client island, render-null)
 *
 * En un scroll de página única, marcar la sección activa separa una landing
 * premium de un folleto. IntersectionObserver post-LCP (~0.6 KB) que togglea
 * `.is-active` + `aria-current` en el `.fl-nav-link` cuyo href apunta a la
 * sección visible — reusa la geometría ::after del subrayado de hover (el
 * estilo `.fl-nav-link.is-active` vive en folio.css). Sin dependencias.
 *
 * Alinea con el patrón `aria-current` que la app ya usa en su sidebar.
 */

"use client";

import { useEffect } from "react";

/** IDs de sección que el nav referencia, en orden de scroll del DOM. */
const SECTION_IDS = ["dia", "seguridad", "producto", "precios", "faq"] as const;

export function LandingScrollspy() {
  useEffect(() => {
    const links = new Map<string, HTMLAnchorElement>();
    document.querySelectorAll<HTMLAnchorElement>(".fl-nav-link").forEach((a) => {
      const id = a.getAttribute("href")?.replace(/^#/, "");
      if (id) links.set(id, a);
    });

    const sections = SECTION_IDS.map((id) => document.getElementById(id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (sections.length === 0 || links.size === 0) return;

    let current = "";
    const setActive = (id: string) => {
      if (id === current) return;
      current = id;
      links.forEach((a, key) => {
        const on = key === id;
        a.classList.toggle("is-active", on);
        if (on) a.setAttribute("aria-current", "true");
        else a.removeAttribute("aria-current");
      });
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive((visible[0].target as HTMLElement).id);
      },
      // Banda angosta centrada en el viewport: la sección que cruza el medio gana.
      { rootMargin: "-45% 0px -50% 0px", threshold: 0 },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  return null;
}
