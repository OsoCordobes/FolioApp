"use client";

/**
 * Folio · Onboarding · Paso 1 (Registro).
 *
 * Destino de TODOS los CTAs de la landing — signup al mismo nivel que el de
 * /login: "Continuar con Google" (el flujo OAuth→Step1Consent ya está
 * armado), medidor de fuerza de contraseña compartido y link a /login para
 * quien ya tiene cuenta. La forma server-side llama
 * signUpAndInitOrganization() vía la prop `onSubmit`, recibiendo
 * el captcha token (Turnstile) y el consent (Ley 25.326 art. 14).
 */

import Script from "next/script";
import { useEffect, useRef, useState, useTransition } from "react";

import { signInWithGoogle } from "@/app/(public)/login/actions";
import { PasswordStrengthMeter } from "@/components/auth/password-strength-meter";
import { StepShell } from "@/components/onboarding/step-shell";
import { formatArsFromCents } from "@/lib/format/currency";

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
  /** Precio del plan en centavos ARS — derivado server-side de MP_PLAN_PRICE_CENTS. */
  planPriceCents: number;
}

export function Step1Registro({
  data,
  set,
  onSubmit,
  loading,
  error,
  planPriceCents,
}: Step1RegistroProps) {
  const [emailErr, setEmailErr] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [consent, setConsent] = useState(false);
  const [consentErr, setConsentErr] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaContainerRef = useRef<HTMLDivElement | null>(null);
  const captchaWidgetIdRef = useRef<string | null>(null);
  const [googlePending, startGoogleTransition] = useTransition();

  // Google OAuth: el callback deja sesión abierta y /onboarding cae en
  // Step1Consent (consent + bootstrap, sin password). Mismo flujo que el
  // botón de /login.
  const handleGoogle = () => {
    startGoogleTransition(async () => {
      await signInWithGoogle();
    });
  };

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
      // Precio: fuente canónica MP_PLAN_PRICE_CENTS (lib/mercadopago/client.ts).
      // Llega como prop desde el server component de /onboarding — mismo valor
      // que el cobro real, sin hardcode que pueda driftear del env.
      sub={`30 días de prueba sin tarjeta. Después, ${formatArsFromCents(planPriceCents)} / mes.`}
      next={validateAndNext}
      canSkip={false}
      nextLabel={loading ? "Creando cuenta…" : "Continuar"}
      nextDisabled={loading}
    >
      <div className="onb-form">
        <button
          type="button"
          className="au-btn-google"
          onClick={handleGoogle}
          disabled={googlePending || loading}
        >
          <GoogleLogo />
          {googlePending ? "Abriendo Google…" : "Continuar con Google"}
        </button>

        <div className="au-divider">
          <span>o con tu email</span>
        </div>

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
          <PasswordStrengthMeter password={data.password || ""} />
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

        <p className="onb-step1-login">
          ¿Ya tenés cuenta?{" "}
          <a href="/login" className="au-link">
            Entrar
          </a>
        </p>
      </div>
    </StepShell>
  );
}

function GoogleLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}
