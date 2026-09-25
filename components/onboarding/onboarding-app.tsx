"use client";
import { safeLog } from "@/lib/observability/safe-log";


/**
 * Folio · Onboarding · 8-step wizard (premium architecture).
 *
 * Flow:
 *   - Step 1 (signup) crea auth.user + organization + member en el mismo paso
 *     via signUpAndInitOrganization. Devuelve organizationId + slug provisional.
 *   - Steps 2-5 hacen auto-save por step; Step 6 guarda el catálogo completo
 *     con revisión y una operación reintentable.
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
import { AvailabilityDraft } from "@/lib/agenda/availability-draft";
import { setupHoursWeek, uniformSetupHours } from "@/lib/onboarding/availability";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import {
  bootstrapOrgForAuthenticatedUser,
  deferOnboardingPersonalization,
  finalizeOnboarding,
  signUpAndInitOrganization,
  updateOnboardingStep,
  readOnboardingHorarios,
  readOnboardingServices,
  saveOnboardingServices,
  type OnboardingServicesSnapshot,
} from "@/app/(public)/onboarding/actions";
import { CheckEmailPanel } from "@/components/auth/check-email-panel";
import { SideArt } from "@/components/auth/side-art";
import { FolioMark } from "@/components/folio-mark";
import { packDraft, unpackDraft } from "@/lib/onboarding/draft";
import { validateFranjas } from "@/lib/onboarding/franjas";
import { Step1Consent } from "@/components/onboarding/step1-consent";
import { Step1Registro } from "@/components/onboarding/step1-registro";
import { Step1Choice } from "@/components/onboarding/step1-choice";
import { parseOnboardingIntent } from "@/lib/onboarding/intent";
import { OnboardingServicesDraft, beginServicesFlight, parseStoredServicesCommand, storeServicesCommand } from "@/lib/onboarding/services-draft";
import { TIPOS_CANONICOS_VALIDOS } from "@/lib/onboarding/templates";
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
const INTENT_KEY = "folio:onboarding:intent";
const AUTOSAVE_DEBOUNCE_MS = 800;
const servicesKey = (organizationId: string) => `folio:onboarding:services:${organizationId}`;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function servicesForEditor(rows: OnboardingServicesSnapshot["servicios"]): OnboardingDataState["servicios"] {
  return rows.map((row) => ({ id: row.id, nombre: row.nombre, dur: row.dur,
    precio: row.precioCents / 100, tipoCanonico: row.tipoCanonico }));
}

type CanonicalService = OnboardingServicesSnapshot["servicios"][number]["tipoCanonico"];
function servicesForCommand(rows: OnboardingDataState["servicios"]): OnboardingServicesSnapshot["servicios"] {
  return rows.map((row) => ({ id: row.id, nombre: row.nombre, dur: row.dur,
    precioCents: Math.round(row.precio * 100), tipoCanonico: row.tipoCanonico && TIPOS_CANONICOS_VALIDOS.includes(row.tipoCanonico as CanonicalService)
      ? row.tipoCanonico as CanonicalService : inferTipoCanonico(row.nombre) }));
}

const TIPO_CANONICO_MAP: Record<string, CanonicalService> = {
  "consulta inicial":  "CONSULTA_INICIAL",
  "seguimiento":       "SEGUIMIENTO_ESTANDAR",
  "pack 5 sesiones":   "PACK_SESIONES",
  "deportiva":         "SERVICIO_ESPECIALIZADO",
};

function inferTipoCanonico(nombre: string): CanonicalService {
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
  /** Identidad Auth verificada en el servidor; sólo particiona el intento local. */
  authedUserId?: string;
  /**
   * Precio del plan Solo en centavos ARS. Lo lee el server component
   * (app/(public)/onboarding/page.tsx) de MP_PLAN_PRICE_CENTS — fuente
   * canónica del cobro real — y lo baja acá para que Step 1 y el moment
   * muestren el mismo monto que se va a debitar (nunca un hardcode que driftee).
   */
  soloPriceCents: number;
  clinicPriceCents: number;
  clinicSeatPriceCents: number;
  /**
   * true si el member ya tiene la integración GOOGLE_CALENDAR (leído
   * server-side). El Step 7 lo usa para renderizar "Conectado ✓" en vez del
   * botón de conectar.
   */
  googleConnected?: boolean;
  /** Only the isolated, development-only flow fixture may simulate persistence. */
  syntheticFixture?: boolean;
  syntheticHoursDelayMs?: number;
  syntheticStep4Failure?: boolean;
}

interface SaveState {
  status: "idle" | "unsaved" | "saving" | "saved" | "error";
  lastSavedAt?: number;
  message?: string;
}

export function OnboardingApp({
  initialStep,
  initialData,
  organizationId,
  initialSlug,
  authedEmail,
  authedUserId,
  soloPriceCents,
  clinicPriceCents,
  clinicSeatPriceCents,
  googleConnected,
  syntheticFixture = false,
  syntheticHoursDelayMs = 0,
  syntheticStep4Failure = false,
}: OnboardingAppProps) {
  const synthetic = syntheticFixture && process.env.NODE_ENV !== "production";
  const router = useRouter();
  const searchParams = useSearchParams();
  // Clamp: datos legacy (wizard de 9 pasos) pueden traer initialStep=9.
  const [stepIdx, setStepIdx] = useState(Math.min(initialStep ?? 1, ONB_TOTAL));
  const [data, setData] = useState<OnboardingDataState>(ONBOARDING_INITIAL);
  const [orgId, setOrgId] = useState<string | undefined>(organizationId);
  const [orgSlug, setOrgSlug] = useState<string | undefined>(initialSlug);
  const [ownerUserId, setOwnerUserId] = useState<string | undefined>(authedUserId);
  const [finishing, startTransition] = useTransition();
  const [signingUp, startSignupTransition] = useTransition();
  const signupInFlightRef = useRef(false);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  // Ítem 1.5: con "Confirm email" ON, signUpAndInitOrganization devuelve
  // needsConfirmation (sin sesión ni org). Guardamos el email para mostrar
  // el panel "Revisá tu email" en lugar del form de registro.
  const [awaitingEmail, setAwaitingEmail] = useState<string | null>(null);
  // Every return from email verification/OAuth reconfirms an unpersisted intent.
  const [choiceConfirmed, setChoiceConfirmed] = useState(Boolean(organizationId));
  const [recoverableDraft, setRecoverableDraft] = useState<Partial<OnboardingDataState> | null>(null);
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const recoveryPendingRef = useRef(false);
  const restoredHoursRef = useRef(false);
  const finalizedRef = useRef(false);

  // ─── Auto-save refs declarados antes del useEffect de hidratación porque
  //     la hidratación los inicializa para evitar un auto-save espurio
  //     inmediatamente después del primer render. ───────────────────────────
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedSnapshotRef = useRef<string>("");
  const pendingStepRef = useRef<number | null>(null);
  const activeSaveRef = useRef<Promise<boolean> | null>(null);
  const nextFlightRef = useRef(false);
  const savedAccentRef = useRef(typeof initialData?.acento === "string" ? initialData.acento : ONBOARDING_INITIAL.acento);

  // Hidratación: prioriza initialData (DB) > localStorage > URL params.
  // Importante: NUNCA restauramos `password` del localStorage. Es secret + no
  // queremos mostrar la contraseña de un signup previo en la pantalla del
  // siguiente user en la misma máquina.
  //
  // `hydratedRef` evita que el primer setData (la hidratación) dispare el
  // auto-save effect — sin esto, al volver al wizard tras reload, el cliente
  // volvería a escribir los datos recién leídos. Marcamos el snapshot inicial
  // como "ya guardado".
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
    const prefillEmail = !authedEmail && !organizationId ? searchParams.get("email") : null;
    const prefillNombre = !authedEmail && !organizationId ? searchParams.get("nombre") : null;
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
        organizationId,
      );
      if (unpacked) {
        if (organizationId) {
          recoveryPendingRef.current = true;
          setRecoverableDraft(unpacked as Partial<OnboardingDataState>);
        }
        else restored = unpacked as Partial<OnboardingDataState>;
      }
    } catch {
      // ignore (privacy mode)
    }
    // initialData llega del server con TODAS las keys (varias en undefined).
    // Spreadearlas tal cual pisaría con undefined los valores restaurados del
    // draft — filtramos las ausentes.
    const dbData = Object.fromEntries(
      Object.entries(initialData ?? {}).filter(([, v]) => v !== undefined),
    ) as Partial<OnboardingDataState>;
    let intent: Partial<OnboardingDataState> = {};
    if (!organizationId) {
      try { intent = parseOnboardingIntent(sessionStorage.getItem(INTENT_KEY)) ?? {}; } catch { /* disabled storage */ }
    }
    setData((prev) => {
      const next = {
        ...prev,
        ...restored,
        ...intent,
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
    setRecoveryChecked(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!data.tipo || data.ownerTratante === null || orgId) return;
    try { sessionStorage.setItem(INTENT_KEY, JSON.stringify({ tipo: data.tipo, ownerTratante: data.ownerTratante })); } catch { /* disabled storage */ }
  }, [data.tipo, data.ownerTratante, orgId]);

  // Persistir cada cambio en localStorage (backup). packDraft excluye
  // `password` (secreto, no debe quedar en disco) y sella el draft con la
  // identidad del dueño (email) para que otro usuario en la misma máquina no
  // lo herede.
  useEffect(() => {
    if (finalizedRef.current || recoveryPendingRef.current || recoverableDraft) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        packDraft(authedEmail ?? data.email, data as unknown as Record<string, unknown>, orgId),
      );
    } catch {
      // quota / privacy mode
    }
  }, [data, authedEmail, orgId, recoverableDraft]);

  const hoursRef = useRef<AvailabilityDraft | null>(null);
  const hoursFlightRef = useRef<Promise<boolean> | null>(null);
  const hoursSavedRef = useRef(false);
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [, redrawHours] = useState(0);
  const servicesRef = useRef<OnboardingServicesDraft | null>(null);
  const servicesFlightRef = useRef<Promise<boolean> | null>(null);
  const servicesProgressSavedRef = useRef((initialStep ?? 1) >= 6);
  const [servicesStatus, setServicesStatus] = useState<"loading" | "ready" | "error" | "uncertain" | "conflict">("loading");
  const [servicesMessage, setServicesMessage] = useState<string | null>(null);
  const [persistedServices, setPersistedServices] = useState(false);

  useEffect(() => {
    if (stepIdx !== 6 || !orgId || recoverableDraft) return;
    let cancelled = false;
    servicesRef.current = null;
    setServicesStatus("loading");
    setServicesMessage(null);
    const read = synthetic
      ? Promise.resolve({ ok: true as const, data: { revision: 0, servicios: servicesForCommand(data.servicios) } })
      : readOnboardingServices(orgId);
    void read.then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setServicesStatus("error");
        setServicesMessage("No pudimos leer los servicios guardados. Volvé a cargar para continuar.");
        return;
      }
      let pending = null;
      try { pending = parseStoredServicesCommand(sessionStorage.getItem(servicesKey(orgId)), orgId, ownerUserId ?? ""); }
      catch { /* el guardado nuevo exige almacenamiento disponible */ }
      const draft = new OnboardingServicesDraft(orgId, result.data, pending ?? undefined);
      if (!pending && result.data.servicios.length === 0 && data.ownerTratante !== false && data.servicios.length > 0) {
        // Drafts previos al catálogo versionado tenían IDs numéricos locales.
        // Sin filas guardadas se pueden reemplazar sin alterar ninguna identidad en DB.
        const local = data.servicios.map((row) => ({ ...row, id: uuidPattern.test(String(row.id)) ? row.id : crypto.randomUUID() }));
        draft.edit(servicesForCommand(local));
        setData((current) => ({ ...current, servicios: local }));
      }
      servicesRef.current = draft;
      setPersistedServices(result.data.servicios.length > 0 || Boolean(pending));
      if (pending) {
        setData((current) => ({ ...current, servicios: servicesForEditor(draft.rows) }));
        setServicesStatus("uncertain");
        setServicesMessage("No pudimos confirmar un guardado anterior. Verificá ese mismo cambio antes de editar.");
      } else {
        if (result.data.servicios.length > 0 || data.ownerTratante === false)
          setData((current) => ({ ...current, servicios: servicesForEditor(result.data.servicios) }));
        setServicesStatus("ready");
      }
    }).catch(() => {
      if (!cancelled) {
        setServicesStatus("error");
        setServicesMessage("No pudimos leer los servicios guardados. Volvé a cargar para continuar.");
      }
    });
    return () => { cancelled = true; };
    // Se lee una vez por entrada al Paso 6; las ediciones posteriores no deben disparar otra lectura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIdx, orgId, synthetic, ownerUserId, recoverableDraft]);
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    let syntheticTimer: ReturnType<typeof setTimeout> | null = null;
    hoursRef.current = null; hoursSavedRef.current = false;
    const read = synthetic
      ? new Promise<Awaited<ReturnType<typeof readOnboardingHorarios>>>((resolve) => {
        syntheticTimer = setTimeout(() => resolve({ ok: true, data: {
          context: { organizationId: orgId, memberId: "folio-test-owner", revision: 0, protectedDates: false },
          dias: setupHoursWeek(ONBOARDING_INITIAL.diasActivos, ONBOARDING_INITIAL.franjas),
        } }), syntheticHoursDelayMs);
      })
      : readOnboardingHorarios(orgId);
    void read.then((result) => {
      if (cancelled) return;
      if (!result.ok) { setHoursError(result.error.message); return; }
      const uniform = uniformSetupHours(result.data);
      if (!uniform) { setHoursError("Hay horarios con fechas o franjas diferentes por día. Necesitan una revisión antes de continuar."); return; }
      hoursRef.current = new AvailabilityDraft(result.data);
      if (uniform.diasActivos.length && !recoveryPendingRef.current && !restoredHoursRef.current)
        setData((prev) => ({ ...prev, ...uniform }));
      setHoursError(null); redrawHours((n) => n + 1);
    }).catch(() => { if (!cancelled) setHoursError("No pudimos leer los horarios. Volvé a cargar para intentarlo."); });
    return () => { cancelled = true; if (syntheticTimer) clearTimeout(syntheticTimer); };
  }, [orgId, synthetic, syntheticHoursDelayMs]);

  const persistInitialHours = useCallback((snapshot: OnboardingDataState): Promise<boolean> => {
    if (synthetic) {
      setSaveState({ status: "saved", lastSavedAt: Date.now() });
      return Promise.resolve(true);
    }
    if (hoursFlightRef.current) return hoursFlightRef.current;
    const hours = hoursRef.current;
    if (!hours || hours.context.organizationId !== orgId) { setHoursError("No pudimos leer la agenda actual. Volvé a cargar los horarios."); return Promise.resolve(false); }
    if (!snapshot.diasActivos.length || !validateFranjas(snapshot.franjas).ok) return Promise.resolve(false);
    const week = setupHoursWeek(snapshot.diasActivos, snapshot.franjas);
    if (hoursSavedRef.current && !hours.dirty && !hours.conflict && JSON.stringify(week) === JSON.stringify(hours.dias)) return Promise.resolve(true);
    hours.edit(week);
    const command = hours.begin(crypto.randomUUID());
    if (!command) { setHoursError("Los horarios cambiaron. Cargá los guardados antes de continuar."); return Promise.resolve(false); }
    const active = Object.entries(command.dias).filter(([,day]) => day?.on);
    setSaveState({ status: "saving" }); redrawHours((n) => n + 1);
    const pending = (async () => {
      try {
        const result = await updateOnboardingStep(5, { organizationId: command.organizationId, memberId: command.memberId, revision: command.revision, operacionId: command.operacionId,
          diasActivos: active.map(([day]) => day), franjas: active[0][1]!.franjas, slotMin: snapshot.slotMin });
        if (!result.ok || result.revision === undefined) {
          hours.finish({ ok: false, error: { code: result.code ?? "db_error", message: result.error ?? "No pudimos confirmar el guardado." } });
          setSaveState({ status: "error", message: result.error });
          if (hours.conflict) setHoursError("Los horarios cambiaron. Cargá los guardados antes de continuar.");
          return false;
        }
        hours.finish({ ok: true, data: { revision: result.revision, count: active.length } }); hoursSavedRef.current = true;
        setSaveState({ status: "saved", lastSavedAt: Date.now() }); setHoursError(null); return true;
      } catch {
        hours.finish({ ok: false, error: { code: "network", message: "Conexión interrumpida" } });
        setSaveState({ status: "error", message: "No pudimos confirmar el guardado. Reintentá el mismo cambio." }); return false;
      } finally { hoursFlightRef.current = null; redrawHours((n) => n + 1); }
    })();
    hoursFlightRef.current = pending;
    return pending;
  }, [orgId, synthetic]);

  const persistServices = useCallback((allowRetry = false): Promise<boolean> => {
    if (servicesFlightRef.current) return servicesFlightRef.current;
    const draft = servicesRef.current;
    if (!draft || draft.organizationId !== orgId || !ownerUserId || servicesStatus === "loading" || servicesStatus === "error") return Promise.resolve(false);
    if (draft.conflict) {
      setServicesStatus("conflict");
      setServicesMessage("Los servicios cambiaron. Cargá los guardados antes de continuar.");
      return Promise.resolve(false);
    }
    if (draft.uncertain && !allowRetry) return Promise.resolve(false);
    if (!draft.dirty && servicesProgressSavedRef.current && !draft.uncertain) return Promise.resolve(true);
    const prior = draft.attemptedCommand;
    const command = draft.begin(crypto.randomUUID(), { retry: allowRetry, force: !servicesProgressSavedRef.current });
    if (!command) return Promise.resolve(false);
    if (!prior) {
      try { sessionStorage.setItem(servicesKey(command.organizationId), storeServicesCommand(command, ownerUserId)); }
      catch {
        draft.finish({ ok: false, uncertain: false, conflict: false });
        setSaveState({ status: "error", message: "No pudimos preparar el guardado. Habilitá almacenamiento del navegador y reintentá." });
        return Promise.resolve(false);
      }
    }
    setSaveState({ status: "saving" });
    return beginServicesFlight(servicesFlightRef, async () => {
      try {
        const result = synthetic
          ? { ok: true as const, data: { revision: command.revision + 1, servicios: command.servicios } }
          : await saveOnboardingServices(command);
        if (result.ok) {
          draft.finish({ ok: true, data: result.data });
          try { sessionStorage.removeItem(servicesKey(command.organizationId)); } catch { /* no cambia el recibo */ }
          setData((current) => ({ ...current, servicios: servicesForEditor(draft.rows) }));
          if (draft.conflict) {
            setServicesStatus("conflict");
            setServicesMessage("Los servicios cambiaron después de tu guardado. Cargá los guardados antes de continuar.");
            setSaveState({ status: "error", message: "Cargá los servicios guardados." });
            return false;
          }
          servicesProgressSavedRef.current = true;
          setPersistedServices(draft.rows.length > 0);
          setServicesStatus("ready"); setServicesMessage(null);
          setSaveState({ status: "saved", lastSavedAt: Date.now() });
          return true;
        }
        const uncertain = result.error.mutationOutcome === "uncertain";
        const conflict = result.error.code === "conflict";
        draft.finish({ ok: false, uncertain, conflict });
        if (!uncertain) try { sessionStorage.removeItem(servicesKey(command.organizationId)); } catch { /* no cambia el resultado */ }
        setServicesStatus(uncertain ? "uncertain" : conflict ? "conflict" : "ready");
        setServicesMessage(uncertain
          ? "No pudimos confirmar el guardado. Verificá el mismo cambio antes de editar."
          : conflict ? "Los servicios cambiaron. Cargá los guardados antes de continuar." : result.error.message);
        setSaveState({ status: "error", message: uncertain ? "Verificar guardado" : result.error.message });
        return false;
      } catch {
        draft.finish({ ok: false, uncertain: true, conflict: false });
        setServicesStatus("uncertain");
        setServicesMessage("No pudimos confirmar el guardado. Verificá el mismo cambio antes de editar.");
        setSaveState({ status: "error", message: "Verificar guardado" });
        return false;
      }
    });
  }, [orgId, ownerUserId, servicesStatus, synthetic]);

  // ─── Auto-save por step (debounce 800ms) ─────────────────────────────────

  const persistStep = useCallback(
    async (step: number, snapshot: OnboardingDataState): Promise<boolean> => {
      if (!orgId) return false;
      if (step === 6) return persistServices();
      if (synthetic) {
        if (step === 4 && syntheticStep4Failure) {
          setSaveState({ status: "error", message: "Ejemplo: no pudimos guardar el avance. Reintentá." });
          return false;
        }
        try { sessionStorage.setItem("folio:onboarding:synthetic-save", JSON.stringify({ step, data: snapshot })); } catch { /* isolated fixture */ }
        setSaveState({ status: "saved", lastSavedAt: Date.now() });
        return true;
      }
      if (step === 5) return persistInitialHours(snapshot);
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
            });
            break;
          default:
            setSaveState({ status: "idle" });
            return true;
        }
        if (result.ok) {
          if (step === 3 && result.slug && result.slug !== orgSlug) {
            setOrgSlug(result.slug);
          }
          setSaveState({ status: "saved", lastSavedAt: Date.now() });
          return true;
        } else {
          setSaveState({ status: "error", message: result.error });
          return false;
        }
      } catch (e) {
        // Lo que cae acá es una excepción de red o del runtime, con el texto en
        // inglés que le puso el browser ("Failed to fetch", "NetworkError when
        // attempting to fetch resource"). Mostrárselo a alguien que está
        // dando de alta su consultorio no le dice nada y parece que se rompió
        // Folio. El detalle va a la consola, que es donde sirve.
        safeLog("error", "components.onboarding.onboarding.app.L337", "[onboarding autosave]", e);
        setSaveState({
          status: "error",
          message: "No pudimos guardar. Revisá tu conexión — tus datos siguen acá.",
        });
        return false;
      }
    },
    [orgId, orgSlug, persistInitialHours, persistServices, synthetic, syntheticStep4Failure],
  );

  const runPersistStep = useCallback((step: number, snapshot: OnboardingDataState): Promise<boolean> => {
    const prior = activeSaveRef.current;
    const work = prior ? prior.then(() => persistStep(step, snapshot)) : persistStep(step, snapshot);
    activeSaveRef.current = work;
    void work.then((saved) => {
      if (saved && pendingStepRef.current === step) pendingStepRef.current = null;
    }).finally(() => {
      if (activeSaveRef.current === work) activeSaveRef.current = null;
    });
    return work;
  }, [persistStep]);

  // Trigger auto-save cuando cambian datos relevantes
  useEffect(() => {
    if (finalizedRef.current || recoveryPendingRef.current || recoverableDraft) return;
    if (!orgId) return;
    // Steps sin auto-save: 1 (signup), 7 (Google — persiste step_max al montar
    // y su OAuth escribe en `integration`), 8 (moment — finaliza, no edita).
    if (stepIdx === 1 || stepIdx === 4 || stepIdx >= 7) return;
    if (stepIdx === 6 && (servicesStatus !== "ready" || !servicesRef.current || servicesRef.current.locked)) return;

    const snapshot = JSON.stringify({ step: stepIdx, data });
    if (snapshot === lastSavedSnapshotRef.current) return;
    lastSavedSnapshotRef.current = snapshot;
    pendingStepRef.current = stepIdx;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void runPersistStep(stepIdx, data);
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [data, stepIdx, orgId, runPersistStep, recoverableDraft, servicesStatus]);

  const set = (patch: Partial<OnboardingDataState>) => {
    if (stepIdx === 5 && (!hoursRef.current || hoursRef.current.locked || hoursError)) return;
    if (stepIdx === 6 && patch.servicios !== undefined) {
      if (servicesStatus !== "ready" || !servicesRef.current?.edit(servicesForCommand(patch.servicios))) return;
    }
    if (stepIdx === 4 && patch.acento !== undefined) setSaveState({ status: patch.acento === savedAccentRef.current ? "idle" : "unsaved" });
    setData((prev) => ({ ...prev, ...patch }));
  };

  const flushSaveIfPending = useCallback(async (): Promise<boolean> => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (pendingStepRef.current !== null && orgId)
      return runPersistStep(pendingStepRef.current, data);
    return activeSaveRef.current ? activeSaveRef.current : true;
  }, [data, orgId, runPersistStep]);

  const next = useCallback(() => {
    if (nextFlightRef.current) return;
    nextFlightRef.current = true;
    if (stepIdx === 4) {
      void (async () => {
        if (!await flushSaveIfPending()) return;
        if (!await runPersistStep(4, data)) return;
        savedAccentRef.current = data.acento;
        setError(null);
        setDirection("forward");
        setStepIdx(data.ownerTratante === false ? 6 : 5);
      })().finally(() => { nextFlightRef.current = false; });
      return;
    }
    if (stepIdx === 5) {
      if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
      void persistInitialHours(data).then((saved) => { if (saved) { setDirection("forward"); setStepIdx(6); } }).finally(() => { nextFlightRef.current = false; }); return;
    }
    if (stepIdx === 6) {
      void (async () => {
        if (!await flushSaveIfPending()) return;
        if (!await persistServices()) return;
        setDirection("forward");
        setStepIdx(data.ownerTratante === false ? 8 : 7);
      })().finally(() => { nextFlightRef.current = false; });
      return;
    }
    void flushSaveIfPending().then((saved) => {
      if (saved) {
        setDirection("forward");
        setStepIdx((n) => Math.min(ONB_TOTAL, n === 4 && data.ownerTratante === false ? 6 : n === 6 && data.ownerTratante === false ? 8 : n + 1));
      }
    }).finally(() => { nextFlightRef.current = false; });
  }, [flushSaveIfPending, stepIdx, persistInitialHours, persistServices, runPersistStep, data]);

  const back = useCallback(() => {
    if (stepIdx === 5) {
      if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
      void persistInitialHours(data).then((saved) => { if (saved) { setDirection("back"); setStepIdx(4); } }); return;
    }
    if (stepIdx === 6) {
      void (async () => {
        if (!await flushSaveIfPending()) return;
        if (!await persistServices()) return;
        setDirection("back");
        setStepIdx(data.ownerTratante === false ? 4 : 5);
      })();
      return;
    }
    setDirection("back");
    void flushSaveIfPending();
    setStepIdx((n) => Math.max(1, n === 6 && data.ownerTratante === false ? 4 : n === 8 && data.ownerTratante === false ? 6 : n - 1));
  }, [flushSaveIfPending, stepIdx, persistInitialHours, persistServices, data]);

  const skip = useCallback(() => {
    if (stepIdx !== 4) { next(); return; }
    if (nextFlightRef.current) return;
    nextFlightRef.current = true;
    void (async () => {
      if (!await flushSaveIfPending()) return;
      const result = synthetic
        ? { ok: true as const }
        : orgId ? await deferOnboardingPersonalization(orgId) : { ok: false as const, error: "No encontramos el consultorio. Volvé a cargar la página." };
      if (!result.ok) {
        setError(result.error ?? "No pudimos guardar el avance. Reintentá.");
        return;
      }
      if (synthetic) {
        try { sessionStorage.setItem("folio:onboarding:synthetic-deferred", "true"); } catch { /* isolated fixture */ }
      }
      // El texto del botón avisa si se descarta un color pendiente. No escribe
      // color, logo ni mood; el logo sólo cambia por su propio botón de subida.
      setData((current) => ({ ...current, acento: savedAccentRef.current }));
      setSaveState({ status: "idle" });
      setError(null);
      setDirection("forward");
      setStepIdx(data.ownerTratante === false ? 6 : 5);
    })().finally(() => { nextFlightRef.current = false; });
  }, [stepIdx, next, flushSaveIfPending, data.ownerTratante, synthetic, orgId]);

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
    if (!data.tipo || data.ownerTratante === null || !choiceConfirmed) {
      setError("Confirmá la modalidad y el rol del titular antes de continuar.");
      setChoiceConfirmed(false);
      return;
    }
    if (signupInFlightRef.current) return;
    signupInFlightRef.current = true;
    startSignupTransition(async () => {
      try {
        const result = authedEmail
          ? await bootstrapOrgForAuthenticatedUser({ turnstileToken, consent, choice: { tipo: data.tipo!, ownerTratante: data.ownerTratante! } })
          : await signUpAndInitOrganization(data.email, data.password, {
              turnstileToken,
              consent,
              choice: { tipo: data.tipo!, ownerTratante: data.ownerTratante! },
            });
        if (!result.ok) {
          setError(result.error ?? "No pude confirmar el registro. Verificá tu cuenta antes de reintentar.");
          setCaptchaResetKey((value) => value + 1);
          return;
        }
        if (result.needsConfirmation) {
          setError(null);
          setAwaitingEmail(data.email);
          return;
        }
        setError(null);
        if (result.organizationId) setOrgId(result.organizationId);
        if (result.userId) setOwnerUserId(result.userId);
        if (result.slug) setOrgSlug(result.slug);
        if (result.tipo) setData((prev) => ({ ...prev, tipo: result.tipo!, ownerTratante: result.ownerTratante ?? prev.ownerTratante }));
        try { sessionStorage.removeItem(INTENT_KEY); } catch { /* disabled storage */ }
        if (result.existingAccount) { router.refresh(); return; }
        setDirection("forward");
        setStepIdx(2);
      } catch {
        setError("No pudimos confirmar si la cuenta se creó. Si ya tenés cuenta, entrá; si no, reintentá la verificación.");
        setCaptchaResetKey((value) => value + 1);
      } finally {
        signupInFlightRef.current = false;
      }
    });
  };

  // ─── Paso final (8, moment): finalizar ───────────────────────────────────
  // `finalizeDone` habilita "Ir al panel": sin finalize ok, /hoy redirige de
  // vuelta a /onboarding (loop). El moment muestra Reintentar si falló.
  const [finalizeDone, setFinalizeDone] = useState(false);
  const [publicReady, setPublicReady] = useState(false);
  const handleFinish = async () => {
    setError(null);
    if (!await flushSaveIfPending()) {
      setError("No pudimos confirmar el último guardado. Revisá los datos y reintentá antes de terminar.");
      return;
    }
    const result = synthetic
      ? { ok: true, slug: orgSlug, publicReady: data.ownerTratante === true && !!data.consultorioNombre && !!data.ciudad && !!data.rubro && data.servicios.length > 0 && data.diasActivos.length > 0 }
      : await finalizeOnboarding();
    if (!result.ok) {
      setError(result.error ?? "Error al finalizar onboarding");
      return;
    }
    if (result.slug && result.slug !== orgSlug) setOrgSlug(result.slug);
    setPublicReady(Boolean(result.publicReady));
    finalizedRef.current = true;
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
    if (stepIdx === 6) { void persistServices(true); return; }
    const step = pendingStepRef.current ?? stepIdx;
    void runPersistStep(step, data).then((saved) => {
      if (saved && step === 4) savedAccentRef.current = data.acento;
    });
  }, [stepIdx, data, persistServices, runPersistStep]);

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
    savedAccent: savedAccentRef.current,
    orgId,
    orgSlug,
    direction,
    planPriceCents: data.tipo === "CLINICA" ? clinicPriceCents : soloPriceCents,
  };

  // ─── Step 1: layout split con SideArt (mismo del /login) ──────────────────
  if (stepIdx === 1) {
    return (
      <div className="au-app onb-step1-app fx-onboarding">
        <SideArt />
        <main className="au-main onb-step1-main">
          <div className="onb-step1-pane">
            <header className="onb-step1-head">
              <Link className="onb-app-brand fx-auth-brand" href="/" aria-label="Folio, volver al inicio">
                <FolioMark size={24} />
                <span className="onb-brand-name">folio</span>
              </Link>
              <Link className="onb-home-link" href="/">← Volver al inicio</Link>
            </header>
            <div key={stepKey} className={`onb-anim onb-anim-${direction}`}>
              {!choiceConfirmed && !awaitingEmail ? <Step1Choice
                data={data} set={set} onContinue={() => setChoiceConfirmed(true)}
                soloPriceCents={soloPriceCents} clinicPriceCents={clinicPriceCents}
                clinicSeatPriceCents={clinicSeatPriceCents}
              /> : authedEmail ? (
                <Step1Consent
                  email={authedEmail}
                  onSubmit={handleStep1Submit}
                  onBack={() => setChoiceConfirmed(false)}
                  compactFlow={data.ownerTratante === false}
                  clinicFlow={data.tipo === "CLINICA"}
                  loading={signingUp}
                  error={error}
                  captchaResetKey={captchaResetKey}
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
                  onBack={() => setChoiceConfirmed(false)}
                  compactFlow={data.ownerTratante === false}
                  loading={signingUp}
                  error={error}
                  planPriceCents={data.tipo === "CLINICA" ? clinicPriceCents : soloPriceCents}
                  clinicSeatPriceCents={data.tipo === "CLINICA" ? clinicSeatPriceCents : undefined}
                  captchaResetKey={captchaResetKey}
                />
              )}
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ─── Steps 2-8: layout estándar con PublicCard lateral integrado en StepShell ─
  return (
    <div className="onb-app fx-onboarding">
      <header className="onb-app-head">
        <Link className="onb-app-brand fx-auth-brand" href="/" aria-label="Folio, volver al inicio">
          <FolioMark size={24} />
          <span className="onb-brand-name">folio</span>
        </Link>
        <Link className="onb-home-link" href="/">← Volver al inicio</Link>
        {stepIdx < ONB_TOTAL ? (
          <SaveIndicator state={stepIdx === 4 && data.acento !== savedAccentRef.current && saveState.status !== "saving" && saveState.status !== "error" ? { status: "unsaved" } : saveState} onRetry={retrySave} />
        ) : (
          <span />
        )}
      </header>

      <main className="onb-app-main">
        {recoverableDraft ? <div className="onb-recovery" role="status">
          <p>Hay cambios locales de esta organización sin confirmar. Elegí cuál versión usar antes de continuar.</p>
          <button type="button" onClick={() => {
            const { tipo: _tipo, ownerTratante: _owner, email: _email, password: _password, ...editable } = recoverableDraft;
            void _tipo; void _owner; void _email; void _password;
            const hasLocalHours = "diasActivos" in editable || "franjas" in editable || "slotMin" in editable;
            restoredHoursRef.current = hasLocalHours;
            const hours = hoursRef.current;
            const savedHours = !hasLocalHours && hours
              ? uniformSetupHours({ context: hours.context, dias: hours.dias }) : null;
            setData((current) => ({ ...current, ...editable,
              ...(savedHours?.diasActivos.length ? savedHours : {}) }));
            setDirection("back");
            setStepIdx(2);
            recoveryPendingRef.current = false;
            setRecoverableDraft(null);
          }}>Restaurar y revisar mis cambios</button>
          <button type="button" onClick={() => {
            recoveryPendingRef.current = false;
            const hours = hoursRef.current;
            if (hours) {
              const uniform = uniformSetupHours({ context: hours.context, dias: hours.dias });
              if (uniform?.diasActivos.length) setData((current) => ({ ...current, ...uniform }));
            }
            setRecoverableDraft(null);
          }}>Usar la versión guardada</button>
        </div> : null}
        {error && stepIdx !== ONB_TOTAL ? (
          <p className="au-err onb-banner-err" role="alert">{error}</p>
        ) : null}

        {!recoveryChecked ? <p role="status">Preparando tus datos guardados…</p> : recoverableDraft ? <p role="status">Resolvé los cambios pendientes para continuar el alta.</p> : <div key={stepKey} className={`onb-anim onb-anim-${direction}`}>
          {stepIdx === 2 ? <Step2Profesional {...commonStepProps} back={undefined} /> : null}
          {stepIdx === 3 ? <Step3Consultorio {...commonStepProps} /> : null}
          {stepIdx === 4 ? <Step4Personalizacion {...commonStepProps} /> : null}
          {stepIdx === 5 ? <>
            {hoursError ? <p role="alert">{hoursError} <button type="button" className="fi-btn" onClick={() => window.location.reload()}>Cargar horarios guardados</button></p> : null}
            {!hoursRef.current && !hoursError ? <p role="status">Leyendo horarios…</p> : null}
            <fieldset disabled={!hoursRef.current || hoursRef.current.locked || !!hoursError} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><Step5Horarios {...commonStepProps} /></fieldset>
          </> : null}
          {stepIdx === 6 ? <>
            {servicesMessage ? <p className="au-err onb-banner-err" role="alert">{servicesMessage}</p> : null}
            {servicesStatus === "loading" ? <p role="status">Leyendo servicios guardados…</p> : null}
            {servicesStatus === "error" || servicesStatus === "conflict" ?
              <button type="button" className="fi-btn" onClick={() => window.location.reload()}>Cargar servicios guardados</button> : null}
            {servicesStatus === "uncertain" ?
              <button type="button" className="fi-btn" onClick={() => void persistServices(true)}>Verificar guardado</button> : null}
            {servicesStatus !== "loading" && servicesStatus !== "error" ?
              <Step6Servicios {...commonStepProps} persistedServices={persistedServices} servicesLocked={servicesStatus !== "ready" || Boolean(servicesRef.current?.locked)} /> : null}
          </> : null}
          {stepIdx === 7 ? (
            <Step7Google
              {...commonStepProps}
              connected={gcalConnected}
              connectError={gcalError}
              syntheticFixture={synthetic}
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
              publicReady={publicReady}
              planPriceCents={data.tipo === "CLINICA" ? clinicPriceCents : soloPriceCents}
              clinicSeatPriceCents={clinicSeatPriceCents}
            />
          ) : null}
        </div>}
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
  if (state.status === "unsaved") return <span aria-live="polite" role="status" style={{ color: "var(--ink-2)", fontSize: 12 }}>Color sin guardar</span>;
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
