"use client";

/**
 * Folio · sidebar (left rail navigation)
 *
 * Port de folio/sidebar.jsx con cambios mínimos para Next.js:
 *  - Routes nativas (`/hoy`, `/calendario`, ...) en vez de hrefs a HTML estáticos.
 *  - Estado `active` derivado de `usePathname()` (sustituye la prop `active` global).
 *  - Datos del consultorio y Google Sync vienen como props desde el Server Component
 *    layout (`app/(app)/layout.tsx`), NO desde mock-data.
 *
 * Las clases CSS (`fi-sidebar`, `fi-brand`, `fi-nav-item`, etc.) se respetan
 * intactas para garantizar paridad pixel-perfect con el prototipo.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { FolioMark } from "@/components/folio-mark";
import * as I from "@/components/icons";
import { formatRubro, formatProfesionalDisplay } from "@/lib/format/identity";

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

export type GoogleSyncStatus =
  | { connected: false }
  | { connected: true; lastSyncLabel: string; healthy: boolean };

export interface SidebarProps {
  /** Datos del consultorio (org). */
  organization: { nombre: string; rubro: string | null; slug?: string };
  /** Datos del profesional logueado (PII ya desencriptada en server). */
  profile: { nombre: string | null; apellido: string | null };
  /** Rol del member en esta org. */
  role: "OWNER" | "DIRECTOR" | "PROFESIONAL" | "COORDINADOR" | "ASISTENTE";
  /** Estado de Google Calendar sync. */
  googleSync?: GoogleSyncStatus;
}

export function Sidebar({ organization, profile, role, googleSync }: SidebarProps) {
  void role; // gating por rol entra en S2; por ahora todos los items visibles para todos los roles
  const pathname = usePathname() ?? "/";
  const profesionalLine = formatProfesionalDisplay(profile, organization);
  const rubroLabel = formatRubro(organization.rubro);
  const publicHref = organization.slug ? `/book/${organization.slug}` : "/";

  return (
    <aside className="fi-sidebar">
      <div className="fi-brand">
        <FolioMark size={32} />
        <div className="fi-brand-text">
          <b>folio</b>
          <span>
            {profesionalLine}{rubroLabel ? ` · ${rubroLabel}` : ""}
          </span>
        </div>
      </div>

      <SidebarSearch />

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
        <GoogleSyncBadge status={googleSync} />
        <div className="fi-side-links">
          {organization.slug ? (
            <a
              className="fi-link"
              href={publicHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              <I.ExternalLink size={13} /> Ver sitio público
            </a>
          ) : (
            <span className="fi-link" style={{ opacity: 0.5, cursor: "not-allowed" }} title="Sin slug configurado">
              <I.ExternalLink size={13} /> Ver sitio público
            </span>
          )}
          <form method="POST" action="/api/auth/signout" style={{ display: "contents" }}>
            <button className="fi-link" type="submit">
              <I.Logout size={13} /> Cerrar sesión
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}

/**
 * Buscador del sidebar (⌘K). Para MVP redirige a /pacientes con query
 * preescrita en `?q=`. F11 polish: dialog modal con búsqueda fuzzy en
 * pacientes + turnos + pedidos sin navegar.
 */
function SidebarSearch() {
  return (
    <form className="fi-search" action="/pacientes" method="GET">
      <span className="fi-search-ico">
        <I.Search size={14} />
      </span>
      <input name="q" placeholder="Buscar paciente…" aria-label="Buscar paciente" />
      <span className="fi-kbd">⌘K</span>
    </form>
  );
}

function GoogleSyncBadge({ status }: { status?: GoogleSyncStatus }) {
  // Estado no determinado todavía (loading inicial) → preserva el layout.
  if (!status) {
    return (
      <div className="fi-gcal">
        <span className="fi-gcal-ico">
          <I.Google size={14} />
        </span>
        <div className="fi-gcal-text">
          <b>Google Calendar</b>
          <span>Verificando…</span>
        </div>
      </div>
    );
  }

  if (!status.connected) {
    return (
      <Link href="/configuracion#integraciones" className="fi-gcal" style={{ textDecoration: "none", color: "inherit" }}>
        <span className="fi-gcal-ico">
          <I.Google size={14} />
        </span>
        <div className="fi-gcal-text">
          <b>Google Calendar</b>
          <span>No conectado · ir a Configuración</span>
        </div>
      </Link>
    );
  }

  return (
    <Link href="/configuracion#integraciones" className="fi-gcal" style={{ textDecoration: "none", color: "inherit" }}>
      <span className="fi-gcal-ico">
        <I.Google size={14} />
      </span>
      <div className="fi-gcal-text">
        <b>{status.healthy ? "Sincronizado" : "Reconectar"}</b>
        <span>con Google · {status.lastSyncLabel}</span>
      </div>
      <span className="fi-gcal-dot" />
    </Link>
  );
}
