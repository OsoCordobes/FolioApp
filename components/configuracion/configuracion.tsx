"use client";

/**
 * Folio · /configuracion — ajustes del consultorio.
 *
 * Port de folio/configuracion.jsx (613 líneas). 6 secciones: Cuenta,
 * Consultorio (default activa), Horarios, Servicios, Integraciones, Plan.
 *
 * En F4 cada sección persiste vía Server Action propia con audit logging.
 * En F5/F6 los toggles de Google/WhatsApp ejecutan el flow OAuth real.
 */

import { useState, useTransition, type ReactNode } from "react";

import * as I from "@/components/icons";
import {
  connectGoogleCalendar,
  countSesionesOtraEspecialidadAction,
  countSesionesOtraEspecialidadMemberAction,
  disconnectGoogleCalendar,
  inviteMemberAction,
  removeMemberAction,
  revokeInvitationAction,
  saveBookingPrefsAction,
  saveConsultorioAction,
  saveHorariosAction,
  saveServiciosAction,
  updateMemberEspecialidadAction,
} from "@/app/(app)/configuracion/actions";
import { roleLabel } from "@/lib/auth/capabilities";
import type {
  CreateInvitationInput,
  InvitableRole,
  TeamInvitationRow,
  TeamMemberRow,
} from "@/lib/db/members";
import {
  ESPECIALIDADES_META,
  ESPECIALIDAD_SLUGS,
  type EspecialidadSlug,
} from "@/lib/especialidades/meta";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/support";
import type {
  ConsultorioData,
  DiaHorarios,
  DiaSemanaId,
  IntegrationStatus,
  ServicioRow,
} from "@/lib/db/configuracion";

// Re-export tipos para mantener compat con sub-componentes locales.
export type { ConsultorioData };

/**
 * M55 · datos mínimos del member de la sesión para el camino "self" de la
 * sección Equipo: un profesional colegiado sin gestión de equipo edita SOLO
 * su propia especialidad (null = hereda la de la clínica).
 */
export interface EquipoSelf {
  memberId: string;
  especialidad: EspecialidadSlug | null;
}

type DiaId = "lun" | "mar" | "mie" | "jue" | "vie" | "sab" | "dom";
type Dia = { on: boolean; franjas: [string, string][] };

// Los defaults de horarios ahora vienen del server (getConfiguracionData).

const DIAS_LBLS: Record<DiaId, string> = {
  lun: "Lunes", mar: "Martes", mie: "Miércoles", jue: "Jueves",
  vie: "Viernes", sab: "Sábado", dom: "Domingo",
};

// Zonas horarias IANA de Argentina (todas UTC-3, sin DST desde 2009).
const TIMEZONES_AR: { value: string; label: string }[] = [
  { value: "America/Argentina/Buenos_Aires", label: "Buenos Aires (UTC-3)" },
  { value: "America/Argentina/Cordoba", label: "Córdoba (UTC-3)" },
  { value: "America/Argentina/Mendoza", label: "Mendoza (UTC-3)" },
  { value: "America/Argentina/Salta", label: "Salta (UTC-3)" },
  { value: "America/Argentina/Jujuy", label: "Jujuy (UTC-3)" },
  { value: "America/Argentina/Tucuman", label: "Tucumán (UTC-3)" },
  { value: "America/Argentina/Catamarca", label: "Catamarca (UTC-3)" },
  { value: "America/Argentina/La_Rioja", label: "La Rioja (UTC-3)" },
  { value: "America/Argentina/San_Juan", label: "San Juan (UTC-3)" },
  { value: "America/Argentina/San_Luis", label: "San Luis (UTC-3)" },
  { value: "America/Argentina/Ushuaia", label: "Ushuaia (UTC-3)" },
  { value: "America/Argentina/Rio_Gallegos", label: "Río Gallegos (UTC-3)" },
];

// Opciones de margen entre turnos (M43 slot_margen_min). 0 = "Sin margen".
const MARGEN_OPTS: { value: number; label: string }[] = [
  { value: 0, label: "Sin margen" },
  { value: 5, label: "5 minutos" },
  { value: 10, label: "10 minutos" },
  { value: 15, label: "15 minutos" },
  { value: 20, label: "20 minutos" },
];

type ServicioCfg = ServicioRow;

// ─── Side nav ──────────────────────────────────────────────────────────────

type SeccionId = "cuenta" | "consultorio" | "equipo" | "horarios" | "servicios" | "integraciones" | "plan";

function SideNav({ active, setActive, showEquipo }: { active: SeccionId; setActive: (s: SeccionId) => void; showEquipo: boolean }) {
  const items: { id: SeccionId; label: string; icon: ReactNode }[] = [
    { id: "cuenta",        label: "Cuenta",         icon: <I.Users size={14} /> },
    { id: "consultorio",   label: "Consultorio",    icon: <I.Calendar size={14} /> },
    ...(showEquipo
      ? [{ id: "equipo" as const, label: "Equipo", icon: <I.Users size={14} /> }]
      : []),
    { id: "horarios",      label: "Horarios",       icon: <I.CalendarDay size={14} /> },
    { id: "servicios",     label: "Servicios",      icon: <I.Wallet size={14} /> },
    { id: "integraciones", label: "Integraciones",  icon: <I.ExternalLink size={14} /> },
    { id: "plan",          label: "Plan",           icon: <I.Settings size={14} /> },
  ];
  return (
    <nav className="cfg-sidenav">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className={"cfg-sidenav-item " + (active === it.id ? "is-active" : "")}
          onClick={() => setActive(it.id)}
        >
          <span className="cfg-sidenav-ico">{it.icon}</span>
          <span>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

// ─── Section / Row / TextInput / Toggle helpers ────────────────────────────

function Section({ title, sub, children, action }: { title: string; sub?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="cfg-section">
      <header>
        <div>
          <h2>{title}</h2>
          {sub ? <p>{sub}</p> : null}
        </div>
        {action ?? null}
      </header>
      <div className="cfg-section-body">{children}</div>
    </section>
  );
}

function Row({ label, sub, children, vertical }: { label: string; sub?: string; children: ReactNode; vertical?: boolean }) {
  return (
    <div className={"cfg-row " + (vertical ? "is-vertical" : "")}>
      <div className="cfg-row-label">
        <span>{label}</span>
        {sub ? <span className="cfg-row-sub">{sub}</span> : null}
      </div>
      <div className="cfg-row-control">{children}</div>
    </div>
  );
}

function TextInput({ value, onChange, placeholder, prefix, type = "text" }: { value: string; onChange: (v: string) => void; placeholder?: string; prefix?: string; type?: string }) {
  if (prefix) {
    return (
      <div className="cfg-input-prefix">
        <span className="fm-mono">{prefix}</span>
        <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      </div>
    );
  }
  return (
    <input
      className="cfg-input"
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={"cfg-switch " + (value ? "is-on" : "")}
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
    >
      <span className="cfg-switch-thumb" />
    </button>
  );
}

// ─── Sección: Cuenta ───────────────────────────────────────────────────────

function SecCuenta({ c, set }: { c: ConsultorioData; set: (patch: Partial<ConsultorioData>) => void }) {
  return (
    <>
      <Section title="Datos personales" sub="Lo que ve el paciente en tu link público.">
        <Row label="Nombre completo">
          <TextInput value={c.profesional} onChange={(v) => set({ profesional: v })} />
        </Row>
        <Row label="Matrícula" sub="Formato libre">
          <TextInput value={c.matricula} onChange={(v) => set({ matricula: v })} />
        </Row>
        <Row label="Email" sub="Para login y notificaciones del sistema">
          <TextInput type="email" value={c.email} onChange={(v) => set({ email: v })} />
        </Row>
        <Row label="Teléfono">
          <TextInput
            prefix="+54"
            value={c.tel.replace("+54 ", "")}
            onChange={(v) => set({ tel: "+54 " + v })}
          />
        </Row>
      </Section>

      <Section title="Seguridad">
        <Row label="Contraseña" sub="Te enviaremos un email con un link de reset">
          <CambiarPasswordButton email={c.email} />
        </Row>
        <Row label="Autenticación de dos factores" sub="Recomendado para datos clínicos">
          <button
            type="button"
            className="fi-btn fi-btn-secondary"
            disabled
            title="Próximamente — F11 polish"
            style={{ opacity: 0.5, cursor: "not-allowed" }}
          >
            Activar MFA
          </button>
        </Row>
        <Row label="Sesiones activas" sub="Dispositivos donde tu cuenta está abierta">
          <div className="cfg-sesiones">
            <div className="cfg-sesion">
              <div>
                <b>Este navegador</b>
                <span className="muted">Sesión activa ahora</span>
              </div>
              <span className="cfg-tag-now">Este dispositivo</span>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Listado de otros dispositivos en F11 polish. Mientras tanto, usá &quot;Cerrar sesión&quot; del sidebar para cerrar esta sesión.
          </p>
        </Row>
      </Section>

      <Section title="Tus datos y derechos" sub="Habeas Data (Ley 25.326): exportar tus datos o solicitar eliminación de cuenta.">
        <Row label="Acceso a tus datos" sub="Exportar JSON con todo, o solicitar eliminación con grace period de 30 días.">
          <a href="/configuracion/datos" className="fi-btn fi-btn-ghost">
            Abrir mis datos →
          </a>
        </Row>
      </Section>
    </>
  );
}

function CambiarPasswordButton({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const handler = async () => {
    if (!email) {
      alert("Email del perfil no disponible.");
      return;
    }
    if (!confirm(`Te vamos a enviar un email a ${email} con un link para resetear la contraseña. ¿Continuar?`)) {
      return;
    }
    setState("sending");
    try {
      const { createSupabaseBrowserClient } = await import("@/lib/supabase/client");
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/login?reset=1`,
      });
      if (error) throw error;
      setState("sent");
    } catch (e) {
      console.warn("[configuracion] reset password falló:", e);
      setState("error");
    }
  };
  if (state === "sent") return <span style={{ color: "var(--green)", fontSize: 13 }}>Email enviado. Revisá tu casilla.</span>;
  return (
    <button type="button" className="fi-btn fi-btn-secondary" onClick={handler} disabled={state === "sending"}>
      {state === "sending" ? "Enviando…" : state === "error" ? "Reintentar" : "Cambiar contraseña"}
    </button>
  );
}

// EliminarCuentaButton removido: la eliminación canónica vive en /configuracion/datos
// (Phase 6a) con grace period de 30 días + UI para cancelar/restaurar.

// ─── Sección: Consultorio ──────────────────────────────────────────────────

function SecConsultorio({
  c,
  set,
  savedEspecialidad,
  orgTipo,
  canEdit,
  orgSlug,
}: {
  c: ConsultorioData;
  set: (patch: Partial<ConsultorioData>) => void;
  /** Especialidad persistida en DB (snapshot) — para detectar el cambio pendiente. */
  savedEspecialidad: EspecialidadSlug;
  orgTipo: "INDEPENDIENTE" | "CLINICA";
  canEdit: boolean;
  /** Slug real de la org (organization.slug) para el link público copiable. */
  orgSlug: string;
}) {
  // M50 · count de sesiones cargadas con la herramienta de OTRA especialidad.
  // Se consulta server-side al cambiar el selector; si hay, mostramos la
  // advertencia ANTES de que el user guarde (el save real va por la save-bar).
  const [otrasSesiones, setOtrasSesiones] = useState<number | null>(null);
  const [, startCountTransition] = useTransition();

  const onEspecialidadChange = (slug: EspecialidadSlug) => {
    set({ especialidad: slug });
    if (slug === savedEspecialidad) {
      setOtrasSesiones(null);
      return;
    }
    startCountTransition(async () => {
      const result = await countSesionesOtraEspecialidadAction(slug);
      setOtrasSesiones(result.ok ? result.data : null);
    });
  };

  const especialidadCambiada = c.especialidad !== savedEspecialidad;
  const nombreAnterior = ESPECIALIDADES_META[savedEspecialidad].nombre;

  return (
    <>
      <Section title="Identidad del consultorio" sub="Aparece en el sidebar, recordatorios y el link público.">
        <Row label="Nombre del consultorio">
          <TextInput value={c.nombre} onChange={(v) => set({ nombre: v })} />
        </Row>
        <Row label="Foto del consultorio" sub="Opcional · 1200×600 recomendado">
          <button
            type="button"
            className="cfg-upload"
            disabled
            title="Próximamente — el logo se sube desde Onboarding > Identidad visual"
            aria-disabled="true"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2.5" />
              <circle cx="8.5" cy="9" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
            <span>Subir imagen</span>
          </button>
        </Row>
      </Section>

      <Section
        title="Especialidad y equipo"
        sub="La especialidad define la herramienta clínica de la ficha del paciente."
      >
        <Row label="Especialidad" sub="Aplica a las fichas de toda la organización." vertical={especialidadCambiada && otrasSesiones !== null && otrasSesiones > 0}>
          <select
            className="cfg-input cfg-input-fixed"
            value={c.especialidad}
            disabled={!canEdit}
            title={canEdit ? undefined : "Solo OWNER/DIRECTOR puede editar"}
            onChange={(e) => onEspecialidadChange(e.target.value as EspecialidadSlug)}
          >
            {ESPECIALIDAD_SLUGS.map((slug) => (
              <option key={slug} value={slug}>{ESPECIALIDADES_META[slug].nombre}</option>
            ))}
          </select>
          {especialidadCambiada && otrasSesiones !== null && otrasSesiones > 0 ? (
            <p
              role="alert"
              style={{
                color: "var(--amber)",
                background: "var(--amber-soft)",
                borderRadius: "var(--r-sm)",
                padding: "8px 12px",
                fontSize: 12.5,
                lineHeight: 1.55,
                marginTop: 8,
              }}
            >
              Tu organización tiene {otrasSesiones} {otrasSesiones === 1 ? "sesión cargada" : "sesiones cargadas"} con {nombreAnterior}.
              {" "}Los datos clínicos cargados con {nombreAnterior} se conservan pero dejan de mostrarse en la ficha.
            </p>
          ) : null}
        </Row>
        <Row
          label="Tipo de organización"
          sub="El cambio a Clínica llega junto con la facturación por equipo — todavía no se edita desde acá."
        >
          <span className="muted" style={{ fontSize: 13 }}>
            {orgTipo === "CLINICA" ? "Clínica" : "Consultorio independiente"}
          </span>
        </Row>
      </Section>

      <Section title="Ubicación" sub="Aparece en los recordatorios de turno enviados al paciente.">
        <Row label="Dirección">
          <TextInput value={c.direccion} onChange={(v) => set({ direccion: v })} />
        </Row>
        <Row label="Ciudad / Provincia">
          <div className="cfg-grid-2">
            <TextInput value={c.ciudad} onChange={(v) => set({ ciudad: v })} />
            <select className="cfg-input" value={c.provincia} onChange={(e) => set({ provincia: e.target.value })}>
              {["Córdoba", "Buenos Aires", "Santa Fe", "Mendoza", "Neuquén", "Salta", "Tucumán", "Otra"].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </Row>
        <Row label="Zona horaria" sub="Sin DST · Argentina">
          <select
            className="cfg-input cfg-input-fixed"
            value={c.timezone}
            onChange={(e) => set({ timezone: e.target.value })}
          >
            {TIMEZONES_AR.map((tz) => (
              <option key={tz.value} value={tz.value}>{tz.label}</option>
            ))}
          </select>
        </Row>
      </Section>

      <Section title="Presencia online" sub="Para mostrar en tu link público y compartir reservas.">
        <Row label="Link público de reservas" sub="Compartilo con tus pacientes — abre tu página de reservas">
          <PublicLinkRow slug={orgSlug} />
        </Row>
        <Row label="Instagram">
          <TextInput prefix="@" value={c.instagram} onChange={(v) => set({ instagram: v })} />
        </Row>
      </Section>
    </>
  );
}

function PublicLinkRow({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  // Slug REAL de la org (organization.slug, pasado por el Server Component).
  // Antes se derivaba del nombre del consultorio y el link copiado era un 404.
  const origin = typeof window !== "undefined" ? window.location.origin : "https://folio-app-ten.vercel.app";
  const url = `${origin}/book/${slug}`;
  const display = url.replace(/^https?:\/\//, "");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      alert(`No pude copiar automáticamente. Copialo a mano:\n\n${url}`);
    }
  };

  return (
    <div className="cfg-public-link">
      <code className="fm-mono">{display}</code>
      <button type="button" className="fi-btn fi-btn-ghost" onClick={copy}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
        {copied ? "¡Copiado!" : "Copiar"}
      </button>
    </div>
  );
}

// ─── Sub-sección: Reservas web (M43 auto-confirmar) ────────────────────────

function SecBookingPrefs({ initialAutoConfirmar, canEdit }: { initialAutoConfirmar: boolean; canEdit: boolean }) {
  const [autoConfirmar, setAutoConfirmar] = useState(initialAutoConfirmar);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onToggle = (next: boolean) => {
    if (!canEdit) return;
    const prev = autoConfirmar;
    setAutoConfirmar(next); // optimista
    setError(null);
    startTransition(async () => {
      const result = await saveBookingPrefsAction({ autoConfirmarReservas: next });
      if (!result.ok) {
        setAutoConfirmar(prev); // revertir
        setError(result.error.message);
      }
    });
  };

  return (
    <Section
      title="Reservas web"
      sub="Cómo se procesan las reservas que llegan por tu link público."
      action={
        error ? (
          <p role="alert" style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>{error}</p>
        ) : pending ? (
          <span className="cfg-save-msg"><span className="cfg-save-dot" /> Guardando…</span>
        ) : null
      }
    >
      <Row
        label="Auto-confirmar reservas web"
        sub="Si está activo, las reservas del link público se confirman automáticamente sin tu aprobación manual."
      >
        <Toggle value={autoConfirmar} onChange={onToggle} />
      </Row>
    </Section>
  );
}

// ─── Sección: Horarios ─────────────────────────────────────────────────────

function SecHorarios({ dias, setDias, slotMin, setSlotMin, slotMargenMin, onMargenChange, margenPending, canEdit }: {
  dias: Record<DiaId, Dia>;
  setDias: (d: Record<DiaId, Dia>) => void;
  slotMin: number;
  setSlotMin: (n: number) => void;
  slotMargenMin: number;
  onMargenChange: (n: number) => void;
  margenPending: boolean;
  canEdit: boolean;
}) {
  const setDia = (id: DiaId, patch: Partial<Dia>) =>
    setDias({ ...dias, [id]: { ...dias[id], ...patch } });
  const setFranja = (id: DiaId, i: number, idx: 0 | 1, val: string) => {
    const next = dias[id].franjas.map((f, k) =>
      k === i ? (f.map((v, j) => (j === idx ? val : v)) as [string, string]) : f,
    );
    setDia(id, { franjas: next });
  };
  const addFranja = (id: DiaId) => setDia(id, { franjas: [...dias[id].franjas, ["", ""]] });
  const removeFranja = (id: DiaId, i: number) =>
    setDia(id, { franjas: dias[id].franjas.filter((_, k) => k !== i) });

  return (
    <>
      <Section title="Disponibilidad semanal" sub="Slots que se ofrecen en tu link público. Bloqueos puntuales se hacen desde el Calendario.">
        <div className="cfg-horarios">
          {(Object.keys(dias) as DiaId[]).map((id) => {
            const d = dias[id];
            return (
              <div key={id} className={"cfg-dia " + (d.on ? "" : "is-off")}>
                <div className="cfg-dia-head">
                  <Toggle value={d.on} onChange={(v) => setDia(id, { on: v })} />
                  <b>{DIAS_LBLS[id]}</b>
                </div>
                <div className="cfg-dia-franjas">
                  {!d.on ? (
                    <span className="muted">Cerrado</span>
                  ) : d.franjas.length === 0 ? (
                    <button type="button" className="cfg-link cfg-link-add" onClick={() => addFranja(id)}>
                      + Agregar franja
                    </button>
                  ) : (
                    <>
                      {d.franjas.map((f, i) => (
                        <div key={i} className="cfg-franja">
                          <input type="time" value={f[0]} onChange={(e) => setFranja(id, i, 0, e.target.value)} />
                          <span className="muted">a</span>
                          <input type="time" value={f[1]} onChange={(e) => setFranja(id, i, 1, e.target.value)} />
                          <button type="button" className="cfg-franja-x" onClick={() => removeFranja(id, i)} aria-label="Quitar franja">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                              <path d="M18 6 6 18M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}
                      <button type="button" className="cfg-link cfg-link-add" onClick={() => addFranja(id)}>
                        + Agregar franja
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Slot" sub="Duración por defecto de cada turno ofrecido en tu link.">
        <Row label="Duración">
          <div className="cfg-radio-group">
            {[30, 45, 60].map((m) => (
              <button
                key={m}
                type="button"
                className={"cfg-radio-btn " + (slotMin === m ? "is-on" : "")}
                onClick={() => setSlotMin(m)}
              >
                {m} min
              </button>
            ))}
          </div>
        </Row>
        <Row
          label="Margen entre turnos"
          sub={margenPending ? "Guardando…" : "Tiempo libre entre dos turnos consecutivos"}
        >
          <select
            className="cfg-input cfg-input-fixed"
            value={slotMargenMin}
            disabled={!canEdit || margenPending}
            title={canEdit ? undefined : "Solo OWNER/DIRECTOR puede editar"}
            onChange={(e) => onMargenChange(Number(e.target.value))}
          >
            {MARGEN_OPTS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Row>
      </Section>
    </>
  );
}

// ─── Sección: Servicios ────────────────────────────────────────────────────

function SecServicios({ servicios, setServicios }: { servicios: ServicioCfg[]; setServicios: (s: ServicioCfg[]) => void }) {
  const setServ = (i: number, patch: Partial<ServicioCfg>) =>
    setServicios(servicios.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const addServ = () =>
    setServicios([
      ...servicios,
      { id: `tmp-${Date.now()}`, nombre: "", dur: 45, precio: 0, paraNuevos: false, activo: true },
    ]);
  const removeServ = (i: number) => setServicios(servicios.filter((_, k) => k !== i));

  return (
    <Section
      title="Servicios"
      sub="Lo que el paciente puede reservar. Editable inline."
      action={
        <button type="button" className="fi-btn fi-btn-primary" onClick={addServ}>
          <I.Plus size={13} /> Nuevo servicio
        </button>
      }
    >
      <table className="cfg-table">
        <thead>
          <tr>
            <th>Servicio</th>
            <th>Duración</th>
            <th>Precio</th>
            <th>Tipo</th>
            <th>Estado</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {servicios.map((s, i) => (
            <tr key={s.id} className={!s.activo ? "is-off" : ""}>
              <td>
                <input
                  className="cfg-table-input"
                  value={s.nombre}
                  onChange={(e) => setServ(i, { nombre: e.target.value })}
                  placeholder="Nombre del servicio"
                />
              </td>
              <td>
                <div className="cfg-table-num">
                  <input type="number" value={s.dur} step={15} min={15} onChange={(e) => setServ(i, { dur: Number(e.target.value) })} />
                  <span className="muted">min</span>
                </div>
              </td>
              <td>
                <div className="cfg-table-num">
                  <span className="muted">$</span>
                  <input type="number" value={s.precio} step={1000} min={0} onChange={(e) => setServ(i, { precio: Number(e.target.value) })} />
                </div>
              </td>
              <td>
                <select
                  value={s.paraNuevos ? "nuevos" : "todos"}
                  className="cfg-table-input"
                  onChange={(e) => setServ(i, { paraNuevos: e.target.value === "nuevos" })}
                >
                  <option value="todos">Todos</option>
                  <option value="nuevos">Solo nuevos</option>
                </select>
              </td>
              <td>
                <Toggle value={s.activo} onChange={(v) => setServ(i, { activo: v })} />
              </td>
              <td>
                <button type="button" className="cfg-table-x" onClick={() => removeServ(i)} aria-label="Eliminar">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  </svg>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

// ─── Sección: Integraciones ────────────────────────────────────────────────

function IntegrationCard({ icon, name, desc, status, statusKind, action }: {
  icon: ReactNode;
  name: string;
  desc: string;
  status: string;
  statusKind: "ok" | "warn" | "soon";
  action: ReactNode;
}) {
  return (
    <div className="cfg-integration">
      <div className="cfg-int-ico">{icon}</div>
      <div className="cfg-int-body">
        <div className="cfg-int-head">
          <b>{name}</b>
          <span className={"cfg-int-status is-" + statusKind}>
            <span className="cfg-int-dot" />
            {status}
          </span>
        </div>
        <p>{desc}</p>
      </div>
      <div className="cfg-int-action">{action}</div>
    </div>
  );
}

function SecIntegraciones({ googleCalendar }: { googleCalendar: IntegrationStatus }) {
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  const onConnectGoogle = () => {
    setActionError(null);
    startTransition(async () => {
      const result = await connectGoogleCalendar();
      // connectGoogleCalendar() does a server-side redirect() on success, so
      // we only reach this branch on a Result<void> error envelope (e.g.,
      // GOOGLE_OAUTH_CLIENT_ID missing in env).
      if (result && !result.ok) {
        setActionError(result.error.message);
      }
    });
  };

  const onDisconnectGoogle = () => {
    if (!window.confirm("¿Desconectar Google Calendar? Los eventos sincronizados quedan en tu Google. Vas a poder reconectar cuando quieras.")) {
      return;
    }
    setActionError(null);
    startTransition(async () => {
      const result = await disconnectGoogleCalendar();
      if (!result.ok) setActionError(result.error.message);
    });
  };

  // Tres estados: sin conectar / muerta (invalid_grant → solo re-OAuth la
  // arregla) / conectada (sana o con error transitorio que webhook/cron
  // reintentan solos).
  const googleStatus = !googleCalendar.conectado
    ? { label: "Sin conectar", kind: "warn" as const }
    : googleCalendar.muerta
      ? { label: "Reconectar", kind: "warn" as const }
      : { label: googleStatusLabel(googleCalendar), kind: "ok" as const };

  return (
    <Section
      title="Integraciones"
      sub="Servicios externos conectados a tu cuenta."
      action={
        actionError ? (
          <p className="cfg-int-error" role="alert" style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>
            {actionError}
          </p>
        ) : null
      }
    >
      <IntegrationCard
        icon={
          <svg width="24" height="24" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
          </svg>
        }
        name="Google Calendar"
        desc="Los eventos personales bloquean slots automáticamente. Las reservas confirmadas se crean como eventos en tu Google."
        status={googleStatus.label}
        statusKind={googleStatus.kind}
        action={
          googleCalendar.conectado && googleCalendar.muerta ? (
            // Integración muerta: Google revocó el acceso — re-correr el
            // OAuth es el único arreglo. Reusa la misma action de conectar.
            <>
              <button
                type="button"
                className="fi-btn fi-btn-primary"
                onClick={onConnectGoogle}
                disabled={pending}
              >
                {pending ? "Abriendo Google…" : "Reconectar"}
              </button>
              <button
                type="button"
                className="fi-btn fi-btn-ghost"
                onClick={onDisconnectGoogle}
                disabled={pending}
              >
                Desconectar
              </button>
            </>
          ) : googleCalendar.conectado ? (
            <button
              type="button"
              className="fi-btn fi-btn-ghost"
              onClick={onDisconnectGoogle}
              disabled={pending}
            >
              {pending ? "Desconectando…" : "Desconectar"}
            </button>
          ) : (
            <button
              type="button"
              className="fi-btn fi-btn-primary"
              onClick={onConnectGoogle}
              disabled={pending}
            >
              {pending ? "Abriendo Google…" : "Conectar"}
            </button>
          )
        }
      />
      <IntegrationCard
        icon={<div className="cfg-mp-ico">MP</div>}
        name="Mercado Pago"
        desc="Cobros a pacientes via Mercado Pago. Tu suscripción a Folio se gestiona aparte en Configuración → Plan."
        status="Disponible próximamente"
        statusKind="soon"
        action={
          <button type="button" className="fi-btn fi-btn-ghost" disabled title="Próximamente">
            Conectar
          </button>
        }
      />
      <IntegrationCard
        icon={
          <svg width="24" height="24" viewBox="0 0 24 24" fill="#25D366">
            <path d="M3 21l1.65-4.8A8 8 0 1 1 8 19.6L3 21z" />
          </svg>
        }
        name="WhatsApp Business API"
        desc="Envío automático de confirmaciones, recordatorios y mensajes templados. Hoy se abre wa.me manualmente."
        status="Disponible próximamente"
        statusKind="soon"
        action={
          <button type="button" className="fi-btn fi-btn-ghost" disabled>
            Avisarme
          </button>
        }
      />
    </Section>
  );
}

function googleStatusLabel(s: IntegrationStatus): string {
  if (!s.conectado) return "Sin conectar";
  if (s.ultimoErrorTs) return "Error · reconectá";
  if (s.ultimoUsoTs) {
    const rel = relativeTimeEs(new Date(s.ultimoUsoTs));
    return `Conectado · sync ${rel}`;
  }
  return "Conectado";
}

function relativeTimeEs(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `hace ${hr} h`;
  const day = Math.round(hr / 24);
  if (day < 30) return `hace ${day} d`;
  const mo = Math.round(day / 30);
  return `hace ${mo} m`;
}

// ─── Sección: Equipo (M49/M51 · Fase C) ────────────────────────────────────

const ROLES_INVITABLES: { value: InvitableRole; label: string }[] = [
  { value: "PROFESIONAL", label: "Médico/a" },
  { value: "ASISTENTE",   label: "Secretaría" },
  { value: "COORDINADOR", label: "Coordinación" },
  { value: "DIRECTOR",    label: "Dirección / Administración" },
];

function fechaCorta(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short" }).format(new Date(iso));
}

function EstadoInvitacionBadge({ estado }: { estado: TeamInvitationRow["estado"] }) {
  const isPendiente = estado === "PENDIENTE";
  return (
    <span
      style={{
        padding: "3px 10px",
        borderRadius: "var(--r-sm)",
        background: isPendiente ? "var(--amber-soft)" : "var(--slate-soft)",
        color: isPendiente ? "var(--amber)" : "var(--slate)",
        fontWeight: 500,
        fontSize: 12.5,
      }}
    >
      {isPendiente ? "Pendiente" : "Expirada"}
    </span>
  );
}

/**
 * M55 · select de especialidad de un member colegiado: label del registry,
 * "— (de la clínica)" para NULL (hereda organization.especialidad).
 */
function EspecialidadMemberSelect({
  value,
  disabled,
  onChange,
  ariaLabel,
}: {
  value: EspecialidadSlug | null;
  disabled: boolean;
  onChange: (next: EspecialidadSlug | null) => void;
  ariaLabel: string;
}) {
  return (
    <select
      className="cfg-input"
      style={{ minWidth: 168 }}
      value={value ?? ""}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value === "" ? null : (e.target.value as EspecialidadSlug))}
    >
      <option value="">— (de la clínica)</option>
      {ESPECIALIDAD_SLUGS.map((slug) => (
        <option key={slug} value={slug}>{ESPECIALIDADES_META[slug].nombre}</option>
      ))}
    </select>
  );
}

/**
 * M55 · cambio de especialidad de un member con la advertencia espejo de la
 * org (countSesionesOtraEspecialidad): si el profesional ya tiene sesiones
 * cargadas con OTRA herramienta, se confirma antes — los datos se conservan
 * en DB pero el slot clínico de la ficha deja de mostrarlos.
 *
 * `sujeto`: "Tenés" (camino self) o "{nombre} tiene" (dirección).
 */
async function cambiarEspecialidadConAviso(
  memberId: string,
  nueva: EspecialidadSlug | null,
  sujeto: string,
): Promise<{ ok: true } | { ok: false; message: string | null }> {
  // Best-effort: si el count falla, no bloqueamos el cambio (el gate real y
  // la validación del slug viven server-side en updateMemberEspecialidad).
  const count = await countSesionesOtraEspecialidadMemberAction(memberId, nueva);
  const n = count.ok ? count.data : 0;
  if (n > 0) {
    const destino = nueva ? ESPECIALIDADES_META[nueva].nombre : "la especialidad de la clínica";
    const confirmado = window.confirm(
      `${sujeto} ${n} ${n === 1 ? "sesión cargada" : "sesiones cargadas"} con otra herramienta. ` +
      `Esos datos clínicos se conservan, pero la ficha pasa a usar ${destino} y deja de mostrarlos. ¿Cambiar igual?`,
    );
    if (!confirmado) return { ok: false, message: null };
  }
  const result = await updateMemberEspecialidadAction(memberId, nueva);
  if (!result.ok) return { ok: false, message: result.error.message };
  return { ok: true };
}

/**
 * M55 · camino "self" de la sección Equipo: un profesional colegiado sin
 * gestión de equipo edita SOLO su propia especialidad. La gestión completa
 * (members, invitaciones) queda reservada a dirección.
 */
function SecEquipoSelf({ self }: { self: EquipoSelf }) {
  const [especialidad, setEspecialidad] = useState<EspecialidadSlug | null>(self.especialidad);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onChange = (nueva: EspecialidadSlug | null) => {
    if (nueva === especialidad) return;
    setError(null);
    startTransition(async () => {
      const result = await cambiarEspecialidadConAviso(self.memberId, nueva, "Tenés");
      if (!result.ok) {
        if (result.message) setError(result.message);
        return;
      }
      setEspecialidad(nueva);
    });
  };

  return (
    <Section
      title="Tu especialidad"
      sub="Define la herramienta clínica con la que registrás tus sesiones. Con — (de la clínica) heredás la especialidad principal de la organización."
    >
      <Row label="Especialidad" sub="Dirección también puede cambiarla.">
        <EspecialidadMemberSelect
          value={especialidad}
          disabled={pending}
          onChange={onChange}
          ariaLabel="Tu especialidad"
        />
        {error ? (
          <p role="alert" style={{ color: "var(--red)", fontSize: 12.5, marginTop: 6 }}>{error}</p>
        ) : null}
      </Row>
    </Section>
  );
}

function SecEquipo({
  orgTipo,
  isOwner,
  canManageTeam,
  equipoSelf,
  initialMembers,
  initialInvitations,
}: {
  orgTipo: "INDEPENDIENTE" | "CLINICA";
  isOwner: boolean;
  /** M55 · dirección ve la gestión completa; sin esto, solo el camino self. */
  canManageTeam: boolean;
  /** M55 · member propio para el camino self (colegiado sin gestión). */
  equipoSelf: EquipoSelf | null;
  initialMembers: TeamMemberRow[];
  initialInvitations: TeamInvitationRow[];
}) {
  const [members, setMembers] = useState<TeamMemberRow[]>(initialMembers);
  const [invitations, setInvitations] = useState<TeamInvitationRow[]>(initialInvitations);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastAcceptUrl, setLastAcceptUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  // Form de invitación.
  const [invEmail, setInvEmail] = useState("");
  const [invRole, setInvRole] = useState<InvitableRole>("PROFESIONAL");
  const [invColegiado, setInvColegiado] = useState(false);

  if (orgTipo !== "CLINICA") {
    // Upsell honesto: el equipo es del plan Clínica. Sin form.
    return (
      <Section
        title="Equipo"
        sub="Invitá médicos, secretaría y dirección a trabajar en la misma organización."
      >
        <div className="cfg-plan-card">
          <div className="cfg-plan-card-l">
            <span className="fi-eyebrow">Plan Clínica</span>
            <h3>El equipo es del plan Clínica</h3>
            <p>
              Tu organización está en el plan individual (un solo profesional). El plan Clínica
              cuesta ARS 100.000/mes base e incluye a quien dirige la cuenta; cada integrante
              adicional (médico/a o secretaría) suma ARS 25.000/mes.
            </p>
            <p style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 8 }}>
              El cambio de plan se hace al crear una organización tipo clínica. Si querés migrar
              esta cuenta, escribinos a soporte.
            </p>
          </div>
        </div>
      </Section>
    );
  }

  // M55 · profesional colegiado sin gestión de equipo: solo su especialidad.
  if (!canManageTeam) {
    return equipoSelf ? <SecEquipoSelf self={equipoSelf} /> : null;
  }

  const submitInvite = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!invEmail.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)) {
      setError("Ingresá un email válido.");
      return;
    }
    setError(null);
    setNotice(null);
    setLastAcceptUrl(null);
    startTransition(async () => {
      const input: CreateInvitationInput = {
        email: invEmail.trim(),
        role: invRole,
        esColegiado: invRole === "DIRECTOR" ? invColegiado : undefined,
      };
      const result = await inviteMemberAction(input);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      // Reemplaza una pendiente previa del mismo email si existía.
      setInvitations((prev) => [
        result.data.invitation,
        ...prev.filter((i) => i.email !== result.data.invitation.email),
      ]);
      setInvEmail("");
      setInvColegiado(false);
      setLastAcceptUrl(result.data.acceptUrl);
      setNotice(
        result.data.emailEnviado
          ? `Le enviamos la invitación a ${result.data.invitation.email}. También podés copiar el link y pasárselo directo.`
          : "El envío de emails no está configurado — copiá el link y pasáselo directo. La invitación vence en 7 días.",
      );
    });
  };

  const copyAcceptUrl = async () => {
    if (!lastAcceptUrl) return;
    try {
      await navigator.clipboard.writeText(lastAcceptUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      alert(`No pude copiar automáticamente. Copialo a mano:\n\n${lastAcceptUrl}`);
    }
  };

  const onRevoke = (inv: TeamInvitationRow) => {
    if (!window.confirm(`¿Revocar la invitación a ${inv.email}? El link que recibió deja de funcionar.`)) return;
    setError(null);
    startTransition(async () => {
      const result = await revokeInvitationAction(inv.id);
      if (!result.ok && result.error.code !== "not_found") {
        setError(result.error.message);
        return;
      }
      setInvitations((prev) => prev.filter((i) => i.id !== inv.id));
    });
  };

  // M55 · cambio de especialidad de un member (dirección; incluye la propia).
  const onEspecialidad = (m: TeamMemberRow, nueva: EspecialidadSlug | null) => {
    if (nueva === m.especialidad) return;
    setError(null);
    startTransition(async () => {
      const nombre = [m.nombre, m.apellido].filter(Boolean).join(" ") || m.email || "Este miembro";
      const result = await cambiarEspecialidadConAviso(
        m.memberId,
        nueva,
        m.esVos ? "Tenés" : `${nombre} tiene`,
      );
      if (!result.ok) {
        if (result.message) setError(result.message);
        return;
      }
      setMembers((prev) =>
        prev.map((x) => (x.memberId === m.memberId ? { ...x, especialidad: nueva } : x)),
      );
    });
  };

  const onRemove = (m: TeamMemberRow) => {
    const nombre = [m.nombre, m.apellido].filter(Boolean).join(" ") || m.email || "este miembro";
    if (!window.confirm(`¿Dar de baja a ${nombre}? Pierde el acceso a la organización (sus datos clínicos cargados se conservan).`)) return;
    setError(null);
    startTransition(async () => {
      const result = await removeMemberAction(m.memberId);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setMembers((prev) => prev.filter((x) => x.memberId !== m.memberId));
    });
  };

  return (
    <>
      <Section
        title="Miembros"
        sub="Quiénes trabajan en esta organización y con qué rol."
        action={
          error ? (
            <p role="alert" style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>{error}</p>
          ) : null
        }
      >
        <table className="cfg-table">
          <thead>
            <tr>
              <th>Persona</th>
              <th>Rol</th>
              <th>Especialidad</th>
              <th>Alta</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const nombre = [m.nombre, m.apellido].filter(Boolean).join(" ");
              return (
                <tr key={m.memberId}>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <b style={{ fontSize: 13.5 }}>
                        {nombre || m.email || "—"}
                        {m.esVos ? <span className="cfg-tag-now" style={{ marginLeft: 8 }}>Vos</span> : null}
                      </b>
                      {nombre && m.email ? (
                        <span className="muted" style={{ fontSize: 12 }}>{m.email}</span>
                      ) : null}
                    </div>
                  </td>
                  <td>{roleLabel(m.role, m.esColegiado)}</td>
                  <td>
                    {/* M55 · solo colegiados tienen herramienta clínica. NULL
                        hereda la especialidad principal de la organización. */}
                    {m.esColegiado ? (
                      <EspecialidadMemberSelect
                        value={m.especialidad}
                        disabled={pending}
                        onChange={(nueva) => onEspecialidad(m, nueva)}
                        ariaLabel={`Especialidad de ${nombre || m.email || "miembro"}`}
                      />
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="muted" style={{ fontSize: 12.5 }}>
                    {m.acceptedAt ? fechaCorta(m.acceptedAt) : fechaCorta(m.createdAt)}
                  </td>
                  <td>
                    {isOwner && !m.esVos && m.role !== "OWNER" ? (
                      <button
                        type="button"
                        className="fi-btn fi-btn-ghost"
                        onClick={() => onRemove(m)}
                        disabled={pending}
                      >
                        Dar de baja
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Section
        title="Invitar al equipo"
        sub="La persona recibe un link por email, crea su cuenta y entra directo a tu organización. Cada integrante adicional suma ARS 25.000/mes al plan Clínica."
      >
        <form onSubmit={submitInvite}>
          <Row label="Email" sub="A dónde mandamos la invitación (vence en 7 días)">
            <TextInput
              type="email"
              value={invEmail}
              onChange={(v) => { setInvEmail(v); setError(null); }}
              placeholder="medico@clinica.com"
            />
          </Row>
          <Row label="Rol" sub="Define qué ve y qué puede hacer">
            <select
              className="cfg-input cfg-input-fixed"
              value={invRole}
              onChange={(e) => setInvRole(e.target.value as InvitableRole)}
            >
              {ROLES_INVITABLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </Row>
          {invRole === "DIRECTOR" ? (
            <Row label="¿Es profesional colegiado?" sub="Dirección médica ve datos clínicos; administración pura, no.">
              <Toggle value={invColegiado} onChange={setInvColegiado} />
            </Row>
          ) : null}
          <Row label="" sub="">
            <button type="submit" className="fi-btn fi-btn-primary" disabled={pending}>
              {pending ? "Invitando…" : "Enviar invitación"}
            </button>
          </Row>
        </form>

        {notice ? (
          <p role="status" style={{
            color: "var(--green)",
            background: "var(--green-soft)",
            borderRadius: "var(--r-sm)",
            padding: "8px 12px",
            fontSize: 12.5,
            lineHeight: 1.55,
            marginTop: 8,
          }}>
            {notice}
          </p>
        ) : null}
        {lastAcceptUrl ? (
          <div className="cfg-public-link" style={{ marginTop: 8 }}>
            <code className="fm-mono" style={{ overflowWrap: "anywhere" }}>{lastAcceptUrl}</code>
            <button type="button" className="fi-btn fi-btn-ghost" onClick={copyAcceptUrl}>
              {copied ? "¡Copiado!" : "Copiar"}
            </button>
          </div>
        ) : null}
      </Section>

      <Section title="Invitaciones pendientes" sub="Links enviados que todavía no se aceptaron.">
        {invitations.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>No hay invitaciones pendientes.</p>
        ) : (
          <table className="cfg-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Vence</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invitations.map((inv) => (
                <tr key={inv.id} className={inv.estado === "EXPIRADA" ? "is-off" : ""}>
                  <td style={{ fontSize: 13 }}>{inv.email}</td>
                  <td>{roleLabel(inv.role, inv.esColegiado)}</td>
                  <td><EstadoInvitacionBadge estado={inv.estado} /></td>
                  <td className="muted" style={{ fontSize: 12.5 }}>{fechaCorta(inv.expiresAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="fi-btn fi-btn-ghost"
                      onClick={() => onRevoke(inv)}
                      disabled={pending}
                    >
                      Revocar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </>
  );
}

// ─── Sección: Plan ─────────────────────────────────────────────────────────

function SecPlan() {
  return (
    <>
      <Section title="Suscripción">
        <div className="cfg-plan-card">
          <div className="cfg-plan-card-l">
            <span className="fi-eyebrow">Plan actual</span>
            <h3>Folio Profesional · $30.000 / mes</h3>
            <p>
              Cobro automático mensual vía Mercado Pago. Podés cancelar cuando quieras.
              Durante los primeros 7 días tenés acceso completo sin tarjeta.
            </p>
          </div>
          <div className="cfg-plan-card-r">
            <a href="/configuracion/billing" className="fi-btn fi-btn-primary">
              Gestionar suscripción
            </a>
          </div>
        </div>
      </Section>

      <Section title="Facturación" sub="Comprobantes y datos para emisión de facturas.">
        <Row label="Datos de facturación" sub="CUIT, razón social y condición frente al IVA">
          <span className="muted">Editables desde la sección Consultorio.</span>
        </Row>
        <Row label="Historial de cobros" sub="Tus últimos movimientos">
          <a href="/configuracion/billing" className="cfg-link">
            Ver historial completo
          </a>
        </Row>
      </Section>

      <Section
        title="Ayuda y soporte"
        sub="Problemas con tu cuenta, cobros o cualquier cosa que no funcione."
      >
        <Row label="Escribinos" sub={SUPPORT_EMAIL}>
          <a href={supportMailto("Soporte Folio")} className="cfg-link">
            Enviar email
          </a>
        </Row>
      </Section>
    </>
  );
}

// ─── Page header con save bar ──────────────────────────────────────────────

function PageHeader({ dirty, onSave, onDiscard, isSaving, saveError, canEdit }: { dirty: boolean; onSave: () => void; onDiscard: () => void; isSaving: boolean; saveError: string | null; canEdit: boolean }) {
  return (
    <header className="cfg-head">
      <div>
        <span className="fi-eyebrow">ajustes</span>
        <h1>Configuración</h1>
        {saveError ? (
          <p style={{ color: "var(--red)", marginTop: 4, fontSize: 13 }}>{saveError}</p>
        ) : null}
      </div>
      <div className={"cfg-save-bar " + (dirty ? "is-dirty" : "")}>
        {isSaving ? (
          <span className="cfg-save-msg">
            <span className="cfg-save-dot" />
            Guardando…
          </span>
        ) : dirty ? (
          <>
            <span className="cfg-save-msg">
              <span className="cfg-save-dot" />
              Hay cambios sin guardar
            </span>
            <button type="button" className="fi-btn fi-btn-ghost" onClick={onDiscard}>Descartar</button>
            <button
              type="button"
              className="fi-btn fi-btn-primary"
              onClick={onSave}
              disabled={!canEdit}
              title={canEdit ? undefined : "Solo OWNER/DIRECTOR puede editar"}
            >
              Guardar cambios
            </button>
          </>
        ) : (
          <span className="cfg-save-msg cfg-save-msg--saved">
            <I.Check size={12} /> Todo guardado
          </span>
        )}
      </div>
    </header>
  );
}

// ─── Root ──────────────────────────────────────────────────────────────────

interface ConfiguracionProps {
  /** Slug real de la org (organization.slug) — fuente del link público copiable. */
  orgSlug: string;
  initialConsultorio: ConsultorioData;
  initialServicios: ServicioCfg[];
  initialDias: Record<DiaSemanaId, DiaHorarios>;
  initialSlotMin: number;
  initialAutoConfirmar: boolean;
  initialSlotMargenMin: number;
  googleCalendar: IntegrationStatus;
  /** M49 · tipo de organización — solo display (el upgrade llega con billing por seats). */
  orgTipo: "INDEPENDIENTE" | "CLINICA";
  canEdit: boolean;
  /** M49/M51 · solo OWNER/DIRECTOR ven y gestionan la sección Equipo. */
  canManageTeam: boolean;
  /** Solo el OWNER puede dar de baja miembros (policy member_update_owner, M02). */
  isOwner: boolean;
  equipoMembers: TeamMemberRow[];
  equipoInvitations: TeamInvitationRow[];
  /**
   * M55 · member propio para el camino "self" de Equipo: un colegiado sin
   * canManageTeam ve la sección reducida a su propia especialidad.
   */
  equipoSelf: EquipoSelf | null;
}

interface DirtyState {
  consultorio: boolean;
  horarios: boolean;
  servicios: boolean;
}

const NO_DIRTY: DirtyState = { consultorio: false, horarios: false, servicios: false };

export function Configuracion({
  orgSlug,
  initialConsultorio,
  initialServicios,
  initialDias,
  initialSlotMin,
  initialAutoConfirmar,
  initialSlotMargenMin,
  googleCalendar,
  orgTipo,
  canEdit,
  canManageTeam,
  isOwner,
  equipoMembers,
  equipoInvitations,
  equipoSelf,
}: ConfiguracionProps) {
  const [seccion, setSeccion] = useState<SeccionId>("consultorio");
  const [consultorio, setConsultorio] = useState<ConsultorioData>(initialConsultorio);
  const [consultorioSnap, setConsultorioSnap] = useState<ConsultorioData>(initialConsultorio);
  const [dias, setDias] = useState<Record<DiaId, Dia>>(initialDias);
  const [diasSnap, setDiasSnap] = useState<Record<DiaId, Dia>>(initialDias);
  const [slotMin, setSlotMin] = useState(initialSlotMin);
  const [slotMinSnap, setSlotMinSnap] = useState(initialSlotMin);
  const [servicios, setServicios] = useState<ServicioCfg[]>(initialServicios);
  const [serviciosSnap, setServiciosSnap] = useState<ServicioCfg[]>(initialServicios);
  const [dirty, setDirty] = useState<DirtyState>(NO_DIRTY);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, startSavingTransition] = useTransition();

  // Margen entre turnos (M43 slot_margen_min). Persiste on-change vía
  // saveBookingPrefsAction (mismo patrón que el toggle auto-confirmar), no por
  // la save-bar de Consultorio/Horarios.
  const [slotMargenMin, setSlotMargenMin] = useState(initialSlotMargenMin);
  const [margenPending, startMargenTransition] = useTransition();

  const onMargenChange = (next: number) => {
    if (!canEdit) return;
    const prev = slotMargenMin;
    setSlotMargenMin(next); // optimista
    setSaveError(null);
    startMargenTransition(async () => {
      const result = await saveBookingPrefsAction({ slotMargenMin: next });
      if (!result.ok) {
        setSlotMargenMin(prev); // revertir
        setSaveError(`Margen: ${result.error.message}`);
      }
    });
  };

  const anyDirty = dirty.consultorio || dirty.horarios || dirty.servicios;

  const setC = (patch: Partial<ConsultorioData>) => {
    setConsultorio((prev) => ({ ...prev, ...patch }));
    setDirty((d) => ({ ...d, consultorio: true }));
  };

  const handleSave = () => {
    setSaveError(null);
    startSavingTransition(async () => {
      // Save secciones marcadas dirty en serie. Si una falla, paramos y reportamos.
      if (dirty.consultorio) {
        const result = await saveConsultorioAction({
          nombre: consultorio.nombre,
          profesional: consultorio.profesional,
          matricula: consultorio.matricula,
          ciudad: consultorio.ciudad,
          provincia: consultorio.provincia,
          tel: consultorio.tel,
          direccion: consultorio.direccion,
          instagram: consultorio.instagram,
          timezone: consultorio.timezone,
          especialidad: consultorio.especialidad,
        });
        if (!result.ok) {
          setSaveError(`Consultorio: ${result.error.message}`);
          return;
        }
        setConsultorioSnap(consultorio);
      }

      if (dirty.horarios) {
        const result = await saveHorariosAction({ dias, slotMin });
        if (!result.ok) {
          setSaveError(`Horarios: ${result.error.message}`);
          return;
        }
        setDiasSnap(dias);
        setSlotMinSnap(slotMin);
      }

      if (dirty.servicios) {
        const result = await saveServiciosAction({ servicios });
        if (!result.ok) {
          setSaveError(`Servicios: ${result.error.message}`);
          return;
        }
        setServiciosSnap(servicios);
      }

      setDirty(NO_DIRTY);
    });
  };

  const handleDiscard = () => {
    if (dirty.consultorio) setConsultorio(consultorioSnap);
    if (dirty.horarios) {
      setDias(diasSnap);
      setSlotMin(slotMinSnap);
    }
    if (dirty.servicios) setServicios(serviciosSnap);
    setDirty(NO_DIRTY);
    setSaveError(null);
  };

  return (
    <div className="fi-content cfg-content">
      <PageHeader
        dirty={anyDirty}
        onSave={handleSave}
        onDiscard={handleDiscard}
        isSaving={isSaving}
        saveError={saveError}
        canEdit={canEdit}
      />

      <div className="cfg-grid">
        <SideNav active={seccion} setActive={setSeccion} showEquipo={canManageTeam || equipoSelf != null} />
        <div className="cfg-pane">
          {seccion === "cuenta"        ? <SecCuenta c={consultorio} set={setC} /> : null}
          {seccion === "consultorio"   ? (
            <SecConsultorio
              c={consultorio}
              set={setC}
              savedEspecialidad={consultorioSnap.especialidad}
              orgTipo={orgTipo}
              canEdit={canEdit}
              orgSlug={orgSlug}
            />
          ) : null}
          {seccion === "equipo" && (canManageTeam || equipoSelf != null) ? (
            <SecEquipo
              orgTipo={orgTipo}
              isOwner={isOwner}
              canManageTeam={canManageTeam}
              equipoSelf={equipoSelf}
              initialMembers={equipoMembers}
              initialInvitations={equipoInvitations}
            />
          ) : null}
          {seccion === "horarios"      ? (
            <>
              <SecHorarios
                dias={dias}
                setDias={(d) => { setDias(d); setDirty((dd) => ({ ...dd, horarios: true })); }}
                slotMin={slotMin}
                setSlotMin={(n) => { setSlotMin(n); setDirty((dd) => ({ ...dd, horarios: true })); }}
                slotMargenMin={slotMargenMin}
                onMargenChange={onMargenChange}
                margenPending={margenPending}
                canEdit={canEdit}
              />
              <SecBookingPrefs initialAutoConfirmar={initialAutoConfirmar} canEdit={canEdit} />
            </>
          ) : null}
          {seccion === "servicios"     ? (
            <SecServicios
              servicios={servicios}
              setServicios={(s) => { setServicios(s); setDirty((dd) => ({ ...dd, servicios: true })); }}
            />
          ) : null}
          {seccion === "integraciones" ? <SecIntegraciones googleCalendar={googleCalendar} /> : null}
          {seccion === "plan"          ? <SecPlan /> : null}
        </div>
      </div>
    </div>
  );
}
