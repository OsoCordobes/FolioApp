"use client";

/**
 * Folio · Onboarding · 9-step wizard.
 *
 * Step 1 → signUpEmail (Server Action que crea auth.users + envía verify).
 * Step 9 → completeOnboarding (Server Action que crea org + profile + member).
 *
 * Persistencia entre pasos: localStorage `folio:onboarding` (resilient a
 * refresh accidental). Se borra al completar.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import {
  completeOnboarding,
  signUpEmail,
} from "@/app/(public)/onboarding/actions";
import { FolioMark } from "@/components/folio-mark";
import { Step1Registro } from "@/components/onboarding/step1-registro";
import {
  ONBOARDING_INITIAL,
  Step2Profesional,
  Step3Consultorio,
  Step4Personalizacion,
  Step5Horarios,
  Step6Servicios,
  Step7Google,
  Step8MercadoPago,
  Step9Listo,
  type OnboardingDataState,
} from "@/components/onboarding/steps";

const ONB_TOTAL = 9;
const STORAGE_KEY = "folio:onboarding";

const TIPO_CANONICO_MAP: Record<string, string> = {
  "consulta inicial":  "CONSULTA_INICIAL",
  "seguimiento":       "SEGUIMIENTO_ESTANDAR",
  "pack 5 sesiones":   "PACK_SESIONES",
  "deportiva":         "SERVICIO_ESPECIALIZADO",
};

function inferTipoCanonico(nombre: string): string {
  const key = nombre.trim().toLowerCase();
  return TIPO_CANONICO_MAP[key] ?? "SERVICIO_ESPECIALIZADO";
}

export function OnboardingApp() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [stepIdx, setStepIdx] = useState(1);
  const [data, setData] = useState<OnboardingDataState>(ONBOARDING_INITIAL);
  const [finishing, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Hidratación: cargar datos previos + prefill desde URL (link de signup)
  useEffect(() => {
    let restored: Partial<OnboardingDataState> = {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) restored = JSON.parse(raw);
    } catch {
      // ignore
    }
    const prefillEmail = searchParams.get("email");
    const prefillNombre = searchParams.get("nombre");
    setData((prev) => ({
      ...prev,
      ...restored,
      ...(prefillEmail ? { email: prefillEmail } : {}),
      ...(prefillNombre ? { nombre: prefillNombre } : {}),
    }));
  }, [searchParams]);

  // Persistir cada cambio en localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // quota / privacy mode
    }
  }, [data]);

  const set = (patch: Partial<OnboardingDataState>) =>
    setData((prev) => ({ ...prev, ...patch }));

  const next = () => setStepIdx((n) => Math.min(ONB_TOTAL, n + 1));
  const back = () => setStepIdx((n) => Math.max(1, n - 1));
  const skip = () => next();

  // ─── Step 1 hook: pasar de Registro a Profesional via Server Action ──────
  const handleStep1Next = () => {
    // Validación client-side ya está en Step1Registro; acá disparamos signUp.
    startTransition(async () => {
      const result = await signUpEmail(data.email, data.password);
      if (!result.ok) {
        setError(result.error ?? "Error en signup");
        return;
      }
      setError(null);
      // Si la confirmación de email está enabled, el user igual pasa al Step 2
      // (verifica más tarde desde su email). El completeOnboarding final
      // requiere que el user verifique antes para tener sesión activa.
      next();
    });
  };

  // ─── Step 9: ejecutar completeOnboarding ──────────────────────────────────
  const handleFinish = async () => {
    setError(null);
    const result = await completeOnboarding({
      nombre: data.nombre,
      apellido: data.apellido,
      matricula: data.matricula,
      tel: data.tel,
      consultorioNombre: data.consultorioNombre,
      rubro: data.rubro,
      direccion: data.direccion,
      ciudad: data.ciudad,
      provincia: data.provincia,
      instagram: data.instagram,
      acento: data.acento,
      diasActivos: data.diasActivos,
      franjas: data.franjas,
      slotMin: data.slotMin,
      servicios: data.servicios.map((s) => ({
        nombre: s.nombre,
        dur: s.dur,
        precioCents: s.precio * 100,
        tipoCanonico: inferTipoCanonico(s.nombre),
      })),
    });
    if (!result.ok) {
      setError(result.error ?? "Error al finalizar onboarding");
      return;
    }
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    router.push("/hoy");
    router.refresh();
  };

  return (
    <div className="onb-app">
      <header className="onb-app-head">
        <div className="onb-app-brand">
          <FolioMark size={24} />
          <span className="onb-brand-name">folio</span>
        </div>
        {stepIdx > 1 && stepIdx < 9 ? (
          <button type="button" className="onb-skip-to-panel" onClick={() => setStepIdx(9)}>
            Ir al panel ahora →
          </button>
        ) : (
          <span />
        )}
      </header>

      <main className="onb-app-main">
        {error ? <p className="au-err" style={{ textAlign: "center" }}>{error}</p> : null}

        {stepIdx === 1 ? (
          <Step1Registro
            data={{ email: data.email, password: data.password }}
            set={(patch) => set(patch)}
            next={handleStep1Next}
          />
        ) : null}
        {stepIdx === 2 ? <Step2Profesional data={data} set={set} next={next} back={back} skip={skip} /> : null}
        {stepIdx === 3 ? <Step3Consultorio data={data} set={set} next={next} back={back} skip={skip} /> : null}
        {stepIdx === 4 ? <Step4Personalizacion data={data} set={set} next={next} back={back} skip={skip} /> : null}
        {stepIdx === 5 ? <Step5Horarios data={data} set={set} next={next} back={back} skip={skip} /> : null}
        {stepIdx === 6 ? <Step6Servicios data={data} set={set} next={next} back={back} skip={skip} /> : null}
        {stepIdx === 7 ? <Step7Google data={data} set={set} next={next} back={back} skip={skip} /> : null}
        {stepIdx === 8 ? <Step8MercadoPago data={data} set={set} next={next} back={back} skip={skip} /> : null}
        {stepIdx === 9 ? (
          <Step9Listo
            data={data}
            accent={data.acento}
            onFinish={handleFinish}
            finishing={finishing}
            error={error}
          />
        ) : null}
      </main>
    </div>
  );
}
