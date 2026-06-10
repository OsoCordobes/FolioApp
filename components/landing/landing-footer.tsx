/**
 * Folio · Landing · LandingFooter (Fase B1 · server component)
 *
 * Footer de marketing: 4 columnas (Producto · Legal · Cuenta · Contacto)
 * sobre --surface con borde superior, y línea final de marca. Las anclas
 * de Producto apuntan a las secciones del landing (#producto, #seguridad,
 * #precios, #faq).
 */

import Link from "next/link";

import { FolioMark } from "@/components/folio-mark";

const COLUMNAS = [
  {
    titulo: "Producto",
    links: [
      { href: "#producto", label: "Producto" },
      { href: "#seguridad", label: "Seguridad" },
      { href: "#precios", label: "Precios" },
      { href: "#faq", label: "Preguntas frecuentes" },
    ],
  },
  {
    titulo: "Legal",
    links: [
      { href: "/privacidad", label: "Privacidad" },
      { href: "/terminos", label: "Términos" },
      { href: "/cookies", label: "Cookies" },
    ],
  },
  {
    titulo: "Cuenta",
    links: [
      { href: "/login", label: "Ingresar" },
      { href: "/onboarding", label: "Crear cuenta" },
    ],
  },
  {
    titulo: "Contacto",
    links: [{ href: "mailto:soporte@folio.app", label: "soporte@folio.app" }],
  },
] as const;

export function LandingFooter() {
  return (
    <footer className="fl-footer">
      <div className="fl-footer-inner">
        {COLUMNAS.map((col) => (
          <nav key={col.titulo} className="fl-footer-col" aria-label={col.titulo}>
            <h3 className="fl-footer-heading">{col.titulo}</h3>
            <ul className="fl-footer-list">
              {col.links.map((link) => (
                <li key={link.href}>
                  {link.href.startsWith("/") ? (
                    <Link className="fl-footer-link" href={link.href}>
                      {link.label}
                    </Link>
                  ) : (
                    /* anclas (#…) y mailto: quedan como <a> nativo */
                    <a className="fl-footer-link" href={link.href}>
                      {link.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="fl-footer-base">
        <FolioMark size={18} />
        <span>Folio · Hecho para profesionales de la salud en Argentina · © 2026</span>
      </div>
    </footer>
  );
}
