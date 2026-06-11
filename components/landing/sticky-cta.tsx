"use client";

/**
 * Folio · Landing · StickyCta — barra CTA fija inferior, SOLO mobile (<768px).
 *
 * Client island mínimo (~1 KB). Se eligió IntersectionObserver por sobre la
 * variante CSS pura (animation-timeline: scroll()/view()) por dos motivos:
 *   1. La visibilidad combina DOS condiciones (pasó el hero Y el #cta-final
 *      no está en viewport): en CSS puro eso exige `view-timeline-name` en
 *      hero.tsx / final-cta.tsx + `timeline-scope` en el main — archivos que
 *      este fragmento no puede tocar — y el soporte mobile (Safari < 26,
 *      Firefox viejos) sigue siendo parcial justo en el target de la barra.
 *   2. La convivencia con el CookieBanner requiere JS sí o sí: el consent
 *      vive en localStorage (`folio.cookieConsent`).
 *
 * CookieBanner (fixed-bottom, z-index 60): mientras el consent NO está
 * resuelto —primera visita, banner visible— la barra NO aparece. Un poll
 * liviano (500 ms) sobre localStorage espera el `granted` o el `denied`
 * (ninguno recarga la página — el banner resuelve in-place). Así nunca
 * conviven dos fixed-bottom y el diálogo legal conserva prioridad. Defensa
 * extra: la barra queda en z-index 40 (< 60 del banner, < 50 del header).
 *
 * Sentinelas: observa los nodos YA existentes [data-fl-section="hero"] y
 * #cta-final — cero DOM extra en page.tsx. Oculta = visibility:hidden (fuera
 * del tab order y del árbol de accesibilidad). Estilos en public/folio.css
 * (bloque fl-sticky-*: glass como .fl-header, safe-area inferior,
 * reduced-motion sin animación); en ≥768px la barra es display:none.
 */

import { useEffect, useState } from "react";

/** Misma key que components/cookie-banner.tsx. */
const CONSENT_KEY = "folio.cookieConsent";
const CONSENT_POLL_MS = 500;

export function StickyCta() {
  const [consentResolved, setConsentResolved] = useState(false);
  const [pastHero, setPastHero] = useState(false);
  const [finalCtaVisible, setFinalCtaVisible] = useState(false);

  // Gate de consent: no superponerse al CookieBanner (ambos fixed-bottom).
  useEffect(() => {
    const resolved = () => {
      try {
        return window.localStorage.getItem(CONSENT_KEY) !== null;
      } catch {
        // Sin localStorage (modo privado estricto) el banner no persiste nada;
        // mostramos la barra igual — por z-index queda debajo del diálogo.
        return true;
      }
    };
    if (resolved()) {
      setConsentResolved(true);
      return;
    }
    const id = window.setInterval(() => {
      if (resolved()) {
        setConsentResolved(true);
        window.clearInterval(id);
      }
    }, CONSENT_POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  // Sentinelas: aparece pasado el hero, se va cuando el cierre está a la vista.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const hero = document.querySelector('[data-fl-section="hero"]');
    const finalCta = document.getElementById("cta-final");
    if (!hero || !finalCta) return;

    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === hero) {
          // "Pasado" = salió por ARRIBA del viewport (bottom <= 0), no el
          // estado inicial donde el hero simplemente todavía no se ve.
          setPastHero(!entry.isIntersecting && entry.boundingClientRect.bottom <= 0);
        } else {
          setFinalCtaVisible(entry.isIntersecting);
        }
      }
    });
    io.observe(hero);
    io.observe(finalCta);
    return () => io.disconnect();
  }, []);

  const show = consentResolved && pastHero && !finalCtaVisible;

  return (
    <div
      className={show ? "fl-sticky-cta is-show" : "fl-sticky-cta"}
      aria-hidden={show ? undefined : true}
    >
      <a
        className="fi-btn fi-btn-primary fl-sticky-cta-btn"
        href="/onboarding"
        data-fl-cta="sticky"
      >
        Empezá gratis · 7 días
      </a>
      <span className="fl-sticky-cta-note">Sin tarjeta</span>
    </div>
  );
}
