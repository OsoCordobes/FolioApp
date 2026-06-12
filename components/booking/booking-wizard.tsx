"use client";

/**
 * Folio · BookingWizard · UI pública para /book/[slug].
 *
 * 3-step wizard sin dependencia de auth ni Supabase client. Llama Server
 * Actions (fetchSlotsPublico, createPedidoPublico) que cargan/insertan
 * con service_role.
 */

import Script from "next/script";
import { useEffect, useRef, useState, useTransition } from "react";

import {
  createPedidoPublico,
  fetchSlotsPublico,
} from "@/app/(public)/book/[slug]/actions";
import { PublicCard } from "@/components/public-card/public-card";
import {
  esMultiProfesional,
  nombreProfesionalSeleccionado,
  pasoPrevioASlot,
  pasoTrasServicio,
  profesionalIdParaActions,
  type BookingVista,
  type ProfesionalPublico,
} from "@/lib/booking/wizard-profesional";
import { PRIVACY_VERSION } from "@/lib/legal/versions";

import { StickyMiniHeader } from "./sticky-mini-header";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement | string,
        opts: {
          sitekey: string;
          callback?: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
          size?: "normal" | "compact" | "flexible";
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

interface OrgPublic {
  slug: string;
  nombre: string;
  ciudad: string | null;
  provincia: string | null;
  rubro: string | null;
  acentoHex: string;
  /** Layer D · NULL → AvatarIniciales fallback in the public card. */
  logoUrl: string | null;
  /** Layer B · Defaults to 'editorial' if the column is somehow null. */
  cardMood: "calido" | "clinico" | "editorial" | "boutique";
  bio: string | null;
  telefonoPublico: string | null;
  direccionCompleta: string | null;
  instagramHandle: string | null;
}

interface ServicioPublic {
  id: string;
  nombre: string;
  duracion_min: number;
  precio_cents: number;
  tipo_canonico: string;
  color: string | null;
}

interface Slot {
  inicio: string;
  fin: string;
}

/** "profesional" solo se alcanza con >1 colegiado (lib/booking/wizard-profesional). */
type Vista = BookingVista;

const TZ_AR = "America/Argentina/Cordoba";

function fmtHora(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ_AR,
  });
}

function fmtDia(iso: string): string {
  const d = new Date(iso).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: TZ_AR,
  });
  return d.charAt(0).toUpperCase() + d.slice(1);
}

function diaKey(iso: string): string {
  // YYYY-MM-DD en AR para agrupar
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ_AR });
}

function agruparPorDia(slots: Slot[]): Array<{ dia: string; items: Slot[] }> {
  const map = new Map<string, Slot[]>();
  for (const s of slots) {
    const k = diaKey(s.inicio);
    const arr = map.get(k);
    if (arr) arr.push(s);
    else map.set(k, [s]);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, items]) => ({ dia: fmtDia(items[0].inicio), items }));
}

export function BookingWizard({
  org,
  servicios,
  profesionales = [],
}: {
  org: OrgPublic;
  servicios: ServicioPublic[];
  /** Colegiados reservables (CLINICA-4). Con 0–1, el wizard es el histórico. */
  profesionales?: ProfesionalPublico[];
}) {
  const [vista, setVista] = useState<Vista>("servicio");
  const [servicioId, setServicioId] = useState<string>(servicios[0]?.id ?? "");
  // CLINICA-4 · paso "Elegí profesional": solo existe con >1 colegiado. En
  // ese caso el id elegido viaja a fetchSlotsPublico/createPedidoPublico;
  // con 0–1 NO se manda nada y el server resuelve el default (flujo Solo
  // idéntico al histórico, ni un paso ni un byte extra).
  const multiProf = esMultiProfesional(profesionales);
  const [profesionalSelId, setProfesionalSelId] = useState<string | null>(null);
  const profesionalSelNombre = nombreProfesionalSeleccionado(profesionales, profesionalSelId);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotPicked, setSlotPicked] = useState<Slot | null>(null);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");
  const [motivo, setMotivo] = useState("");
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [autoConfirmado, setAutoConfirmado] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // A11y: flags por campo para aria-invalid/aria-describedby (paso "datos").
  const [fieldErrs, setFieldErrs] = useState<{
    nombre?: boolean;
    telefono?: boolean;
    consent?: boolean;
  }>({});
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaContainerRef = useRef<HTMLDivElement | null>(null);
  const captchaWidgetIdRef = useRef<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Sentinel used by <StickyMiniHeader>'s IntersectionObserver to detect
  // when the hero card scrolls out of view on mobile.
  const cardSentinelRef = useRef<HTMLDivElement | null>(null);

  // A11y · anuncio de pasos: al cambiar de vista movemos el foco al heading
  // del paso (tabIndex={-1}). El lector de pantalla anuncia el nuevo contexto
  // ("Elegí un horario", "Tus datos", "¡Turno confirmado!") sin que el
  // usuario de teclado quede perdido en un botón que ya no existe.
  // preventScroll: el scroll lo maneja el flujo visual existente (no
  // peleamos con el scrollIntoView suave del CTA).
  const stepHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const skipInitialFocusRef = useRef(true);
  useEffect(() => {
    if (skipInitialFocusRef.current) {
      skipInitialFocusRef.current = false;
      return;
    }
    stepHeadingRef.current?.focus({ preventScroll: true });
  }, [vista]);

  // Renderizar Turnstile cuando entramos al paso "datos" (no antes para no
  // levantar challenge si el visitante solo revisa horarios). El Script de
  // Cloudflare puede no haber cargado aún cuando el useEffect corre, así que
  // polleamos brevemente esperándolo (mismo patrón que /onboarding step1).
  useEffect(() => {
    if (vista !== "datos" || !TURNSTILE_SITE_KEY) return;
    if (!captchaContainerRef.current) return;

    const tryRender = () => {
      if (!window.turnstile) return false;
      if (captchaWidgetIdRef.current) return true;
      captchaWidgetIdRef.current = window.turnstile.render(captchaContainerRef.current!, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: "auto",
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
  }, [vista]);

  // Cargar slots cuando se elija servicio (y, en multi-prof, profesional).
  useEffect(() => {
    if (vista !== "slot" || !servicioId) return;
    // Multi-prof sin elección no debería ocurrir (el paso fuerza el click),
    // pero si pasa NO consultamos: el server devolvería err de validación.
    if (multiProf && !profesionalSelId) return;
    startTransition(async () => {
      setErr(null);
      const result = await fetchSlotsPublico({
        orgSlug: org.slug,
        servicioId,
        profesionalId: profesionalIdParaActions(multiProf, profesionalSelId),
        diasAdelante: 14,
      });
      if (!result.ok) {
        setErr(result.error.message);
        setSlots([]);
        return;
      }
      setSlots(result.data);
    });
  }, [vista, servicioId, org.slug, multiProf, profesionalSelId]);

  const initials = (org.nombre || "F")
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
  const appHost =
    typeof window !== "undefined" ? window.location.host : "folio-app-ten.vercel.app";

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <div className="bk-page" style={{ background: "var(--bg)", minHeight: "100vh" }}>
      <StickyMiniHeader
        sentinelRef={cardSentinelRef}
        name={org.nombre}
        logoUrl={org.logoUrl}
        initials={initials}
        accentHex={org.acentoHex}
        onReserveClick={() => {
          setVista("servicio");
          document
            .getElementById("bk-flow")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      />
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px 96px" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 32 }}>
          <PublicCard
            variant="full"
            appUrl={appHost}
            onCta={() => {
              // Scroll suave al wizard sin resetear el paso actual (si el
              // paciente ya está cargando datos, no le pisamos el progreso).
              document
                .getElementById("bk-flow")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            data={{
              nombre: org.nombre,
              rubro: org.rubro,
              ciudad: org.ciudad,
              provincia: org.provincia,
              bio: org.bio,
              telefonoPublico: org.telefonoPublico,
              instagramHandle: org.instagramHandle,
              direccionCompleta: org.direccionCompleta,
              acentoHex: org.acentoHex,
              logoUrl: org.logoUrl,
              cardMood: org.cardMood,
              slug: org.slug,
              servicios: servicios.map((s) => ({
                nombre: s.nombre,
                dur: s.duracion_min,
                precioCents: s.precio_cents,
              })),
            }}
          />
        </div>

        {/* Sentinel sits in normal flow immediately after the hero. When it
            scrolls past the top of the viewport (rootMargin -56 px), the
            sticky mini-header emerges. Placing it here — not at top:0 with
            position:absolute — means initial paint reports isIntersecting=true
            and the mini stays hidden until real scroll. */}
        <div
          ref={cardSentinelRef}
          aria-hidden
          style={{ height: 1, width: "100%" }}
        />

        {/* CLINICA-4 · franja "Atienden acá" bajo la card, solo multi-prof
            (en Solo no se monta: cero cambios). MINIMAL a propósito: nombres
            que ya vienen descifrados del server — especialidad/matrícula por
            profesional es fase 2 (requiere member.especialidad, migración). */}
        {multiProf ? (
          <section
            aria-label="Profesionales que atienden en este consultorio"
            style={{
              margin: "0 0 32px",
              padding: "16px 20px",
              background: "var(--surface)",
              border: "1px solid var(--line-soft)",
              borderRadius: "var(--r-md)",
            }}
          >
            <h2
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--ink-2)",
                textTransform: "uppercase",
                letterSpacing: 0.4,
                margin: "0 0 8px",
              }}
            >
              Atienden acá
            </h2>
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexWrap: "wrap",
                gap: "4px 16px",
              }}
            >
              {profesionales.map((p) => (
                <li key={p.id} style={{ fontSize: 14, color: "var(--ink)" }}>
                  {p.displayName}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div id="bk-flow">
        {vista === "servicio" ? (
          <section>
            <h2
              ref={stepHeadingRef}
              tabIndex={-1}
              className="a11y-focus-heading"
              style={{ fontSize: 16, marginBottom: 16 }}
            >
              Elegí el servicio
            </h2>
            {servicios.length === 0 ? (
              <div
                style={{
                  padding: 24,
                  background: "var(--surface)",
                  border: "1px dashed var(--line)",
                  borderRadius: "var(--r-md)",
                  textAlign: "center",
                  color: "var(--ink-3)",
                }}
              >
                <p style={{ margin: 0, fontSize: 14 }}>
                  Este consultorio todavía no publicó servicios disponibles para reserva.
                </p>
                <p style={{ margin: "8px 0 0", fontSize: 13 }}>
                  Si el profesional te dijo de reservar acá, escribile por WhatsApp o probá más tarde.
                </p>
              </div>
            ) : null}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {servicios.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setServicioId(s.id);
                    setVista(pasoTrasServicio(multiProf));
                  }}
                  className="bk-servicio"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "16px 20px",
                    background: "var(--surface)",
                    border: "1px solid var(--line-soft)",
                    borderRadius: "var(--r-md)",
                    cursor: "pointer",
                    color: "var(--ink)",
                    textAlign: "left",
                  }}
                >
                  <div>
                    <b>{s.nombre}</b>
                    <div style={{ color: "var(--ink-3)", fontSize: 13 }}>
                      {s.duracion_min} min · ${(s.precio_cents / 100).toLocaleString("es-AR")}
                    </div>
                  </div>
                  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {/* CLINICA-4 · paso "Elegí profesional": solo se monta con >1
            colegiado (multiProf). Mismo patrón de cards que el paso de
            servicio y mismo contrato a11y (#45): heading focuseable que
            recibe el foco al entrar al paso. */}
        {vista === "profesional" ? (
          <section>
            <button
              type="button"
              onClick={() => setVista("servicio")}
              style={{
                background: "transparent",
                border: 0,
                color: "var(--ink-3)",
                cursor: "pointer",
                marginBottom: 12,
              }}
            >
              ← Cambiar servicio
            </button>
            <h2
              ref={stepHeadingRef}
              tabIndex={-1}
              className="a11y-focus-heading"
              style={{ fontSize: 16, marginBottom: 16 }}
            >
              Elegí profesional
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {profesionales.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setProfesionalSelId(p.id);
                    setSlots([]);
                    setVista("slot");
                  }}
                  className="bk-servicio"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "16px 20px",
                    background: "var(--surface)",
                    border: "1px solid var(--line-soft)",
                    borderRadius: "var(--r-md)",
                    cursor: "pointer",
                    color: "var(--ink)",
                    textAlign: "left",
                  }}
                >
                  <b>{p.displayName}</b>
                  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {vista === "slot" ? (
          <section>
            <button
              type="button"
              onClick={() => setVista(pasoPrevioASlot(multiProf))}
              style={{
                background: "transparent",
                border: 0,
                color: "var(--ink-3)",
                cursor: "pointer",
                marginBottom: 12,
              }}
            >
              {multiProf ? "← Cambiar profesional" : "← Cambiar servicio"}
            </button>
            <h2
              ref={stepHeadingRef}
              tabIndex={-1}
              className="a11y-focus-heading"
              style={{ fontSize: 16, marginBottom: 16 }}
            >
              Elegí un horario
              {multiProf && profesionalSelNombre ? (
                <span style={{ display: "block", fontSize: 13, fontWeight: 400, color: "var(--ink-3)", marginTop: 4 }}>
                  con {profesionalSelNombre}
                </span>
              ) : null}
            </h2>
            {pending ? (
              // Placeholder de carga: misma grilla que los horarios reales,
              // con shimmer sobre tokens (.bk-skel en folio.css).
              <div role="status" aria-live="polite">
                <p style={{ color: "var(--ink-3)", fontSize: 13, margin: "0 0 12px" }}>
                  Buscando horarios libres…
                </p>
                {[0, 1].map((g) => (
                  <div key={g} style={{ marginBottom: 20 }}>
                    <div className="bk-skel bk-skel-label" />
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
                        gap: 8,
                      }}
                    >
                      {Array.from({ length: g === 0 ? 6 : 4 }).map((_, i) => (
                        <div key={i} className="bk-skel bk-skel-slot" />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {err ? <p className="au-err" role="alert">{err}</p> : null}
            {slots.length === 0 && !pending && !err ? (
              <div
                style={{
                  padding: 24,
                  background: "var(--surface)",
                  border: "1px dashed var(--line)",
                  borderRadius: "var(--r-md)",
                  textAlign: "center",
                  color: "var(--ink-3)",
                }}
              >
                <p style={{ margin: 0, fontSize: 14, color: "var(--ink-2)" }}>
                  No encontramos horarios libres en los próximos 14 días.
                </p>
                <p style={{ margin: "8px 0 0", fontSize: 13 }}>
                  {org.telefonoPublico ? (
                    <>
                      Escribile al consultorio por{" "}
                      <a
                        href={`https://wa.me/${org.telefonoPublico.replace(/\D/g, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "var(--accent-2)" }}
                      >
                        WhatsApp
                      </a>{" "}
                      para coordinar un turno, o probá con otro servicio.
                    </>
                  ) : (
                    <>Contactá al consultorio para coordinar un turno, o probá con otro servicio.</>
                  )}
                </p>
                <button
                  type="button"
                  className="fi-btn fi-btn-ghost"
                  style={{ marginTop: 16 }}
                  onClick={() => setVista("servicio")}
                >
                  Elegir otro servicio
                </button>
              </div>
            ) : null}
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {(pending ? [] : agruparPorDia(slots)).map(({ dia, items }) => (
                <div key={dia}>
                  <h3
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--ink-2)",
                      textTransform: "uppercase",
                      letterSpacing: 0.4,
                      marginBottom: 8,
                    }}
                  >
                    {dia}
                  </h3>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
                      gap: 8,
                    }}
                  >
                    {items.map((s) => (
                      <button
                        key={s.inicio}
                        type="button"
                        aria-label={`${dia}, ${fmtHora(s.inicio)} hs`}
                        onClick={() => {
                          setSlotPicked(s);
                          setFieldErrs({});
                          setVista("datos");
                        }}
                        style={{
                          padding: "10px 12px",
                          background: "var(--surface)",
                          border: "1px solid var(--line-soft)",
                          borderRadius: "var(--r-sm)",
                          cursor: "pointer",
                          color: "var(--ink)",
                          fontWeight: 500,
                        }}
                      >
                        {fmtHora(s.inicio)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {vista === "datos" && slotPicked ? (
          <section>
            <button
              type="button"
              onClick={() => setVista("slot")}
              style={{
                background: "transparent",
                border: 0,
                color: "var(--ink-3)",
                cursor: "pointer",
                marginBottom: 12,
              }}
            >
              ← Cambiar horario
            </button>
            <h2
              ref={stepHeadingRef}
              tabIndex={-1}
              className="a11y-focus-heading"
              style={{ fontSize: 16, marginBottom: 16 }}
            >
              Tus datos
              {multiProf && profesionalSelNombre ? (
                <span style={{ display: "block", fontSize: 13, fontWeight: 400, color: "var(--ink-3)", marginTop: 4 }}>
                  {fmtDia(slotPicked.inicio)} · {fmtHora(slotPicked.inicio)} hs con {profesionalSelNombre}
                </span>
              ) : null}
            </h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const invalidNombre = nombre.length < 2;
                const invalidTelefono = telefono.length < 6;
                if (invalidNombre || invalidTelefono) {
                  setFieldErrs({ nombre: invalidNombre, telefono: invalidTelefono });
                  setErr("Nombre y teléfono son obligatorios.");
                  return;
                }
                if (!consentAccepted) {
                  setFieldErrs({ consent: true });
                  setErr(
                    "Tenés que aceptar la Política de Privacidad para solicitar el turno.",
                  );
                  return;
                }
                setFieldErrs({});
                setErr(null);
                if (TURNSTILE_SITE_KEY && !captchaToken) {
                  setErr("Esperá unos segundos a que el captcha verifique.");
                  return;
                }
                startTransition(async () => {
                  const result = await createPedidoPublico({
                    orgSlug: org.slug,
                    servicioId,
                    profesionalId: profesionalIdParaActions(multiProf, profesionalSelId),
                    inicio: slotPicked.inicio,
                    nombre,
                    telefono,
                    email: email || undefined,
                    motivo: motivo || undefined,
                    captchaToken: captchaToken ?? undefined,
                    consentAccepted,
                    consentVersion: PRIVACY_VERSION,
                  });
                  if (!result.ok) {
                    // Los tokens de Turnstile son de un solo uso: el server ya
                    // lo consumió en siteverify aunque el action falle. Sin
                    // este reset, el retry reenvía el token muerto y muere con
                    // "Captcha inválido" — dead-end doble para el paciente.
                    if (captchaWidgetIdRef.current && window.turnstile) {
                      window.turnstile.reset(captchaWidgetIdRef.current);
                    }
                    setCaptchaToken(null);
                    setErr(result.error.message);
                    return;
                  }
                  setAutoConfirmado(result.data.autoConfirmado);
                  setVista("ok");
                });
              }}
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <label className="au-field">
                <span>Nombre y apellido</span>
                <input
                  value={nombre}
                  onChange={(e) => {
                    setNombre(e.target.value);
                    if (fieldErrs.nombre) setFieldErrs((f) => ({ ...f, nombre: false }));
                  }}
                  required
                  autoComplete="name"
                  aria-invalid={fieldErrs.nombre || undefined}
                  aria-describedby={fieldErrs.nombre ? "bk-datos-err" : undefined}
                />
              </label>
              <label className="au-field">
                <span>Teléfono (WhatsApp)</span>
                <input
                  type="tel"
                  value={telefono}
                  onChange={(e) => {
                    setTelefono(e.target.value);
                    if (fieldErrs.telefono) setFieldErrs((f) => ({ ...f, telefono: false }));
                  }}
                  required
                  placeholder="+54 9 351 ..."
                  autoComplete="tel"
                  aria-invalid={fieldErrs.telefono || undefined}
                  aria-describedby={fieldErrs.telefono ? "bk-datos-err" : undefined}
                />
              </label>
              <label className="au-field">
                <span>Email <small>opcional</small></span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </label>
              <label className="au-field">
                <span>Motivo <small>opcional</small></span>
                <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} />
              </label>
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
              {/* Consentimiento explícito (Ley 25.326 art. 5). El submit y el
                  server action exigen consentAccepted=true. */}
              <label
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: "var(--ink-2)",
                }}
              >
                <input
                  type="checkbox"
                  checked={consentAccepted}
                  onChange={(e) => {
                    setConsentAccepted(e.target.checked);
                    if (e.target.checked) {
                      setErr(null);
                      setFieldErrs((f) => ({ ...f, consent: false }));
                    }
                  }}
                  style={{ marginTop: 3 }}
                  aria-invalid={fieldErrs.consent || undefined}
                  aria-describedby={
                    fieldErrs.consent ? "bk-consent-text bk-datos-err" : "bk-consent-text"
                  }
                />
                <span id="bk-consent-text">
                  Acepto la{" "}
                  <a href="/privacidad" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-2)" }}>
                    Política de Privacidad
                  </a>{" "}
                  y los{" "}
                  <a href="/terminos" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-2)" }}>
                    Términos
                  </a>{" "}
                  y consiento el tratamiento de mis datos para gestionar este turno.
                </span>
              </label>
              {err ? (
                <p className="au-err" id="bk-datos-err" role="alert">
                  {err}
                </p>
              ) : null}
              <button
                type="submit"
                className="fi-btn fi-btn-primary"
                disabled={pending || !consentAccepted}
                title={!consentAccepted ? "Aceptá la Política de Privacidad para continuar" : undefined}
              >
                {pending ? "Enviando..." : "Solicitar turno"}
              </button>
            </form>
          </section>
        ) : null}

        {vista === "ok" && slotPicked ? (
          <section style={{ textAlign: "center", paddingTop: 32 }}>
            <div
              aria-hidden
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                background: "var(--green-soft, #dcfce7)",
                color: "var(--green, #166534)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 16px",
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2
              ref={stepHeadingRef}
              tabIndex={-1}
              className="a11y-focus-heading"
              style={{ fontSize: 24 }}
            >
              {autoConfirmado ? "¡Turno confirmado!" : "¡Solicitud enviada!"}
            </h2>
            <p style={{ color: "var(--ink-2)", marginTop: 12 }}>
              {fmtDia(slotPicked.inicio)} · {fmtHora(slotPicked.inicio)} hs
              {multiProf && profesionalSelNombre ? <> · con {profesionalSelNombre}</> : null}
            </p>
            {autoConfirmado ? (
              <p style={{ color: "var(--ink-3)", marginTop: 8, fontSize: 13, lineHeight: 1.6 }}>
                Te esperamos el <b>{fmtDia(slotPicked.inicio)}</b> a las{" "}
                <b>{fmtHora(slotPicked.inicio)} hs</b>.
                {email ? (
                  <>
                    <br />Te enviamos la confirmación a <span className="fm-mono">{email}</span>.
                  </>
                ) : null}
              </p>
            ) : (
              <p style={{ color: "var(--ink-3)", marginTop: 8, fontSize: 13, lineHeight: 1.6 }}>
                Te van a confirmar por WhatsApp al <span className="fm-mono">{telefono}</span> en las próximas horas.
                {email ? (
                  <>
                    <br />También te enviamos una confirmación a <span className="fm-mono">{email}</span> cuando el consultorio acepte.
                  </>
                ) : null}
              </p>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 24 }}>
              <button
                type="button"
                className="fi-btn fi-btn-ghost"
                onClick={() => {
                  // Reset y volver al inicio del wizard para reservar otro turno
                  setVista("servicio");
                  setProfesionalSelId(null);
                  setSlotPicked(null);
                  setNombre("");
                  setTelefono("");
                  setEmail("");
                  setMotivo("");
                  setCaptchaToken(null);
                  setAutoConfirmado(false);
                  setFieldErrs({});
                }}
              >
                Reservar otro turno
              </button>
            </div>
          </section>
        ) : null}
        </div>
      </main>
    </div>
  );
}
