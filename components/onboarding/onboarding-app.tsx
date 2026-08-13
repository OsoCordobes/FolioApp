"use client";

/**
 * Folio · Onboarding · 8-step wizard (premium architecture).
 *
 * Flow:
 *   - Step 1 (signup) crea auth.user + organization + member en el mismo paso
 *     via signUpAndInitOrganization. Devuelve organizationId + slug provisional.
 *   - Steps 2-6 hacen auto-save por step (debounce 800ms) via updateOnboardingStep.
 *     Cada cambio actualiza optimistic state local; el persist a DB ocurre async.
 *   - Step 7 (Google Calendar) persiste solo step_max al montar (su flow OAuth
 *     escribe en `integration` por su cuenta).
 *   - Step 8 llama finalizeOnboarding (marca onboarding_completed=true) y muestra
 *     el "moment" — card real con link real + CTAs + trial/precio (fusión del
 *     viejo Step 8 informativo de MP).
 *
 * Resume: si el user vuelve después de abandonar, /onboarding/page.tsx lee
 * organizationId + initialSlug + initialData + initialStep desde DB y los pasa
 * acá. Hidratamos el state desde DB (no desde localStorage).
 *
 * Keyboard: vive en StepShell — Enter invoca el next EFECTIVO del paso
 * (respetando nextDisabled), Esc vuelve uno.
 * localStorage: backup secundario de drafts no guardados (red intermitente),
 * namespaceado por identidad (lib/onboarding/draft) para que el PII de un
 * usuario no se precargue al siguiente en una máquina compartida.
 */

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import {
  bootstrapOrgForAuthenticatedUser,
  finalizeOnboarding,
  signUpAndInitOrganization,
  updateOnboardingStep,
} from "@/app/(public)/onboarding/actions";
import { CheckEmailPanel } from "@/components/auth/check-email-panel";
import { SideArt } from "@/components/auth/side-art";
import { FolioMark } from "@/components/folio-mark";
import { packDraft, unpackDraft } from "@/lib/onboarding/draft";
import { validateFranjas } from "@/lib/onboarding/franjas";
import { Step1Consent } from "@/components/onboarding/step1-consent";
import { Step1Registro } from "@/components/onboarding/step1-registro";
// ONBOARDING_INITIAL es un literal de data; OnboardingDataState es un type.
// Ambos quedan en el initial bundle (no son pesados — solo constants/types).
import {
  ONBOARDING_INITIAL,
  type OnboardingDataState,
} from "@/components/onboarding/steps";

// Sprint 2 T2.4: Steps 2-9 son ~190KB del bundle (form heavy + SlugEditor +
// LogoUpload + MoodPicker + Step9Moment con animaciones). Lazy-loadeamos
// el módulo entero — Step 1 ya está en el initial chunk (es el único
// reachable sin sesión). Los demás se cargan a partir de step 2.
//
// Trade-off: la transición de Step 1 → Step 2 espera al chunk (≤ 50ms con
// HTTP/2 + caching del CDN de Vercel). Acceptable: el usuario JUST hizo
// signup, no nota el delay.
// Steps 2-9 se cargan como chunks separados (uno por step). Trade-off
// honesto: el "First Load JS" reportado por Next con Turbopack no refleja
// el split (Turbopack mide estáticamente, asume worst-case). Pero en
// runtime el browser solo descarga el chunk del step que se renderiza —
// navegación intra-wizard usa cached chunks.
//
// Para alcanzar el target <180KB del audit, habría que cambiar a webpack
// (drop --turbopack) o esperar mejoras de Turbopack. Decisión tomada en
// Sprint 2 T2.4: mantener Turbopack (DX de hot-reload + build speed) y
// aceptar el reporting numérico hasta que Turbopack mature el split.
const Step2Profesional = dynamic(
  () => import("@/components/onboarding/steps").then((m) => m.Step2Profesional),
);
const Step3Consultorio = dynamic(
  () => import("@/components/onboarding/steps").then((m) => m.Step3Consultorio),
);
const Step4Personalizacion = dynamic(
  () => import("@/components/onboarding/steps").then((m) => m.Step4Personalizacion),
);
const Step5Horarios = dynamic(
  () => import("@/components/onboarding/steps").then((m) => m.Step5Horarios),
);
const Step6Servicios = dynamic(
  () => import("@/components/onboarding/steps").then((m) => m.Step6Servicios),
);
const Step7Google = dynamic(
  () => import("@/components/onboarding/steps").then((m) => m.Step7Google),
);
const Step9Moment = dynamic(
  () => import("@/components/onboarding/step9-moment").then((m) => m.Step9Moment),
);

const ONB_TOTAL = 8;
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
  /**
   * Email del user ya autenticado. Si está set, /onboarding sabe que NO tiene
   * que mostrar el form email+password (los users de Google OAuth no tienen
   * password de Supabase). En su lugar, Step 1 pide solo consent y captcha.
   */
  authedEmail?: string;
  /**
   * Precio del plan Solo en centavos ARS. Lo lee el server component
   * (app/(public)/onboarding/page.tsx) de MP_PLAN_PRICE_CENTS — fuente
   * canónica del cobro real — y lo baja acá para que Step 1 y el moment
   * muestren el mismo monto que se va a debitar (nunca un hardcode que driftee).
   */
  planPriceCents: number;
  /**
   * true si el member ya tiene la integración GOOGLE_CALENDAR (leído
   * server-side). El Step 7 lo usa para renderizar "Conectado ✓" en vez del
   * botón de conectar.
   */
  googleConnected?: boolean;
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
  authedEmail,
  planPriceCents,
  googleConnected,
}: OnboardingAppProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Clamp: datos legacy (wizard de 9 pasos) pueden traer initialStep=9.
  const [stepIdx, setStepIdx] = useState(Math.min(initialStep ?? 1, ONB_TOTAL));
  const [data, setData] = useState<OnboardingDataState>(ONBOARDING_INITIAL);
  const [orgId, setOrgId] = useState<string | undefined>(organizationId);
  const [orgSlug, setOrgSlug] = useState<string | undefined>(initialSlug);
  const [finishing, startTransition] = useTransition();
  const [signingUp, startSignupTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  // Ítem 1.5: con "Confirm email" ON, signUpAndInitOrganization devuelve
  // needsConfirmation (sin sesión ni org). Guardamos el email para mostrar
  // el panel "Revisá tu email" en lugar del form de registro.
  const [awaitingEmail, setAwaitingEmail] = useState<string | null>(null);

  // ─── Auto-save refs declarados antes del useEffect de hidratación porque
  //     la hidratación los inicializa para evitar un auto-save espurio
  //     inmediatamente después del primer render. ───────────────────────────
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedSnapshotRef = useRef<string>("");
  const pendingStepRef = useRef<number | null>(null);

  // Hidratación: prioriza initialData (DB) > localStorage > URL params.
  // Importante: NUNCA restauramos `password` del localStorage. Es secret + no
  // queremos mostrar la contraseña de un signup previo en la pantalla del
  // siguiente user en la misma máquina.
  //
  // `hydratedRef` evita que el primer setData (la hidratación) dispare el
  // auto-save effect — sin esto, al volver al wizard tras reload, el cliente
  // haría DELETE+INSERT inmediato de horarios/servicios sobre los datos
  // recién leídos de la DB. Marcamos el snapshot inicial como "ya guardado".
  const hydratedRef = useRef(false);
  useEffect(() => {
    // Hidratar SOLO una vez al montar. Tener `stepIdx` en las deps hacía que
    // este effect corriera en CADA navegación de paso, re-mergeando data stale
    // (localStorage/initialData) y —sobre todo— reseteando
    // `lastSavedSnapshotRef` al snapshot del paso recién abierto. Eso hacía que
    // el auto-save lo dedupeara y NO persistiera ese paso cuando los datos se
    // cargan SIN que el user tipee. Síntoma: el Paso 6 (servicios precargados
    // por template de especialidad) nunca guardaba → 0 servicios y onboarding
    // sin finalizar. La hidratación es un evento de arranque, no de navegación.
    if (hydratedRef.current) return;
    const prefillEmail = searchParams.get("email");
    const prefillNombre = searchParams.get("nombre");
    // Draft namespaceado por identidad (lib/onboarding/draft): se descarta si
    // no pertenece a la identidad actual (authedEmail server-side, o el email
    // del prefill). En una máquina compartida, el PII del profesional anterior
    // NO se precarga al siguiente. Los drafts legados (sin identidad) también
    // se descartan.
    let restored: Partial<OnboardingDataState> = {};
    try {
      const unpacked = unpackDraft(
        localStorage.getItem(STORAGE_KEY),
        authedEmail ?? prefillEmail ?? "",
      );
      if (unpacked) restored = unpacked as Partial<OnboardingDataState>;
    } catch {
      // ignore (privacy mode)
    }
    // initialData llega del server con TODAS las keys (varias en undefined).
    // Spreadearlas tal cual pisaría con undefined los valores restaurados del
    // draft — filtramos las ausentes.
    const dbData = Object.fromEntries(
      Object.entries(initialData ?? {}).filter(([, v]) => v !== undefined),
    ) as Partial<OnboardingDataState>;
    setData((prev) => {
      const next = {
        ...prev,
        ...restored,
        ...dbData,
        ...(prefillEmail ? { email: prefillEmail } : {}),
        ...(prefillNombre ? { nombre: prefillNombre } : {}),
      };
      // Tras hidratar, marcar el snapshot resultante como "ya guardado" para
      // que el auto-save no lo persista en el primer ciclo.
      lastSavedSnapshotRef.current = JSON.stringify({ step: stepIdx, data: next });
      hydratedRef.current = true;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persistir cada cambio en localStorage (backup). packDraft excluye
  // `password` (secreto, no debe quedar en disco) y sella el draft con la
  // identidad del dueño (email) para que otro usuario en la misma máquina no
  // lo herede.
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        packDraft(authedEmail ?? data.email, data as unknown as Record<string, unknown>),
      );
    } catch {
      // quota / privacy mode
    }
  }, [data, authedEmail]);

  // ─── Auto-save por step (debounce 800ms) ─────────────────────────────────

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
              // "" = todavía sin elegir (ya no hay preselección) — omitir para
              // no chocar con el z.enum del server.
              rubro: snapshot.rubro || undefined,
              especialidad: snapshot.especialidad || undefined,
              tipo: snapshot.tipo,
              ciudad: snapshot.ciudad,
              provincia: snapshot.provincia,
              direccion: snapshot.direccion,
              telefonoPublico: snapshot.telefonoPublico,
              instagram: snapshot.instagram,
              bio: snapshot.bio,
            });
            break;
          case 4:
            result = await updateOnboardingStep(4, {
              acento: snapshot.acento,
              logoUrl: snapshot.logoUrl,
              cardMood: snapshot.cardMood,
            });
            break;
          case 5: {
            // No mandar al server estados intermedios inválidos (franja recién
            // agregada vacía, fin < inicio mientras edita): el server los
            // rechaza igual, pero acá evitamos el flash de "Reintentar
            // guardar" en cada tecla. El último estado válido queda en DB.
            if (
              snapshot.diasActivos.length === 0 ||
              !validateFranjas(snapshot.franjas).ok
            ) {
              setSaveState({ status: "idle" });
              return;
            }
            result = await updateOnboardingStep(5, {
              diasActivos: snapshot.diasActivos,
              franjas: snapshot.franjas,
              slotMin: snapshot.slotMin,
            });
            break;
          }
          case 6:
            result = await updateOnboardingStep(6, {
              servicios: snapshot.servicios.map((s) => ({
                nombre: s.nombre,
                dur: s.dur,
                precioCents: Math.round(s.precio * 100),
                // Los templates (rubro/especialidad) ya traen el enum correcto;
                // para servicios tipeados a mano lo inferimos por nombre.
                tipoCanonico: s.tipoCanonico ?? inferTipoCanonico(s.nombre),
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
        // Lo que cae acá es una excepción de red o del runtime, con el texto en
        // inglés que le puso el browser ("Failed to fetch", "NetworkError when
        // attempting to fetch resource"). Mostrárselo a alguien que está
        // dando de alta su consultorio no le dice nada y parece que se rompió
        // Folio. El detalle va a la consola, que es donde sirve.
        console.error("[onboarding autosave]", e);
        setSaveState({
          status: "error",
          message: "No pudimos guardar. Revisá tu conexión — tus datos siguen acá.",
        });
      }
    },
    [orgId, orgSlug],
  );

  // Trigger auto-save cuando cambian datos relevantes
  useEffect(() => {
    if (!orgId) return;
    // Steps sin auto-save: 1 (signup), 7 (Google — persiste step_max al montar
    // y su OAuth escribe en `integration`), 8 (moment — finaliza, no edita).
    if (stepIdx === 1 || stepIdx >= 7) return;

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

  // Keyboard (Enter/Esc) vive en StepShell: Enter tiene que invocar el next
  // EFECTIVO del paso (p.ej. handleNext del Step 3 que persiste el slug) y
  // respetar nextDisabled. El listener global anterior llamaba a next()
  // directo y salteaba validación + persist.

  // ─── Step 1: signup (cuenta nueva) o consent-only (Google OAuth) ──────────
  //
  // Si `authedEmail` viene set, el user ya está autenticado (vino por Google
  // OAuth, no tiene password de Supabase). Saltamos signUp y solo creamos
  // la org + profile + member vía bootstrapOrgForAuthenticatedUser.
  // Si no está set, es signup desde cero con email+password.
  const handleStep1Submit = ({
    turnstileToken,
    consent,
  }: {
    turnstileToken: string | null;
    consent: boolean;
  }) => {
    startSignupTransition(async () => {
      const result = authedEmail
        ? await bootstrapOrgForAuthenticatedUser({ turnstileToken, consent })
        : await signUpAndInitOrganization(data.email, data.password, {
            turnstileToken,
            consent,
          });
      if (!result.ok) {
        setError(result.error ?? "Error en signup");
        return;
      }
      if (result.needsConfirmation) {
        // Confirm email ON: la cuenta quedó creada pero sin sesión. El user
        // confirma por email → /api/auth/callback → /onboarding (Step1Consent)
        // y el bootstrap ocurre ahí. Mostramos el panel "Revisá tu email".
        setError(null);
        setAwaitingEmail(data.email);
        return;
      }
      setError(null);
      if (result.organizationId) setOrgId(result.organizationId);
      if (result.slug) setOrgSlug(result.slug);
      setDirection("forward");
      setStepIdx(2);
    });
  };

  // ─── Paso final (8, moment): finalizar ───────────────────────────────────
  // `finalizeDone` habilita "Ir al panel": sin finalize ok, /hoy redirige de
  // vuelta a /onboarding (loop). El moment muestra Reintentar si falló.
  const [finalizeDone, setFinalizeDone] = useState(false);
  const handleFinish = async () => {
    setError(null);
    await flushSaveIfPending();
    const result = await finalizeOnboarding();
    if (!result.ok) {
      setError(result.error ?? "Error al finalizar onboarding");
      return;
    }
    if (result.slug && result.slug !== orgSlug) setOrgSlug(result.slug);
    setFinalizeDone(true);
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

  // Reintento manual del autosave (indicador "Reintentar guardar" clickeable).
  const retrySave = useCallback(() => {
    const step = pendingStepRef.current ?? stepIdx;
    void persistStep(step, data);
  }, [stepIdx, data, persistStep]);

  // Estado real de la integración Google (server) + retorno del OAuth.
  const gcalParam = searchParams.get("gcal");
  const gcalConnected = Boolean(googleConnected) || gcalParam === "ok";
  const gcalError = gcalParam === "error";

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
    planPriceCents,
  };

  // ─── Step 1: layout split con SideArt (mismo del /login) ──────────────────
  if (stepIdx === 1) {
    return (
      <div className="au-app onb-step1-app">
        <SideArt />
        <div className="au-main onb-step1-main">
          <div className="onb-step1-pane">
            <header className="onb-step1-head">
              <div className="onb-app-brand">
                <FolioMark size={24} />
                <span className="onb-brand-name">folio</span>
              </div>
            </header>
            <div key={stepKey} className={`onb-anim onb-anim-${direction}`}>
              {authedEmail ? (
                <Step1Consent
                  email={authedEmail}
                  onSubmit={handleStep1Submit}
                  loading={signingUp}
                  error={error}
                />
              ) : awaitingEmail ? (
                <CheckEmailPanel
                  email={awaitingEmail}
                  onBack={() => setAwaitingEmail(null)}
                />
              ) : (
                <Step1Registro
                  data={{ email: data.email, password: data.password }}
                  set={(patch) => set(patch)}
                  onSubmit={handleStep1Submit}
                  loading={signingUp}
                  error={error}
                  planPriceCents={planPriceCents}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Steps 2-8: layout estándar con PublicCard lateral integrado en StepShell ─
  return (
    <div className="onb-app">
      <header className="onb-app-head">
        <div className="onb-app-brand">
          <FolioMark size={24} />
          <span className="onb-brand-name">folio</span>
        </div>
        {stepIdx < ONB_TOTAL ? (
          <SaveIndicator state={saveState} onRetry={retrySave} />
        ) : (
          <span />
        )}
      </header>

      <main className="onb-app-main">
        {error && stepIdx !== ONB_TOTAL ? (
          <p className="au-err onb-banner-err" role="alert">{error}</p>
        ) : null}

        <div key={stepKey} className={`onb-anim onb-anim-${direction}`}>
          {stepIdx === 2 ? <Step2Profesional {...commonStepProps} /> : null}
          {stepIdx === 3 ? <Step3Consultorio {...commonStepProps} /> : null}
          {stepIdx === 4 ? <Step4Personalizacion {...commonStepProps} /> : null}
          {stepIdx === 5 ? <Step5Horarios {...commonStepProps} /> : null}
          {stepIdx === 6 ? <Step6Servicios {...commonStepProps} /> : null}
          {stepIdx === 7 ? (
            <Step7Google
              {...commonStepProps}
              connected={gcalConnected}
              connectError={gcalError}
            />
          ) : null}
          {stepIdx === 8 ? (
            <Step9Moment
              data={data}
              accent={data.acento}
              slug={orgSlug}
              onFinish={handleFinish}
              onGoToPanel={goToPanel}
              finishing={finishing}
              error={error}
              finalizeOk={finalizeDone}
              planPriceCents={planPriceCents}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}

// ─── Save indicator (header derecho durante steps 2-7) ──────────────────────

function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  // A11y: todas las ramas devuelven un <span> raíz en la misma posición del
  // árbol → React muta el mismo nodo DOM. Declarar aria-live también en el
  // estado idle garantiza que la región exista ANTES de que llegue contenido
  // (un live-region creado junto con su texto no se anuncia).
  if (state.status === "idle") return <span aria-live="polite" role="status" />;
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
      <span style={base} aria-live="polite" role="status">
        <SaveSpinner /> Guardando…
      </span>
    );
  }
  if (state.status === "error") {
    // Antes era un <span> muerto: un autosave fallido (red, constraint) era
    // pérdida de datos silenciosa. Ahora muestra el motivo y reintenta.
    return (
      <span style={{ ...base, color: "var(--red, #9B3A2A)", gap: 8 }} role="alert">
        {state.message ? (
          <span
            style={{
              maxWidth: 260,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={state.message}
          >
            {state.message}
          </span>
        ) : (
          <span>No se pudo guardar.</span>
        )}
        <button
          type="button"
          onClick={onRetry}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            font: "inherit",
            color: "inherit",
            fontWeight: 600,
            textDecoration: "underline",
            cursor: "pointer",
          }}
        >
          Reintentar guardar
        </button>
      </span>
    );
  }
  // saved
  const ago = state.lastSavedAt ? secondsAgo(state.lastSavedAt) : null;
  return (
    <span style={base} aria-live="polite" role="status">
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
