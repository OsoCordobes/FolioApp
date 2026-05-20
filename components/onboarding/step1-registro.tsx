"use client";

/**
 * Folio · Onboarding · Paso 1 (Registro).
 *
 * Port fiel de Step1Registro en folio/onboarding-steps.jsx (44-97).
 * En F1 valida client-side; en F3 se conecta a Supabase Auth signUp.
 */

import { useState } from "react";

import { StepShell } from "@/components/onboarding/step-shell";

interface OnboardingData {
  email: string;
  password: string;
}

interface Step1RegistroProps {
  data: OnboardingData;
  set: (patch: Partial<OnboardingData>) => void;
  next: () => void;
  loading?: boolean;
  error?: string | null;
}

export function Step1Registro({ data, set, next, loading, error }: Step1RegistroProps) {
  const [emailErr, setEmailErr] = useState("");
  const [pwErr, setPwErr] = useState("");

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
    if (ok) next();
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
      <button
        type="button"
        className="onb-btn-google"
        onClick={() => {
          set({ email: "lorenzo@gmail.com" });
          next();
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
        Continuar con Google
      </button>
      <div className="onb-divider">
        <span>o con tu email</span>
      </div>
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
        {error ? <p className="au-err onb-banner-err" role="alert">{error}</p> : null}
      </div>
    </StepShell>
  );
}
