"use client";

/**
 * Folio · Onboarding · Paso 1 (Registro).
 *
 * Forma alternativa al signup desde /login. Cuando el usuario llega
 * directamente a /onboarding sin haber pasado por /login, Step 1 es
 * donde crea su cuenta. La forma server-side llama
 * signUpAndInitOrganization() vía la prop `onSubmit`, recibiendo
 * el captcha token (Turnstile) y el consent (Ley 25.326 art. 14).
 */

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

import { StepShell } from "@/components/onboarding/step-shell";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

interface OnboardingData {
  email: string;
  password: string;
}

interface Step1RegistroProps {
  data: OnboardingData;
  set: (patch: Partial<OnboardingData>) => void;
  onSubmit: (options: { turnstileToken: string | null; consent: boolean }) => void;
  loading?: boolean;
  error?: string | null;
}

export function Step1Registro({ data, set, onSubmit, loading, error }: Step1RegistroProps) {
  const [emailErr, setEmailErr] = useState("");
  const [pwErr, setPwErr] = useState("");
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
      // Script may still be loading; poll briefly.
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
    let ok = true;
    if (!data.email?.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)) {
      setEmailErr("Ingresá un email válido");
      ok = false;
    } else {
      setEmailErr("");
    }
    if (!data.password || data.password.length < 8) {
      setPwErr("Mínimo 8 caracteres");
      ok = false;
    } else {
      setPwErr("");
    }
    if (!consent) {
      setConsentErr("Tenés que aceptar el aviso de privacidad para continuar.");
      ok = false;
    } else {
      setConsentErr("");
    }
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      setConsentErr("Esperá unos segundos a que el captcha verifique.");
      ok = false;
    }
    if (ok) onSubmit({ turnstileToken: captchaToken, consent: true });
  };

  return (
    <StepShell
      stepIdx={1}
      headline="Empezá creando tu cuenta."
      sub="7 días de prueba sin tarjeta. Después, ARS 35.000 / mes."
      next={validateAndNext}
      canSkip={false}
      nextLabel={loading ? "Creando cuenta…" : "Continuar"}
      nextDisabled={loading}
    >
      <div className="onb-form">
        <label className={"onb-field" + (emailErr ? " is-err" : "")}>
          <span>Email</span>
          <input
            type="email"
            placeholder="vos@consultorio.com"
            value={data.email || ""}
            onChange={(e) => {
              set({ email: e.target.value });
              if (emailErr) setEmailErr("");
            }}
            autoComplete="email"
          />
          {emailErr ? <span className="onb-err">{emailErr}</span> : null}
        </label>
        <label className={"onb-field" + (pwErr ? " is-err" : "")}>
          <span>Contraseña</span>
          <input
            type="password"
            placeholder="Mínimo 8 caracteres"
            value={data.password || ""}
            onChange={(e) => {
              set({ password: e.target.value });
              if (pwErr) setPwErr("");
            }}
            autoComplete="new-password"
          />
          {pwErr ? <span className="onb-err">{pwErr}</span> : null}
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
            <Script
              src="https://challenges.cloudflare.com/turnstile/v0/api.js"
              async
              defer
            />
            <div ref={captchaContainerRef} style={{ marginTop: 4 }} />
          </>
        ) : null}

        {error ? <p className="au-err onb-banner-err" role="alert">{error}</p> : null}
      </div>
    </StepShell>
  );
}
