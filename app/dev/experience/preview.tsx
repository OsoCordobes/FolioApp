"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Component, Suspense, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";

import { PortalNav } from "@/app/(portal)/portal/(tabs)/portal-nav";
import { PerfilList } from "@/app/(portal)/portal/(tabs)/perfil/perfil-list";
import { ResumenView } from "@/app/(portal)/portal/(tabs)/resumen/resumen-view";
import { TurnosList } from "@/app/(portal)/portal/(tabs)/turnos/turnos-list";
import { Calendario } from "@/components/calendario/calendario";
import { Configuracion } from "@/components/configuracion/configuracion";
import { Finanzas } from "@/components/finanzas/finanzas";
import { FolioMark } from "@/components/folio-mark";
import { Dashboard } from "@/components/hoy/dashboard";
import { MobileNav } from "@/components/mobile-nav";
import { MotionProvider } from "@/components/motion/motion-provider";
import { OnboardingApp } from "@/components/onboarding/onboarding-app";
import { ONBOARDING_INITIAL, type OnboardingDataState } from "@/components/onboarding/steps";
import { Step9Moment } from "@/components/onboarding/step9-moment";
import { PacienteDetalle } from "@/components/paciente/paciente-detalle";
import { PacientesDir } from "@/components/pacientes/pacientes-dir";
import { Sidebar } from "@/components/sidebar";
import { ToastProvider } from "@/components/ui/toast";
import { ESPECIALIDAD_SLUGS, ESPECIALIDADES_META, isEspecialidadSlug, type EspecialidadSlug } from "@/lib/especialidades/meta";

import { appointments, calendar, configuration, directoryPage, finance, onboarding, organization, patientRows, patients, portalAppointments, portalProfiles, portalSummary, PREVIEW_DATE, PREVIEW_NOW, specialtyChart } from "./fixtures";
import styles from "./preview.module.css";

const PANELS = [
  ["hoy", "Hoy"], ["calendario", "Calendario"], ["pacientes", "Pacientes"],
  ["ficha", "Ficha clínica"], ["finanzas", "Finanzas"], ["configuracion", "Configuración"],
  ["onboarding", "Onboarding"], ["portal-turnos", "Portal · turnos"],
  ["portal-resumen", "Portal · resumen"], ["portal-perfil", "Portal · datos"],
] as const;
type Panel = typeof PANELS[number][0];
const panelExists = (value: string | null): value is Panel => PANELS.some(([id]) => id === value);
const previewHref = (panel: Panel) => `/dev/experience?panel=${panel}`;
const LIMIT = "Vista previa: esta acción necesita una sesión y datos locales de prueba. No se envió ninguna solicitud.";

class PanelBoundary extends Component<{ children: ReactNode; panel: string }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    if (this.state.error) return (
      <section className="fi-content" role="alert">
        <h1>No pudimos mostrar este panel</h1>
        <p>El componente necesita datos o una acción que esta vista de demostración no proporciona.</p>
        <p>Podés seguir recorriendo los demás paneles desde el selector de vista previa.</p>
        <button className="fi-btn fi-btn-secondary" onClick={() => this.setState({ error: false })}>Volver a cargar el panel</button>
      </section>
    );
    return this.props.children;
  }
}

/** Installs the additional browser fence before any real component is mounted. */
function PreviewFence({ children, onBlocked }: { children: ReactNode; onBlocked: () => void }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const originalFetch = window.fetch;
    const expectedRejection = (event: PromiseRejectionEvent) => {
      // Some real cards load additional data on mount without catching the
      // transport rejection. Our deliberate refusal is already explained by
      // the preview notice; it should not open Next's development error overlay.
      // All unrelated application exceptions retain their normal handling.
      if (event.reason instanceof Error && event.reason.message === LIMIT) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("unhandledrejection", expectedRejection, true);
    window.fetch = async (input, init) => {
      const request = input instanceof Request ? input : null;
      const rawUrl = request?.url ?? String(input);
      const url = new URL(rawUrl, window.location.href);
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      const headers = new Headers(init?.headers ?? request?.headers);
      const local = url.origin === window.location.origin;
      const previewRead = url.pathname === "/dev/experience" || url.pathname.startsWith("/_next/") || url.pathname.startsWith("/__nextjs_");
      if (!local || method !== "GET" || headers.has("Next-Action") || !previewRead) {
        // Next prefetches real Sidebar links on sight. Refusing that read is
        // intentional; it is not a user action and does not need a toast.
        if (!headers.has("Next-Router-Prefetch") && headers.get("Purpose") !== "prefetch") onBlocked();
        throw new TypeError(LIMIT);
      }
      return originalFetch(input, init);
    };
    setReady(true);
    return () => {
      window.fetch = originalFetch;
      window.removeEventListener("unhandledrejection", expectedRejection, true);
    };
  }, [onBlocked]);
  return ready ? children : <p style={{ padding: 24 }}>Preparando la vista previa…</p>;
}

export function ExperiencePreview() {
  return <Suspense fallback={<p>Preparando la vista previa…</p>}><PreviewBody /></Suspense>;
}

function PreviewBody() {
  const router = useRouter();
  const params = useSearchParams();
  const requestedPanel = params.get("panel");
  const panel: Panel = panelExists(requestedPanel) ? requestedPanel : "hoy";
  const empty = params.get("state") === "empty";
  const step = Math.min(8, Math.max(2, Number(params.get("step")) || 2));
  const requestedSpecialty = params.get("esp");
  const specialty: EspecialidadSlug = requestedSpecialty && isEspecialidadSlug(requestedSpecialty) ? requestedSpecialty : "kinesiologia";
  const editable = params.get("editing") === "1";
  const patientId = params.get("patient") ?? undefined;
  const [notice, setNotice] = useState(false);
  // Stable callback keeps the fence installed across local state changes.
  const [blockNotice] = useState(() => () => setNotice(true));
  const isPortal = panel.startsWith("portal-");
  const isApp = !isPortal && panel !== "onboarding";

  function navigate(next: Panel, selectedPatientId?: string) {
    setNotice(false);
    router.push(`${previewHref(next)}${selectedPatientId ? `&patient=${encodeURIComponent(selectedPatientId)}` : ""}`);
  }

  function captureClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest<HTMLAnchorElement>("a[href]");
    if (link) {
      const href = link.getAttribute("href") ?? "";
      if (href.startsWith("#")) return;
      const url = new URL(href, window.location.href);
      if (url.origin === window.location.origin && url.pathname === "/dev/experience") return;
      event.preventDefault();
      event.stopPropagation();
      if (url.origin !== window.location.origin) { blockNotice(); return; }
      const routes: Record<string, Panel> = {
        "/hoy": "hoy", "/calendario": "calendario", "/pacientes": "pacientes", "/finanzas": "finanzas",
        "/configuracion": "configuracion", "/onboarding": "onboarding", "/portal": "portal-resumen",
        "/portal/turnos": "portal-turnos", "/portal/resumen": "portal-resumen", "/portal/perfil": "portal-perfil",
      };
      const destination = routes[url.pathname] ?? (url.pathname.startsWith("/pacientes/") ? "ficha" : undefined);
      if (destination) navigate(destination, destination === "ficha" ? url.pathname.split("/")[2] : undefined); else blockNotice();
      return;
    }
    // Patient rows use router.push instead of an anchor. Keep their real table
    // and route the row interaction into this gallery before that handler runs.
    if (panel === "pacientes" && target.closest("tbody tr") && (target.closest(".pd-name-link") || !target.closest("button,input,label"))) {
      const rowText = target.closest("tbody tr")?.textContent ?? "";
      const selectedPatient = patientRows.find((patient) => rowText.includes(patient.nombre));
      event.preventDefault(); event.stopPropagation(); navigate("ficha", selectedPatient?.id); return;
    }
    const button = target.closest<HTMLButtonElement>("button");
    if (!button) return;
    // Calendar state filters only update local view state. "Sin confirmar"
    // must not be mistaken for the confirmation mutation below.
    if (button.closest(".cal-filters")) return;
    const label = `${button.textContent ?? ""} ${button.getAttribute("aria-label") ?? ""}`.trim();
    if (/guardar|enviar|confirmar|cancelar turno|lleg[oó]|llegada|atender|cerrar turno|sin turno|nuevo paciente|agendar|bloquear|archivar|eliminar|conectar|desconectar|descargar|cobrar|registrar|crear cuenta|activar|suscrib|exportar|subir|invitar/i.test(label)) {
      event.preventDefault(); event.stopPropagation(); blockNotice();
    }
  }

  const content = <PanelBoundary key={`${panel}-${empty}-${step}-${specialty}-${editable}-${patientId}`} panel={panel}><PanelContent panel={panel} empty={empty} step={step} specialty={specialty} editable={editable} patientId={patientId} /></PanelBoundary>;
  return (
    <PreviewFence onBlocked={blockNotice}>
      <ToastProvider>
        <div className={styles.preview} data-preview-panel={panel} onClickCapture={captureClick} onSubmitCapture={(event) => { event.preventDefault(); event.stopPropagation(); blockNotice(); }}>
          <details style={{ position: "fixed", right: 16, top: 12, zIndex: 9999, background: "var(--surface-1, var(--bg))", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 12, padding: "8px 12px", maxWidth: "min(420px, calc(100vw - 32px))", boxShadow: "0 4px 20px rgb(0 0 0 / 8%)" }}>
            <summary style={{ cursor: "pointer", fontSize: 13 }}>Vista previa · {PANELS.find(([id]) => id === panel)?.[1]}</summary>
            <p style={{ fontSize: 12, margin: "12px 0" }}>Datos ficticios. Podés explorar vistas y filtros. Los guardados e integraciones requieren un entorno de prueba con sesión.</p>
            <nav aria-label="Vistas de demostración" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {PANELS.map(([id, label]) => <Link key={id} href={previewHref(id)} className="fi-btn fi-btn-ghost" aria-current={panel === id ? "page" : undefined}>{label}</Link>)}
            </nav>
            {panel === "ficha" && <>
              <nav aria-label="Especialidad de la ficha de ejemplo" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {ESPECIALIDAD_SLUGS.map((slug) => <Link key={slug} className="fi-btn fi-btn-ghost" aria-current={specialty === slug ? "page" : undefined} href={`${previewHref(panel)}&esp=${slug}${editable ? "&editing=1" : ""}${patientId ? `&patient=${encodeURIComponent(patientId)}` : ""}`}>{ESPECIALIDADES_META[slug].nombre}</Link>)}
              </nav>
              <p style={{ fontSize: 12 }}><Link href={`${previewHref(panel)}&esp=${specialty}${editable ? "" : "&editing=1"}${patientId ? `&patient=${encodeURIComponent(patientId)}` : ""}`}>{editable ? "Ver ficha en lectura" : "Explorar edición local de ejemplo"}</Link></p>
            </>}
            {panel === "onboarding" ? <nav aria-label="Pasos del onboarding" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {[2, 3, 4, 5, 6, 7, 8].map((value) => <Link key={value} href={`${previewHref(panel)}&step=${value}`} className="fi-btn fi-btn-ghost">Paso {value}</Link>)}
              {step === 8 && ["complete", "pending", "error"].map((state) => <Link key={state} href={`${previewHref(panel)}&step=8&state=${state}`} className="fi-btn fi-btn-ghost">{state === "complete" ? "Confirmado" : state === "pending" ? "Guardando" : "Error de guardado"}</Link>)}
            </nav> : ["hoy", "pacientes", "portal-turnos", "portal-resumen", "portal-perfil"].includes(panel) ? <p style={{ fontSize: 12 }}><Link href={`${previewHref(panel)}${empty ? "" : "&state=empty"}`}>{empty ? "Ver datos de ejemplo" : "Ver estado vacío"}</Link></p> : null}
            <p style={{ fontSize: 12, marginBottom: 0 }}>La fecha de los ejemplos es el 10 de septiembre de 2026.</p>
          </details>
          {notice && <div role="status" style={{ position: "fixed", zIndex: 10000, bottom: 90, left: "50%", transform: "translateX(-50%)", width: "min(600px, calc(100vw - 32px))", padding: 16, borderRadius: 12, background: "var(--ink)", color: "var(--bg)" }}>
            {LIMIT} <button type="button" onClick={() => setNotice(false)} style={{ color: "inherit", background: "transparent", border: "1px solid currentColor", borderRadius: 6, marginLeft: 10, padding: "4px 8px" }}>Entendido</button>
          </div>}
          {isApp ? <div className="fi-app">
            <Sidebar organization={organization} profile={{ nombre: "Valentina", apellido: "Costa" }} role="OWNER" esColegiado googleSync={{ connected: false }} especialidad="kinesiologia" graceDaysLeft={23} />
            <main className="fi-main" id="main">{content}</main>
            <MobileNav organization={organization} role="OWNER" esColegiado especialidad="kinesiologia" especialidadOverride={null} memberships={[]} activeOrgId="folio-test-experience-org" graceDaysLeft={23} />
          </div> : isPortal ? <div className="pt-app">
            <header className="pt-shell-header"><div className="pt-shell-header-inner"><div className="pt-brand"><FolioMark size={24} /><span className="pt-brand-text"><span className="pt-brand-name">Folio</span><span className="pt-brand-tag">Portal del paciente</span></span></div></div><PortalNav activePath={panel === "portal-perfil" ? "/portal/perfil" : panel === "portal-turnos" ? "/portal/turnos" : "/portal/resumen"} /></header>
            <main className="pt-main">{content}</main>
          </div> : content}
        </div>
      </ToastProvider>
    </PreviewFence>
  );
}

function PanelContent({ panel, empty, step, specialty, editable, patientId }: { panel: Panel; empty: boolean; step: number; specialty: EspecialidadSlug; editable: boolean; patientId?: string }) {
  const chartData = useMemo(() => panel === "ficha" ? specialtyChart(specialty, editable, patientId) : null, [panel, specialty, editable, patientId]);
  switch (panel) {
    case "hoy": return <Dashboard initialTurnos={empty ? [] : appointments} pacientes={empty ? {} : patients} fechaIso={PREVIEW_DATE} fechaLarga="jueves 10 de septiembre" fechaAnio={2026} nowIso={PREVIEW_NOW} timezone="America/Argentina/Cordoba" canRegistrarCobro={false} />;
    case "calendario": return <Calendario {...calendar} />;
    case "pacientes": return <PacientesDir initialPage={directoryPage(empty)} especialidad="kinesiologia" />;
    case "ficha": return chartData ? <PacienteDetalle {...chartData} /> : null;
    case "finanzas": return <Finanzas data={finance} periodo="mes" canMarcarCobrado={false} />;
    case "configuracion": return <Configuracion {...configuration} />;
    case "onboarding": return <MotionProvider>{step === 8 ? <OnboardingFinalPreview /> : <OnboardingApp {...onboarding} initialStep={step} />}</MotionProvider>;
    case "portal-turnos": return <><header className="pt-page-head"><h1 className="pt-page-title">Tus turnos</h1><p className="pt-page-sub">Tus próximas visitas al consultorio.</p></header><TurnosList turnos={empty ? [] : portalAppointments} /></>;
    case "portal-resumen": return <><header className="pt-page-head"><h1 className="pt-page-title">Tu resumen</h1></header><ResumenView resumen={empty ? { turnosPasados: [], consentimientos: [] } : portalSummary} /></>;
    case "portal-perfil": return <><header className="pt-page-head"><h1 className="pt-page-title">Tus datos de contacto</h1></header><PerfilList perfiles={empty ? [] : portalProfiles} /></>;
  }
}

/** Explicit presentation states: no account is created or finalized here. */
function OnboardingFinalPreview() {
  const state = useSearchParams().get("state") ?? "complete";
  const data: OnboardingDataState = { ...ONBOARDING_INITIAL, ...onboarding.initialData };
  return <div className="onb-app fx-onboarding">
    <header className="onb-app-head"><Link className="onb-app-brand fx-auth-brand" href="/"><FolioMark size={24} /><span>folio</span></Link></header>
    <main className="onb-app-main">
      <p style={{ textAlign: "center", color: "var(--ink-2)", fontSize: 13, margin: "0 0 26px" }}>Ejemplo visual del paso final. No se creó ni finalizó ninguna cuenta.</p>
      <Step9Moment data={data} accent={data.acento} slug={onboarding.initialSlug} onFinish={() => {}} onGoToPanel={() => {}} planPriceCents={onboarding.soloPriceCents} finishing={state === "pending"} finalizeOk={state === "complete"} error={state === "error" ? "Ejemplo: no se pudo confirmar el guardado. Tus datos siguen disponibles para reintentar." : null} />
    </main>
  </div>;
}
