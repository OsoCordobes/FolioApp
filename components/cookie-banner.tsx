"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
 *
 * Sin reload: aceptar dispara el evento `folio:cookie-consent` y el provider
 * inicializa PostHog in-place. Antes hacíamos window.location.reload() — un
 * paciente a mitad del wizard de /book/[slug] perdía todo su progreso.
 *
 * El banner es `position: fixed` y en mobile ocupa ~230px (el texto legal
 * envuelve en 4-5 líneas): a 375px tapaba "Crear cuenta" y el link al Aviso
 * de Privacidad al pie del card de /login — el punto de entrada al alta, en
 * el dispositivo donde más gente llega. Achicarlo no alcanza (para despejar
 * ambos controles tendría que medir <80px, menos que el título + los dos
 * botones), así que RESERVA su espacio con un spacer en flujo normal,
 * hermano del banner: al final del body, empuja el alto del documento y todo
 * el contenido se puede scrollear por encima. Se va con el banner.
 *
 * Por qué un spacer y no CSS: `html, body { height: 100% }` (folio.css) +
 * box-sizing:border-box global hacen que padding/margin sobre el body NO
 * agreguen área scrolleable — se la comen. Un elemento en flujo sí la agrega,
 * y funciona igual en los 5 layouts (landing, auth, booking, portal, app) sin
 * tener que enumerar la clase raíz de cada uno.
 */

const STORAGE_KEY = "folio.cookieConsent";
/** Evento que escucha FolioPostHogProvider para (re)evaluar el consent. */
export const CONSENT_EVENT = "folio:cookie-consent";
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

  // Alto del banner → alto del spacer. El ref callback mide en el primer
  // paint y un ResizeObserver lo sigue ante rotación del teléfono o reflow
  // del texto. 0 = todavía sin medir (o banner ausente).
  const [spacerH, setSpacerH] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const setBannerRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) {
      setSpacerH(0);
      return;
    }
    // +16 del `bottom: 16` del banner + 8 de aire, para que el último control
    // no quede pegado al borde superior del banner.
    const publish = () => setSpacerH(Math.ceil(node.getBoundingClientRect().height) + 24);
    publish();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(publish);
      ro.observe(node);
      observerRef.current = ro;
    }
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  const accept = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "granted");
    } catch { /* private mode */ }
    setConsent("granted");
    // Avisar al FolioPostHogProvider para que inicialice PostHog SIN recargar
    // (el reload anterior tiraba el progreso del wizard de booking).
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: "granted" }));
  };

  const reject = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "denied");
    } catch { /* private mode */ }
    setConsent("denied");
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: "denied" }));
  };

  if (consent === "granted" || consent === "denied") return null;

  return (
    <>
    {/* Spacer en flujo: empuja el alto del documento para que el contenido
        del pie (p. ej. "Crear cuenta" en /login) se pueda scrollear por
        encima del banner fijo. aria-hidden: no aporta nada al lector. */}
    <div aria-hidden="true" style={{ height: spacerH }} />
    <div
      ref={setBannerRef}
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
    </>
  );
}
