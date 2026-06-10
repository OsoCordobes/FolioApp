/**
 * Folio · Landing · LandingHeader (Fase B1 · server component)
 *
 * Header sticky con efecto glass (color-mix sobre --bg + backdrop blur).
 * Izquierda: marca. Centro: anclas (#producto, #seguridad, #precios, #faq).
 * Derecha: Ingresar (ghost) + CTA primario. En mobile la navegación colapsa
 * en un panel (#fl-mobile-nav) accionado por <LandingNavToggle/> — único
 * client component del shell.
 */

import Link from "next/link";

import { FolioMark } from "@/components/folio-mark";
import { LandingNavToggle } from "@/components/landing/landing-nav-toggle";

const NAV_LINKS = [
  { href: "#producto", label: "Producto" },
  { href: "#seguridad", label: "Seguridad" },
  { href: "#precios", label: "Precios" },
  { href: "#faq", label: "FAQ" },
] as const;

export function LandingHeader() {
  return (
    <header className="fl-header">
      <a className="fl-skip" href="#contenido">
        Saltar al contenido
      </a>

      <div className="fl-header-inner">
        <Link className="fl-brand" href="/" aria-label="Folio — inicio">
          <FolioMark size={26} />
          <span className="fl-wordmark">Folio</span>
        </Link>

        <nav className="fl-nav" aria-label="Secciones principales">
          {NAV_LINKS.map((link) => (
            <a key={link.href} className="fl-nav-link" href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>

        <div className="fl-header-actions">
          <Link className="fi-btn fi-btn-ghost" href="/login">
            Ingresar
          </Link>
          <Link className="fi-btn fi-btn-primary" href="/onboarding" data-fl-cta="header">
            Empezar gratis
          </Link>
        </div>

        <LandingNavToggle targetId="fl-mobile-nav" />
      </div>

      {/* Panel mobile — colapsado por defecto; LandingNavToggle togglea .is-open */}
      <div id="fl-mobile-nav" className="fl-mobile-panel">
        <nav className="fl-mobile-nav" aria-label="Secciones principales">
          {NAV_LINKS.map((link) => (
            <a key={link.href} className="fl-mobile-link" href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
        <div className="fl-mobile-actions">
          <Link className="fi-btn fi-btn-secondary fl-btn-lg" href="/login">
            Ingresar
          </Link>
          <Link className="fi-btn fi-btn-primary fl-btn-lg" href="/onboarding" data-fl-cta="header">
            Empezar gratis
          </Link>
        </div>
      </div>
    </header>
  );
}
