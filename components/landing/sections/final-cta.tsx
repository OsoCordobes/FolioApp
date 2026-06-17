/**
 * Folio · Landing · FinalCta (Fase B1 · server component)
 *
 * Cierre del landing: panel DARK (mismo truco de tokens que .fl-vault) que
 * hace bookend con la bóveda — el día abre en crema y cierra de noche, con
 * el último empujón a /onboarding. En mobile el padding inferior extra evita
 * que el CookieBanner fixed-bottom tape los CTAs (ver .fl-cta-final en el CSS).
 * Mantiene el id/ancla `cta-final` del esqueleto de Fase A.
 */

import Link from "next/link";

export function FinalCta() {
  return (
    <section id="cta-final" data-fl-section="cta-final" className="fl-section fl-cta-final">
      <div className="fl-cta-panel fl-reveal">
        <p className="fl-cta-eyebrow">Mañana · 08:00</p>
        <h2 className="fl-cta-title">Tu agenda ya está armada.</h2>
        <p className="fl-cta-sub">
          Diez minutos hoy, y mañana ya te espera armada.
        </p>
        <div className="fl-cta-actions">
          <Link className="fi-btn fi-btn-primary fl-btn-lg" href="/onboarding" data-fl-cta="final">
            Empezá gratis · 7 días
          </Link>
          <Link className="fi-btn fi-btn-secondary fl-btn-lg" href="/login">
            Ingresar
          </Link>
        </div>
      </div>
    </section>
  );
}
