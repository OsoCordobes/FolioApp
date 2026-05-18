"use client";

/**
 * Folio · BookingWizard · UI pública para /book/[slug].
 *
 * 3-step wizard sin dependencia de auth ni Supabase client. Llama Server
 * Actions (fetchSlotsPublico, createPedidoPublico) que cargan/insertan
 * con service_role.
 */

import { useEffect, useState, useTransition } from "react";

import {
  createPedidoPublico,
  fetchSlotsPublico,
} from "@/app/(public)/book/[slug]/actions";

interface OrgPublic {
  slug: string;
  nombre: string;
  ciudad: string | null;
  provincia: string | null;
  rubro: string | null;
  acentoHex: string;
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
  const [pending, startTransition] = useTransition();

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

  const accent = org.acentoHex;
  const ubicacion = [org.ciudad, org.provincia].filter(Boolean).join(", ");

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <div className="bk-page" style={{ background: "var(--bg)", minHeight: "100vh" }}>
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px" }}>
        <header style={{ marginBottom: 32 }}>
          <span className="fi-eyebrow" style={{ color: accent }}>
            {org.rubro ? org.rubro.toUpperCase() : "RESERVAR"}
          </span>
          <h1 style={{ marginTop: 8, fontSize: 28 }}>{org.nombre}</h1>
          {ubicacion ? (
            <p style={{ color: "var(--ink-3)", marginTop: 4 }}>{ubicacion}</p>
          ) : null}
        </header>

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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
              {slots.slice(0, 24).map((s) => {
                const d = new Date(s.inicio);
                const fmtFecha = d.toLocaleDateString("es-AR", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                });
                const fmtHora = d.toLocaleTimeString("es-AR", {
                  hour: "2-digit",
                  minute: "2-digit",
                });
                return (
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
                      textAlign: "left",
                    }}
                  >
                    <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{fmtFecha}</div>
                    <div style={{ fontWeight: 500 }}>{fmtHora}</div>
                  </button>
                );
              })}
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
                startTransition(async () => {
                  const result = await createPedidoPublico({
                    orgSlug: org.slug,
                    servicioId,
                    inicio: slotPicked.inicio,
                    nombre,
                    telefono,
                    email: email || undefined,
                    motivo: motivo || undefined,
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
      </main>
    </div>
  );
}
