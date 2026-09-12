"use client";

/**
 * Folio · Portal · nav de tabs persistente (F2 · identidad del portal).
 *
 * Client component mínimo: sólo usePathname para marcar la tab activa con
 * aria-current="page" (el estilo activo lo pinta .pt-tab[aria-current]).
 * Las rutas son las cuatro secciones reales del portal + el inicio.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const TABS: Array<{ href: string; label: string }> = [
  { href: "/portal", label: "Inicio" },
  { href: "/portal/turnos", label: "Turnos" },
  { href: "/portal/resumen", label: "Resumen" },
  { href: "/portal/consentimientos", label: "Consentimientos" },
  { href: "/portal/perfil", label: "Mis datos" },
];

export function PortalNav({ activePath }: { activePath?: string } = {}) {
  const pathname = usePathname();
  const currentPath = activePath ?? pathname;
  const navRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const nav = navRef.current;
    const current = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !current) return;
    const revealCurrent = () => {
      const bounds = nav.getBoundingClientRect();
      const link = current.getBoundingClientRect();
      // Solo desplazar la fila horizontal; la página mantiene su posición.
      if (link.right > bounds.right) nav.scrollLeft += link.right - bounds.right + 12;
      else if (link.left < bounds.left) nav.scrollLeft -= bounds.left - link.left + 12;
    };
    revealCurrent();
    // La fuente local y el ancho de pantalla pueden cambiar después del mount.
    const observer = new ResizeObserver(revealCurrent);
    observer.observe(nav);
    observer.observe(current);
    return () => observer.disconnect();
  }, [currentPath]);

  return (
    <nav ref={navRef} className="pt-tabs" aria-label="Secciones del portal">
      {TABS.map((t) => {
        const active =
          t.href === "/portal" ? currentPath === "/portal" : currentPath.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className="pt-tab"
            aria-current={active ? "page" : undefined}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
