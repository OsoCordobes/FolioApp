"use client";

/**
 * Folio · sidebar (left rail navigation)
 *
 * Port de folio/sidebar.jsx con cambios mínimos para Next.js:
 *  - Routes nativas (`/hoy`, `/calendario`, ...) en vez de hrefs a HTML estáticos.
 *  - Estado `active` derivado de `usePathname()` (sustituye la prop `active` global).
 *  - Imports de mock-data directos (en F4 vienen de un loader Server Component).
 *
 * Las clases CSS (`fi-sidebar`, `fi-brand`, `fi-nav-item`, etc.) se respetan
 * intactas para garantizar paridad pixel-perfect con el prototipo.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { FolioMark } from "@/components/folio-mark";
import * as I from "@/components/icons";
import { CONSULTORIO, GOOGLE_SYNC } from "@/lib/mock-data";

interface NavItem {
  id: string;
  label: string;
  icon: ReactNode;
  href: string;
  matchPrefixes?: string[]; // rutas adicionales que activan el item (ej. /pacientes/[id])
  badge?: number | null;
}

const NAV_ITEMS: NavItem[] = [
  { id: "hoy",        label: "Hoy",          icon: <I.CalendarDay size={16} />, href: "/hoy" },
  { id: "calendario", label: "Calendario",   icon: <I.Calendar    size={16} />, href: "/calendario" },
  { id: "pacientes",  label: "Pacientes",    icon: <I.Users       size={16} />, href: "/pacientes", matchPrefixes: ["/pacientes/"] },
  { id: "finanzas",   label: "Finanzas",     icon: <I.Wallet      size={16} />, href: "/finanzas" },
  { id: "config",     label: "Configuración",icon: <I.Settings    size={16} />, href: "/configuracion" },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (pathname === item.href) return true;
  return (item.matchPrefixes ?? []).some((p) => pathname.startsWith(p));
}

export function Sidebar() {
  const pathname = usePathname() ?? "/";

  return (
    <aside className="fi-sidebar">
      <div className="fi-brand">
        <FolioMark size={32} />
        <div className="fi-brand-text">
          <b>folio</b>
          <span>
            {CONSULTORIO.profesional} · {CONSULTORIO.rubro}
          </span>
        </div>
      </div>

      <div className="fi-search">
        <span className="fi-search-ico">
          <I.Search size={14} />
        </span>
        <input placeholder="Buscar paciente, turno…" />
        <span className="fi-kbd">⌘K</span>
      </div>

      <nav className="fi-nav">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item);
          return (
            <Link
              key={item.id}
              href={item.href}
              className={"fi-nav-item" + (active ? " is-active" : "")}
              aria-current={active ? "page" : undefined}
            >
              <span className="fi-nav-ico">{item.icon}</span>
              <span className="fi-nav-lbl">{item.label}</span>
              {item.badge ? <span className="fi-nav-badge">{item.badge}</span> : null}
            </Link>
          );
        })}
      </nav>

      <div className="fi-side-bottom">
        <div className="fi-gcal">
          <span className="fi-gcal-ico">
            <I.Google size={14} />
          </span>
          <div className="fi-gcal-text">
            <b>Sincronizado</b>
            <span>con Google · {GOOGLE_SYNC.lastSync}</span>
          </div>
          <span className="fi-gcal-dot" />
        </div>
        <div className="fi-side-links">
          <button className="fi-link" type="button">
            <I.ExternalLink size={13} /> Ver sitio público
          </button>
          <button className="fi-link" type="button">
            <I.Logout size={13} /> Cerrar sesión
          </button>
        </div>
      </div>
    </aside>
  );
}
