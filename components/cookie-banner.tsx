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
 *
 * El estilo vive en folio.css (`.fi-cookie*`, sección al final) y NO inline:
 * el banner se monta en el root layout, así que también aplica a las rutas
 * de (app), donde la bottom-nav mobile (`.fi-mnav`, fixed bottom:0 z-90 con
 * fondo OPACO bajo 920px) se pintaba ENCIMA de la franja inferior del banner
 * — justo la de "Aceptar analytics" / "Solo esenciales": en un teléfono, y
 * dentro de la app, el consent quedaba imposible de aceptar Y de rechazar.
 * Un `zIndex` inline no se puede corregir desde el CSS (inline gana siempre),
 * y el offset depende del breakpoint. Ahora el banner va por ENCIMA de la nav
 * (z 92) y además se APOYA sobre ella (mismo offset que .fi-fab/.fi-toasts).
 *
 * `--fi-consent-h` (alto que el banner ocupa contra el borde inferior, el
 * mismo número que el spacer) se publica en <html> para que los controles
 * fijos del shell (.fi-fab, .fi-toasts, .pd-bulk, .onb-preview-fab) se corran
 * por encima mientras el banner está en pantalla y no queden tapados a su vez.
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

  // Espacio que el banner ocupa contra el borde inferior → alto del spacer y
  // valor de --fi-consent-h. El ref callback mide en el primer paint, un
  // ResizeObserver sigue el reflow del texto / rotación del teléfono, y el
  // listener de resize cubre el cruce del breakpoint de 920px (que cambia el
  // `bottom` aplicado SIN cambiar la caja del banner, así que el RO no salta).
  // 0 = todavía sin medir (o banner ausente).
  const [spacerH, setSpacerH] = useState(0);
  const bannerRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const publish = useCallback(() => {
    const node = bannerRef.current;
    if (!node) return;
    // Se mide contra el viewport, no `height`: así entra también el `bottom`
    // que decidió el CSS (16px suelto, 76px apoyado sobre la bottom-nav) sin
    // duplicar el breakpoint en JS. +8 de aire para que el último control no
    // quede pegado al borde superior del banner.
    const alto = Math.max(0, Math.ceil(window.innerHeight - node.getBoundingClientRect().top)) + 8;
    setSpacerH(alto);
    document.documentElement.style.setProperty("--fi-consent-h", `${alto}px`);
  }, []);

  const setBannerRef = useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      bannerRef.current = node;
      if (!node) {
        setSpacerH(0);
        document.documentElement.style.removeProperty("--fi-consent-h");
        return;
      }
      publish();
      if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(publish);
        ro.observe(node);
        observerRef.current = ro;
      }
    },
    [publish],
  );

  useEffect(() => {
    window.addEventListener("resize", publish);
    return () => {
      window.removeEventListener("resize", publish);
      observerRef.current?.disconnect();
      document.documentElement.style.removeProperty("--fi-consent-h");
    };
  }, [publish]);

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
      className="fi-cookie"
      role="dialog"
      aria-labelledby="cookie-banner-title"
      aria-describedby="cookie-banner-body"
    >
      <strong id="cookie-banner-title" className="fi-cookie-title">Cookies y privacidad</strong>
      <p id="cookie-banner-body" className="fi-cookie-body">
        Folio usa cookies esenciales para mantener tu sesión (Supabase Auth) y, opcionalmente,
        analytics anónimo (PostHog) para entender qué partes del producto funcionan mejor.
        Podés rechazar analytics — la sesión sigue funcionando igual.{" "}
        <a href="/privacidad" className="au-link">Aviso de Privacidad</a> (Ley 25.326).
      </p>
      <div className="fi-cookie-actions">
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
