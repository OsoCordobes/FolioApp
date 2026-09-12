import Link from "next/link";
import { FolioMark } from "@/components/folio-mark";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/support";

export function LandingFooter() {
  return <footer className="fx-footer"><div className="fx-footer-main"><div><Link className="fx-brand" href="/" aria-label="Folio — inicio"><FolioMark size={28} /><span>folio.</span></Link><p>El cuidado de tu práctica.<br />Hecho para profesionales de la salud en Argentina.</p></div><nav aria-label="Producto"><h3>Folio</h3><a href="#producto">Conocer el producto</a><a href="#precios">Planes y precios</a><Link href="/login">Ingresar al consultorio</Link><Link href="/portal/login">Portal del paciente</Link></nav><nav aria-label="Ayuda"><h3>Estamos cerca</h3><a href="#faq">Preguntas frecuentes</a><a href={supportMailto()}>{SUPPORT_EMAIL}</a><Link href="/profesionales">Buscar profesionales</Link></nav></div><div className="fx-footer-base"><span>© 2026 Folio</span><nav aria-label="Información legal"><Link href="/privacidad">Privacidad</Link><Link href="/terminos">Términos</Link><Link href="/cookies">Cookies</Link></nav></div></footer>;
}

