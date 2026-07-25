/**
 * Folio · shell AUTENTICADO del portal del paciente (F2 · identidad).
 *
 * Route group (tabs): envuelve TODAS las páginas del portal salvo
 * /portal/login (que queda afuera del group y conserva el shell au-* de
 * auth). Chrome persistente:
 *   · header sticky con FolioMark + "Portal del paciente" + botón Salir,
 *   · nav de tabs (Inicio/Turnos/Resumen/Consentimientos/Mis datos).
 *
 * El gating de sesión NO vive acá: lo hace el middleware y cada page hija
 * re-resuelve `getPacienteSession()` como defensa en profundidad. Este layout
 * es chrome puro (el botón Salir usa `signOutPortal`, que cierra sesión y
 * vuelve a /portal/login — no a la landing de profesionales).
 */

import Link from "next/link";

import { signOutPortal } from "@/app/(portal)/portal/actions";
import { FolioMark } from "@/components/folio-mark";

import { PortalNav } from "./portal-nav";

export default function PortalTabsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <header className="pt-shell-header">
        <div className="pt-shell-header-inner">
          <Link href="/portal" className="pt-brand">
            <FolioMark size={24} />
            <span className="pt-brand-text">
              <span className="pt-brand-name">Folio</span>
              <span className="pt-brand-tag">Portal del paciente</span>
            </span>
          </Link>
          <form action={signOutPortal}>
            <button type="submit" className="fi-btn fi-btn-ghost">
              Salir
            </button>
          </form>
        </div>
        <PortalNav />
      </header>
      {children}
    </>
  );
}
