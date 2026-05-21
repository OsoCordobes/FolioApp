"use client";

/**
 * Folio · Onboarding · Paso 1 (Registro).
 *
 * Forma alternativa al signup desde /login. Cuando el usuario llega
 * directamente a /onboarding sin haber pasado por /login, Step 1 es
 * donde crea su cuenta. La forma server-side llama
 * signUpAndInitOrganization() vía la prop `next`.
 *
 * Google signup deshabilitado (era un mock con email hardcoded). El
 * botón se mantiene visualmente con copy "Próximamente" hasta que el
 * /api/auth/callback handle el bootstrap-on-first-sign-in correctamente.
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
