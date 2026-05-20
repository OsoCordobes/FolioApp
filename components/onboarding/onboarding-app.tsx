"use client";

/**
 * Folio · Onboarding · 9-step wizard (premium architecture).
 *
 * Flow:
 *   - Step 1 (signup) crea auth.user + organization + member en el mismo paso
 *     via signUpAndInitOrganization. Devuelve organizationId + slug provisional.
 *   - Steps 2-8 hacen auto-save por step (debounce 800ms) via updateOnboardingStep.
 *     Cada cambio actualiza optimistic state local; el persist a DB ocurre async.
 *   - Step 9 llama finalizeOnboarding (marca onboarding_completed=true) y muestra
 *     el "moment" — card real con link real + CTAs.
 *
 * Resume: si el user vuelve después de abandonar, /onboarding/page.tsx lee
 * organizationId + initialSlug + initialData + initialStep desde DB y los pasa
 * acá. Hidratamos el state desde DB (no desde localStorage).
 *
 * Keyboard: Enter avanza el step (si Next está activo), Esc vuelve uno.
 * localStorage: backup secundario de drafts no guardados (red intermitente).
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import {
  finalizeOnboarding,
  signUpAndInitOrganization,
  updateOnboardingStep,
} from "@/app/(public)/onboarding/actions";
import { FolioMark } from "@/components/folio-mark";
import { Step1Registro } from "@/components/onboarding/step1-registro";
import { Step9Moment } from "@/components/onboarding/step9-moment";
import {
  ONBOARDING_INITIAL,
  Step2Profesional,
  Step3Consultorio,
  Step4Personalizacion,
  Step5Horarios,
  Step6Servicios,
  Step7Google,
  Step8MercadoPago,
  type OnboardingDataState,
} from "@/components/onboarding/steps";

const ONB_TOTAL = 9;
const STORAGE_KEY = "folio:onboarding";
const AUTOSAVE_DEBOUNCE_MS = 800;

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

interface OnboardingAppProps {
  initialStep?: number;
  initialData?: Record<string, unknown>;
  organizationId?: string;
  initialSlug?: string;
}

interface SaveState {
  status: "idle" | "saving" | "saved" | "error";
  lastSavedAt?: number;
  message?: string;
}

export function OnboardingApp({
  initialStep,
  initialData,
  organizationId,
  initialSlug,
}: OnboardingAppProps = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [stepIdx, setStepIdx] = useState(initialStep ?? 1);
  const [data, setData] = useState<OnboardingDataState>(ONBOARDING_INITIAL);
  const [orgId, setOrgId] = useState<string | undefined>(organizationId);
  const [orgSlug, setOrgSlug] = useState<string | undefined>(initialSlug);
  const [finishing, startTransition] = useTransition();
  const [signingUp, startSignupTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const [direction, setDirection] = useState<"forward" | "back">("forward");

  // Hidratación: prioriza initialData (DB) > localStorage > URL params.
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
      ...(initialData ?? {}),
      ...(prefillEmail ? { email: prefillEmail } : {}),
      ...(prefillNombre ? { nombre: prefillNombre } : {}),
    }));
  }, [searchParams, initialData]);

  // Persistir cada cambio en localStorage (backup)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // quota / privacy mode
    }
  }, [data]);

  // ─── Auto-save por step (debounce 800ms) ─────────────────────────────────
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedSnapshotRef = useRef<string>("");
  const pendingStepRef = useRef<number | null>(null);

  const persistStep = useCallback(
    async (step: number, snapshot: OnboardingDataState) => {
      if (!orgId) return;
      try {
        setSaveState({ status: "saving" });
        let result;
        switch (step) {
          case 2:
            result = await updateOnboardingStep(2, {
              nombre: snapshot.nombre,
              apellido: snapshot.apellido,
              matricula: snapshot.matricula,
              tel: snapshot.tel,
            });
            break;
          case 3:
            result = await updateOnboardingStep(3, {
              consultorioNombre: snapshot.consultorioNombre,
              rubro: snapshot.rubro,
              ciudad: snapshot.ciudad,
              provincia: snapshot.provincia,
              direccion: snapshot.direccion,
              telefonoPublico: snapshot.telefonoPublico,
              instagram: snapshot.instagram,
              bio: snapshot.bio,
            });
            break;
          case 4:
            result = await updateOnboardingStep(4, { acento: snapshot.acento });
            break;
          case 5:
            result = await updateOnboardingStep(5, {
              diasActivos: snapshot.diasActivos,
              franjas: snapshot.franjas,
              slotMin: snapshot.slotMin,
            });
            break;
          case 6:
            result = await updateOnboardingStep(6, {
              servicios: snapshot.servicios.map((s) => ({
                nombre: s.nombre,
                dur: s.dur,
                precioCents: Math.round(s.precio * 100),
                tipoCanonico: inferTipoCanonico(s.nombre),
              })),
            });
            break;
          default:
            setSaveState({ status: "idle" });
            return;
        }
        if (result.ok) {
          if (step === 3 && result.slug && result.slug !== orgSlug) {
            setOrgSlug(result.slug);
          }
          setSaveState({ status: "saved", lastSavedAt: Date.now() });
        } else {
          setSaveState({ status: "error", message: result.error });
        }
      } catch (e) {
        setSaveState({
          status: "error",
          message: e instanceof Error ? e.message : "Error guardando.",
        });
      }
    },
    [orgId, orgSlug],
  );

  // Trigger auto-save cuando cambian datos relevantes
  useEffect(() => {
    if (!orgId) return;
    if (stepIdx === 1 || stepIdx === 9) return;
    // Steps 7-8 no persisten datos (sus integraciones tienen su propio flow)
    if (stepIdx === 7 || stepIdx === 8) return;

    const snapshot = JSON.stringify({ step: stepIdx, data });
    if (snapshot === lastSavedSnapshotRef.current) return;
    lastSavedSnapshotRef.current = snapshot;
    pendingStepRef.current = stepIdx;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void persistStep(stepIdx, data);
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [data, stepIdx, orgId, persistStep]);

  const set = (patch: Partial<OnboardingDataState>) =>
    setData((prev) => ({ ...prev, ...patch }));

  const flushSaveIfPending = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      if (pendingStepRef.current !== null && orgId) {
        await persistStep(pendingStepRef.current, data);
        pendingStepRef.current = null;
      }
    }
  }, [data, orgId, persistStep]);

  const next = useCallback(() => {
    setDirection("forward");
    void flushSaveIfPending();
    setStepIdx((n) => Math.min(ONB_TOTAL, n + 1));
  }, [flushSaveIfPending]);

  const back = useCallback(() => {
    setDirection("back");
    void flushSaveIfPending();
    setStepIdx((n) => Math.max(1, n - 1));
  }, [flushSaveIfPending]);

  const skip = next;

  // ─── Keyboard shortcuts ──────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ignorar si está modificador (Cmd/Ctrl+Enter = nueva línea, etc.)
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTextArea = tag === "textarea";
      const isContentEditable = target?.isContentEditable;

      if (e.key === "Escape" && stepIdx > 1 && stepIdx < 9) {
        e.preventDefault();
        back();
        return;
      }
      if (e.key === "Enter" && !isTextArea && !isContentEditable && stepIdx < 9) {
        // En Step 1 dejamos que el botón maneje su validación
        if (tag === "button") return;
        e.preventDefault();
        if (stepIdx === 1) {
          handleStep1Next();
        } else {
          next();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIdx, next, back]);

  // ─── Step 1: signUpAndInitOrganization ───────────────────────────────────
  const handleStep1Next = () => {
    startSignupTransition(async () => {
      const result = await signUpAndInitOrganization(data.email, data.password);
      if (!result.ok) {
        setError(result.error ?? "Error en signup");
        return;
      }
      setError(null);
      if (result.organizationId) setOrgId(result.organizationId);
      if (result.slug) setOrgSlug(result.slug);
      setDirection("forward");
      setStepIdx(2);
    });
  };

  // ─── Step 9: finalizar ───────────────────────────────────────────────────
  const handleFinish = async () => {
    setError(null);
    await flushSaveIfPending();
    const result = await finalizeOnboarding();
    if (!result.ok) {
      setError(result.error ?? "Error al finalizar onboarding");
      return;
    }
    if (result.slug && result.slug !== orgSlug) setOrgSlug(result.slug);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  const goToPanel = () => {
    startTransition(() => {
      router.push("/hoy");
      router.refresh();
    });
  };

  const stepKey = `step-${stepIdx}-${direction}`;
  const commonStepProps = {
    data,
    set,
    next,
    back,
    skip,
    orgId,
    orgSlug,
    direction,
  };

  return (
    <div className="onb-app">
      <header className="onb-app-head">
        <div className="onb-app-brand">
          <FolioMark size={24} />
          <span className="onb-brand-name">folio</span>
        </div>
        {stepIdx > 1 && stepIdx < 9 ? (
          <SaveIndicator state={saveState} />
        ) : (
          <span />
        )}
      </header>

      <main className="onb-app-main">
        {error && stepIdx !== 9 ? (
          <p className="au-err onb-banner-err" role="alert">{error}</p>
        ) : null}

        <div key={stepKey} className={`onb-anim onb-anim-${direction}`}>
          {stepIdx === 1 ? (
            <Step1Registro
              data={{ email: data.email, password: data.password }}
              set={(patch) => set(patch)}
              next={handleStep1Next}
              loading={signingUp}
              error={error}
            />
          ) : null}
          {stepIdx === 2 ? <Step2Profesional {...commonStepProps} /> : null}
          {stepIdx === 3 ? <Step3Consultorio {...commonStepProps} /> : null}
          {stepIdx === 4 ? <Step4Personalizacion {...commonStepProps} /> : null}
          {stepIdx === 5 ? <Step5Horarios {...commonStepProps} /> : null}
          {stepIdx === 6 ? <Step6Servicios {...commonStepProps} /> : null}
          {stepIdx === 7 ? <Step7Google {...commonStepProps} /> : null}
          {stepIdx === 8 ? <Step8MercadoPago {...commonStepProps} /> : null}
          {stepIdx === 9 ? (
            <Step9Moment
              data={data}
              accent={data.acento}
              slug={orgSlug}
              onFinish={handleFinish}
              onGoToPanel={goToPanel}
              finishing={finishing}
              error={error}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}

// ─── Save indicator (header derecho durante steps 2-8) ──────────────────────

function SaveIndicator({ state }: { state: SaveState }) {
  if (state.status === "idle") return <span />;
  const base: React.CSSProperties = {
    fontSize: 12,
    color: "var(--ink-3)",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
  };
  if (state.status === "saving") {
    return (
      <span style={base} aria-live="polite">
        <SaveSpinner /> Guardando…
      </span>
    );
  }
  if (state.status === "error") {
    return (
      <span style={{ ...base, color: "var(--red, #9B3A2A)" }} role="alert">
        Reintentar guardar
      </span>
    );
  }
  // saved
  const ago = state.lastSavedAt ? secondsAgo(state.lastSavedAt) : null;
  return (
    <span style={base} aria-live="polite">
      <SavedCheck /> Guardado {ago ? `hace ${ago}` : "recién"}
    </span>
  );
}

function secondsAgo(ts: number): string {
  const diff = Math.round((Date.now() - ts) / 1000);
  if (diff < 5) return "ahora";
  if (diff < 60) return `${diff}s`;
  return `${Math.round(diff / 60)} min`;
}

function SaveSpinner() {
  return (
    <span
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        border: "1.5px solid var(--line)",
        borderTopColor: "var(--accent, #8A6722)",
        borderRadius: "50%",
        animation: "onb-spin 720ms linear infinite",
      }}
    />
  );
}

function SavedCheck() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
