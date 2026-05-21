"use client";

import { useEffect, useState } from "react";

/**
 * Folio · Cookie consent banner — Phase 6b of the pre-audit sprint.
 *
 * Ley 25.326 + Argentina e-Commerce + GDPR best-practice: Folio drops a
 * 1st-party cookie (Supabase auth) + a 3rd-party analytics cookie
 * (PostHog). The Supabase auth cookie is "strictly necessary" — does
 * not require consent. The PostHog cookie is "analytics" — requires
 * an explicit opt-in.
 *
 * Persists choice to localStorage as 'folio.cookieConsent' = 'granted' |
 * 'denied'. PostHog provider gates init on the granted value (see
 * lib/observability/posthog-client.tsx).
 */

const STORAGE_KEY = "folio.cookieConsent";
type Consent = "granted" | "denied" | null;

export function CookieBanner() {
  // Hide by default until effect resolves the stored value (avoid hydration flash).
  const [consent, setConsent] = useState<Consent>("granted");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY) as Consent;
      setConsent(stored ?? null);
    } catch {
      setConsent(null);
    }
  }, []);

  const accept = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "granted");
    } catch { /* private mode */ }
    setConsent("granted");
    // Reload so the PostHog provider initializes immediately.
    window.location.reload();
  };

  const reject = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "denied");
    } catch { /* private mode */ }
    setConsent("denied");
  };

  if (consent === "granted" || consent === "denied") return null;

  return (
    <div
      role="dialog"
      aria-labelledby="cookie-banner-title"
      aria-describedby="cookie-banner-body"
      style={{
        position: "fixed",
        bottom: 16,
        left: 16,
        right: 16,
        maxWidth: 720,
        margin: "0 auto",
        padding: 16,
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        boxShadow: "0 18px 40px rgba(20,17,11,0.08), 0 3px 10px rgba(138,103,34,0.06)",
        zIndex: 60,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        fontSize: 13,
        lineHeight: 1.5,
        color: "var(--ink)",
      }}
    >
      <strong id="cookie-banner-title" style={{ fontSize: 14 }}>Cookies y privacidad</strong>
      <p id="cookie-banner-body" style={{ margin: 0, color: "var(--ink-2)" }}>
        Folio usa cookies esenciales para mantener tu sesión (Supabase Auth) y, opcionalmente,
        analytics anónimo (PostHog) para entender qué partes del producto funcionan mejor.
        Podés rechazar analytics — la sesión sigue funcionando igual.{" "}
        <a href="/privacidad" className="au-link">Aviso de Privacidad</a> (Ley 25.326).
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="fi-btn fi-btn-primary" onClick={accept}>
          Aceptar analytics
        </button>
        <button type="button" className="fi-btn fi-btn-ghost" onClick={reject}>
          Solo esenciales
        </button>
      </div>
    </div>
  );
}
