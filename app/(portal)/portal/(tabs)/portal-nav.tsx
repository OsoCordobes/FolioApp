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

const TABS: Array<{ href: string; label: string }> = [
  { href: "/portal", label: "Inicio" },
  { href: "/portal/turnos", label: "Turnos" },
  { href: "/portal/resumen", label: "Resumen" },
  { href: "/portal/consentimientos", label: "Consentimientos" },
  { href: "/portal/perfil", label: "Mis datos" },
];

export function PortalNav() {
  const pathname = usePathname();
  return (
    <nav className="pt-tabs" aria-label="Secciones del portal">
      {TABS.map((t) => {
        const active =
          t.href === "/portal" ? pathname === "/portal" : pathname.startsWith(t.href);
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
