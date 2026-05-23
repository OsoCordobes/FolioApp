"use client";

/**
 * Folio · Onboarding · Paso 1 (Consentimiento para users ya autenticados).
 *
 * Cuando un usuario llega a /onboarding ya autenticado (típicamente por
 * Google OAuth en /api/auth/callback), no hay cuenta para crear: ya existe
 * el `auth.user`. Pero todavía no aceptó nuestro Aviso de Privacidad
 * (Ley 25.326 art. 14) ni hay todavía profile / org / member en Folio.
 *
 * Este componente muestra el email del user (read-only), el checkbox de
 * consent y el captcha de Turnstile. Al continuar llama a
 * `bootstrapOrgForAuthenticatedUser` que crea la org placeholder + profile
 * con consent + member OWNER, sin tocar nada de auth/password.
 */

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

import { StepShell } from "@/components/onboarding/step-shell";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

interface Step1ConsentProps {
  email: string;
  onSubmit: (options: { turnstileToken: string | null; consent: boolean }) => void;
  loading?: boolean;
  error?: string | null;
}

export function Step1Consent({ email, onSubmit, loading, error }: Step1ConsentProps) {
  const [consent, setConsent] = useState(false);
  const [consentErr, setConsentErr] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaContainerRef = useRef<HTMLDivElement | null>(null);
  const captchaWidgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    if (!captchaContainerRef.current) return;
    const tryRender = () => {
      if (!window.turnstile) return false;
      if (captchaWidgetIdRef.current) return true;
      captchaWidgetIdRef.current = window.turnstile.render(captchaContainerRef.current!, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: "auto",
        size: "flexible",
        callback: (token) => setCaptchaToken(token),
        "expired-callback": () => setCaptchaToken(null),
        "error-callback": () => setCaptchaToken(null),
      });
      return true;
    };
    if (!tryRender()) {
      const id = setInterval(() => { if (tryRender()) clearInterval(id); }, 200);
      return () => {
        clearInterval(id);
        if (captchaWidgetIdRef.current && window.turnstile) {
          window.turnstile.remove(captchaWidgetIdRef.current);
          captchaWidgetIdRef.current = null;
        }
      };
    }
    return () => {
      if (captchaWidgetIdRef.current && window.turnstile) {
        window.turnstile.remove(captchaWidgetIdRef.current);
        captchaWidgetIdRef.current = null;
      }
    };
  }, []);

  const validateAndNext = () => {
    if (!consent) {
      setConsentErr("Tenés que aceptar el aviso de privacidad para continuar.");
      return;
    }
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      setConsentErr("Esperá unos segundos a que el captcha verifique.");
      return;
    }
    setConsentErr("");
    onSubmit({ turnstileToken: captchaToken, consent: true });
  };

  return (
    <StepShell
      stepIdx={1}
      headline="Confirmemos que sos vos."
      sub="Ya entraste con tu cuenta de Google. Aceptá el aviso de privacidad y armamos tu consultorio."
      next={validateAndNext}
      canSkip={false}
      nextLabel={loading ? "Creando consultorio…" : "Continuar"}
      nextDisabled={loading}
    >
      <div className="onb-form">
        <label className="onb-field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            readOnly
            disabled
            style={{ background: "var(--surface-soft, #faf8f4)", color: "var(--ink-3)" }}
          />
        </label>

        {/* Ley 25.326 art. 14 — explicit informed consent before PII processing */}
        <label
          className="onb-field"
          style={{ display: "flex", flexDirection: "row", gap: 10, alignItems: "flex-start", fontSize: 13, lineHeight: 1.5 }}
        >
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => {
              setConsent(e.target.checked);
              if (consentErr) setConsentErr("");
            }}
            style={{ marginTop: 2, flexShrink: 0 }}
          />
          <span style={{ color: "var(--ink-2)" }}>
            Acepto el{" "}
            <a href="/privacidad" target="_blank" rel="noreferrer" className="au-link">
              Aviso de Privacidad
            </a>{" "}
            (Ley 25.326) y los{" "}
            <a href="/terminos" target="_blank" rel="noreferrer" className="au-link">
              Términos
            </a>
            . Mis datos se procesan según el aviso.
          </span>
        </label>
        {consentErr ? <span className="onb-err">{consentErr}</span> : null}

        {TURNSTILE_SITE_KEY ? (
          <>
            <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
            <div ref={captchaContainerRef} style={{ marginTop: 4 }} />
          </>
        ) : null}

        {error ? <p className="au-err onb-banner-err" role="alert">{error}</p> : null}
      </div>
    </StepShell>
  );
}
