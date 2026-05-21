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

type Vista = "servicio" | "slot" | "datos" | "ok";

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
}: {
  org: OrgPublic;
  servicios: ServicioPublic[];
}) {
  const [vista, setVista] = useState<Vista>("servicio");
  const [servicioId, setServicioId] = useState<string>(servicios[0]?.id ?? "");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotPicked, setSlotPicked] = useState<Slot | null>(null);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");
  const [motivo, setMotivo] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaContainerRef = useRef<HTMLDivElement | null>(null);
  const captchaWidgetIdRef = useRef<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Sentinel used by <StickyMiniHeader>'s IntersectionObserver to detect
  // when the hero card scrolls out of view on mobile.
  const cardSentinelRef = useRef<HTMLDivElement | null>(null);

  // Renderizar Turnstile cuando entramos al paso "datos" (no antes para no
  // levantar challenge si el visitante solo revisa horarios).
  useEffect(() => {
    if (vista !== "datos" || !TURNSTILE_SITE_KEY) return;
    if (!captchaContainerRef.current) return;
    if (!window.turnstile) return;                 // Script todavía cargando
    captchaWidgetIdRef.current = window.turnstile.render(captchaContainerRef.current, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: "auto",
      callback: (token) => setCaptchaToken(token),
      "expired-callback": () => setCaptchaToken(null),
      "error-callback": () => setCaptchaToken(null),
    });
    return () => {
      if (captchaWidgetIdRef.current && window.turnstile) {
        window.turnstile.remove(captchaWidgetIdRef.current);
        captchaWidgetIdRef.current = null;
      }
    };
  }, [vista]);

  // Cargar slots cuando se elija servicio
  useEffect(() => {
    if (vista !== "slot" || !servicioId) return;
    startTransition(async () => {
      setErr(null);
      const result = await fetchSlotsPublico({
        orgSlug: org.slug,
        servicioId,
        diasAdelante: 14,
      });
      if (!result.ok) {
        setErr(result.error.message);
        setSlots([]);
        return;
      }
      setSlots(result.data);
    });
  }, [vista, servicioId, org.slug]);

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

        <div id="bk-flow">
        {vista === "servicio" ? (
          <section>
            <h2 style={{ fontSize: 16, marginBottom: 16 }}>Elegí el servicio</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {servicios.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setServicioId(s.id);
                    setVista("slot");
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
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
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
            <h2 style={{ fontSize: 16, marginBottom: 16 }}>Elegí un horario</h2>
            {pending ? <p>Cargando slots…</p> : null}
            {err ? <p className="au-err">{err}</p> : null}
            {slots.length === 0 && !pending ? (
              <p>No hay slots disponibles en los próximos 14 días.</p>
            ) : null}
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {agruparPorDia(slots).map(({ dia, items }) => (
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
                        onClick={() => {
                          setSlotPicked(s);
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
            <h2 style={{ fontSize: 16, marginBottom: 16 }}>Tus datos</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (nombre.length < 2 || telefono.length < 6) {
                  setErr("Nombre y teléfono son obligatorios.");
                  return;
                }
                setErr(null);
                if (TURNSTILE_SITE_KEY && !captchaToken) {
                  setErr("Esperá unos segundos a que el captcha verifique.");
                  return;
                }
                startTransition(async () => {
                  const result = await createPedidoPublico({
                    orgSlug: org.slug,
                    servicioId,
                    inicio: slotPicked.inicio,
                    nombre,
                    telefono,
                    email: email || undefined,
                    motivo: motivo || undefined,
                    captchaToken: captchaToken ?? undefined,
                  });
                  if (!result.ok) {
                    setErr(result.error.message);
                    return;
                  }
                  setVista("ok");
                });
              }}
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <label className="au-field">
                <span>Nombre y apellido</span>
                <input value={nombre} onChange={(e) => setNombre(e.target.value)} required />
              </label>
              <label className="au-field">
                <span>Teléfono (WhatsApp)</span>
                <input value={telefono} onChange={(e) => setTelefono(e.target.value)} required placeholder="+54 9 351 ..." />
              </label>
              <label className="au-field">
                <span>Email <small>opcional</small></span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
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
              {err ? <p className="au-err">{err}</p> : null}
              <button type="submit" className="fi-btn fi-btn-primary" disabled={pending}>
                {pending ? "Enviando..." : "Solicitar turno"}
              </button>
            </form>
          </section>
        ) : null}

        {vista === "ok" ? (
          <section style={{ textAlign: "center", paddingTop: 32 }}>
            <h2 style={{ fontSize: 24 }}>¡Listo!</h2>
            <p style={{ color: "var(--ink-2)", marginTop: 12 }}>
              Tu solicitud llegó al consultorio. Te van a confirmar por WhatsApp en las próximas horas.
            </p>
          </section>
        ) : null}
        </div>
      </main>
    </div>
  );
}
