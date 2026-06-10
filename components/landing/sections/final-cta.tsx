/**
 * Folio · Landing · FinalCta (Fase B1 · server component)
 *
 * Cierre del landing: panel destacado sobre --accent-soft con el último
 * empujón a /onboarding. En mobile el padding inferior extra evita que el
 * CookieBanner fixed-bottom tape los CTAs (ver .fl-cta-final en el CSS).
 * Mantiene el id/ancla `cta-final` del esqueleto de Fase A.
 */

import Link from "next/link";

export function FinalCta() {
  return (
    <section id="cta-final" data-fl-section="cta-final" className="fl-section fl-cta-final">
      <div className="fl-cta-panel fl-reveal">
        <h2 className="fl-cta-title">Tu próximo turno podría estar agendándose solo, ahora.</h2>
        <p className="fl-cta-sub">
          Activá tu agenda en minutos. Sin tarjeta de crédito, sin permanencia.
        </p>
        <div className="fl-cta-actions">
          <Link className="fi-btn fi-btn-primary fl-btn-lg" href="/onboarding" data-fl-cta="final">
            Empezá gratis · 7 días sin tarjeta
          </Link>
          <Link className="fi-btn fi-btn-secondary fl-btn-lg" href="/login">
            Ingresar
          </Link>
        </div>
      </div>
    </section>
  );
}
