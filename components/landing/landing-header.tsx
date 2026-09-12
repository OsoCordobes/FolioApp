import Link from "next/link";
import { FolioMark } from "@/components/folio-mark";
import { LandingNavToggle } from "@/components/landing/landing-nav-toggle";
import { LandingScrollspy } from "@/components/landing/landing-scrollspy";

const NAV_LINKS = [{ href: "#producto", label: "Producto" }, { href: "#dia", label: "Cómo funciona" }, { href: "#precios", label: "Precios" }] as const;

export function LandingHeader() {
  return <header className="fl-header fx-header">
    <a className="fl-skip" href="#contenido">Saltar al contenido</a>
    <div className="fx-header-inner">
      <Link className="fx-brand" href="/" aria-label="Folio — inicio"><FolioMark size={30} /><span>folio<span className="fx-brand-dot">.</span></span></Link>
      <nav className="fx-nav" aria-label="Secciones principales">{NAV_LINKS.map((item) => <a className="fl-nav-link" href={item.href} key={item.href}>{item.label}</a>)}</nav>
      <div className="fx-header-actions"><Link href="/login" className="fx-login-link">Ingresar</Link><Link className="fi-btn fi-btn-primary" href="/onboarding" data-fl-cta="header">Probar Folio</Link></div>
      <LandingNavToggle />
    </div>
    <div id="fl-mobile-nav" className="fl-mobile-panel"><nav className="fl-mobile-nav" aria-label="Secciones principales">{NAV_LINKS.map((item) => <a className="fl-mobile-link" href={item.href} key={item.href}>{item.label}</a>)}</nav><div className="fl-mobile-actions"><Link className="fi-btn fi-btn-secondary" href="/login">Ingresar</Link><Link className="fi-btn fi-btn-primary" href="/onboarding">Probar Folio</Link></div></div>
    <LandingScrollspy />
  </header>;
}

