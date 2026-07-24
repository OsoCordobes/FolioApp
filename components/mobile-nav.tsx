"use client";

/**
 * Folio · MobileNav · bottom-nav del shell autenticado en ≤920px (C1).
 *
 * Hasta este PR la app no tenía NINGÚN layout mobile: la sidebar fija de
 * 248px hacía /hoy, /calendario y /pacientes inusables en un teléfono — el
 * caso "médico entre consultas" del pitch. Bajo el breakpoint (folio.css,
 * sección C1+C4 al final) la sidebar se oculta y aparece esta bottom-nav
 * fija con los items principales de navegación + un sheet "Más" para el
 * resto (búsqueda, switchers de org/especialidad, Configuración, sitio
 * público, logout).
 *
 * Decisiones:
 *  - Los items espejan NAV_ITEMS del Sidebar (mismos hrefs, mismos íconos de
 *    components/icons, labels cortos). Finanzas respeta el mismo gating por
 *    capability (capabilitiesFor). Configuración vive en el sheet "Más".
 *  - aria-current="page" en el item activo (misma lógica isActive del
 *    Sidebar, prefijos incluidos).
 *  - El sheet es un dialog real: useModalA11y (focus trap + Escape + restore)
 *    y cierre por backdrop. Navegar cierra el sheet (efecto sobre pathname).
 *  - En desktop el <nav> existe pero está display:none por CSS — cero costo
 *    visual y ningún branch de media query en JS.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { EspecialidadSwitcher } from "@/components/especialidad-switcher";
import * as I from "@/components/icons";
import { OrgSwitcher, type OrgSwitcherOption } from "@/components/org-switcher";
import { capabilitiesFor, type Capabilities, type Role } from "@/lib/auth/capabilities";
import type { EspecialidadSlug } from "@/lib/especialidades/meta";
import { useModalA11y } from "@/lib/use-modal-a11y";

interface MobileNavItem {
  id: string;
  /** Label corto — abajo de un ícono de 20px no entra "Configuración". */
  label: string;
  icon: ReactNode;
  href: string;
  matchPrefixes?: string[];
  requires?: (caps: Capabilities) => boolean;
}

/** Espejo de NAV_ITEMS del Sidebar; Configuración se mueve al sheet "Más". */
const MOBILE_NAV_ITEMS: MobileNavItem[] = [
  { id: "hoy",        label: "Hoy",      icon: <I.CalendarDay size={20} />, href: "/hoy" },
  { id: "calendario", label: "Agenda",   icon: <I.Calendar    size={20} />, href: "/calendario" },
  { id: "pacientes",  label: "Pacientes",icon: <I.Users       size={20} />, href: "/pacientes", matchPrefixes: ["/pacientes/"] },
  { id: "finanzas",   label: "Finanzas", icon: <I.Wallet      size={20} />, href: "/finanzas", requires: (c) => c.canSeeFinanzas },
];

function isActive(pathname: string, item: MobileNavItem): boolean {
  if (pathname === item.href) return true;
  return (item.matchPrefixes ?? []).some((p) => pathname.startsWith(p));
}

export interface MobileNavProps {
  organization: {
    nombre: string;
    slug?: string;
    isInternalAccount?: boolean;
  };
  role: Role;
  esColegiado?: boolean;
  /** M50 · especialidad real de la org (selector de cuentas internas). */
  especialidad?: EspecialidadSlug;
  especialidadOverride?: EspecialidadSlug | null;
  memberships?: OrgSwitcherOption[];
  activeOrgId?: string;
}

export function MobileNav({
  organization,
  role,
  esColegiado = false,
  especialidad,
  especialidadOverride,
  memberships,
  activeOrgId,
}: MobileNavProps) {
  const caps = capabilitiesFor(role, esColegiado);
  const items = MOBILE_NAV_ITEMS.filter((item) => !item.requires || item.requires(caps));
  const pathname = usePathname() ?? "/";
  const [sheetOpen, setSheetOpen] = useState(false);

  // Navegar (desde el sheet o desde cualquier lado) cierra el sheet: el
  // pathname nuevo es la señal más confiable — cubre Links, back button, etc.
  useEffect(() => {
    setSheetOpen(false);
  }, [pathname]);

  const masActivo = pathname.startsWith("/configuracion");

  return (
    <>
      <nav className="fi-mnav" aria-label="Navegación principal">
        {items.map((item) => {
          const active = isActive(pathname, item);
          return (
            <Link
              key={item.id}
              href={item.href}
              className={"fi-mnav-item" + (active ? " is-active" : "")}
              aria-current={active ? "page" : undefined}
            >
              <span className="fi-mnav-ico" aria-hidden>{item.icon}</span>
              <span className="fi-mnav-lbl">{item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          className={"fi-mnav-item" + (masActivo && !sheetOpen ? " is-active" : "")}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          aria-current={masActivo ? "page" : undefined}
          onClick={() => setSheetOpen((v) => !v)}
        >
          <span className="fi-mnav-ico" aria-hidden><I.More size={20} /></span>
          <span className="fi-mnav-lbl">Más</span>
        </button>
      </nav>

      {sheetOpen ? (
        <MobileMoreSheet
          organization={organization}
          especialidad={especialidad}
          especialidadOverride={especialidadOverride}
          memberships={memberships}
          activeOrgId={activeOrgId}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </>
  );
}

// ─── Sheet "Más" ────────────────────────────────────────────────────────────

interface MobileMoreSheetProps {
  organization: MobileNavProps["organization"];
  especialidad?: EspecialidadSlug;
  especialidadOverride?: EspecialidadSlug | null;
  memberships?: OrgSwitcherOption[];
  activeOrgId?: string;
  onClose: () => void;
}

function MobileMoreSheet({
  organization,
  especialidad,
  especialidadOverride,
  memberships,
  activeOrgId,
  onClose,
}: MobileMoreSheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  useModalA11y(sheetRef, { onClose });

  const publicHref = organization.slug ? `/book/${organization.slug}` : null;

  return (
    <div className="fi-mnav-sheet-backdrop" onClick={onClose}>
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Más opciones"
        tabIndex={-1}
        className="fi-mnav-sheet a11y-modal-root"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fi-mnav-sheet-grip" aria-hidden />

        {/* Búsqueda: mismo destino que el buscador del sidebar (/pacientes?q=). */}
        <form className="fi-search fi-mnav-search" action="/pacientes" method="GET">
          <span className="fi-search-ico" aria-hidden>
            <I.Search size={14} />
          </span>
          <input name="q" placeholder="Buscar paciente, turno…" aria-label="Buscar paciente" />
        </form>

        {/* Switchers contextuales — mismos componentes que el sidebar. El
            OrgSwitcher ya se auto-oculta con <2 membresías. */}
        {memberships && activeOrgId ? (
          <OrgSwitcher orgs={memberships} activeOrgId={activeOrgId} />
        ) : null}
        {organization.isInternalAccount && especialidad ? (
          <EspecialidadSwitcher
            key={activeOrgId ?? organization.nombre}
            current={especialidadOverride ?? especialidad}
            orgEspecialidad={especialidad}
          />
        ) : null}

        <div className="fi-mnav-sheet-links">
          <Link href="/configuracion" className="fi-mnav-sheet-link" onClick={onClose}>
            <I.Settings size={16} /> Configuración
          </Link>
          {publicHref ? (
            <a
              className="fi-mnav-sheet-link"
              href={publicHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
            >
              <I.ExternalLink size={16} /> Ver sitio público
            </a>
          ) : null}
          <form method="POST" action="/api/auth/signout" style={{ display: "contents" }}>
            <button className="fi-mnav-sheet-link" type="submit">
              <I.Logout size={16} /> Cerrar sesión
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
