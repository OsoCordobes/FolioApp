"use client";

/**
 * Folio · /invitacion/[token] · client components.
 *
 *   - InvitationAuth: pantalla neutra para visitantes SIN sesión (la preview
 *     es authenticated-only): crear cuenta mínima o iniciar sesión inline.
 *     Tras autenticar, router.refresh() re-ejecuta el Server Component que
 *     ahora sí puede previsualizar la invitación.
 *   - InvitationDecision: con sesión — muestra org/rol y el botón Aceptar
 *     (con consentimiento Ley 25.326), o el estado terminal correspondiente
 *     (expirada, revocada, ya aceptada, email distinto, no encontrada).
 *
 * Estilos: clases au-* (panel de auth) + tokens de folio.css.
 */

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { signInWithPassword } from "@/app/(public)/login/actions";
import { roleLabel, type Role } from "@/lib/auth/capabilities";

import { acceptInvitationAction, signUpForInvitationAction } from "./actions";

export interface InvitationPreview {
  organization_id: string;
  organization_name: string;
  email: string;
  role: Role;
  es_colegiado: boolean;
  estado: "PENDIENTE" | "ACEPTADA" | "REVOCADA" | "EXPIRADA";
  expired: boolean;
}

// ─── Shell compartido ────────────────────────────────────────────────────────

function Pane({ children }: { children: React.ReactNode }) {
  return (
    <div className="au-form-pane" style={{ maxWidth: 440, width: "100%" }}>
      {children}
    </div>
  );
}

function Head({ title, sub }: { title: string; sub?: string }) {
  return (
    <header className="au-form-head" style={{ marginBottom: 16 }}>
      <span className="fi-eyebrow">invitación al equipo</span>
      <h2>{title}</h2>
      {sub ? (
        <p style={{ color: "var(--ink-3)", marginTop: 6, fontSize: 13, lineHeight: 1.55 }}>{sub}</p>
      ) : null}
    </header>
  );
}

function ConsentCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className="au-consent"
      style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, lineHeight: 1.5 }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 2, flexShrink: 0 }}
      />
      <span>
        Acepto el{" "}
        <a href="/privacidad" target="_blank" rel="noreferrer" className="au-link">
          Aviso de Privacidad
        </a>{" "}
        (Ley 25.326) y los{" "}
        <a href="/terminos" target="_blank" rel="noreferrer" className="au-link">
          Términos
        </a>
        . Mis datos se procesan según el aviso.
      </span>
    </label>
  );
}

// ─── Sin sesión: crear cuenta / iniciar sesión inline ───────────────────────

export function InvitationAuth({ token }: { token: string }) {
  void token; // la página se re-renderiza con el mismo token tras autenticar
  const router = useRouter();
  const [modo, setModo] = useState<"signup" | "login">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!email.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)) {
      setErr("Ingresá un email válido.");
      return;
    }
    if (password.length < 8) {
      setErr("La contraseña tiene mínimo 8 caracteres.");
      return;
    }
    if (modo === "signup" && !consent) {
      setErr("Tenés que aceptar el aviso de privacidad para continuar.");
      return;
    }
    setErr(null);
    startTransition(async () => {
      const result =
        modo === "signup"
          ? await signUpForInvitationAction(email, password, { consent: true })
          : await signInWithPassword(email, password);
      if (!result.ok) {
        setErr(result.error ?? "No pudimos autenticarte. Probá de nuevo.");
        return;
      }
      // Con sesión, el Server Component ya puede previsualizar la invitación.
      router.refresh();
    });
  };

  return (
    <Pane>
      <Head
        title="Te invitaron a un equipo en Folio"
        sub="Para ver y aceptar la invitación necesitás una cuenta con el mismo email al que llegó el correo."
      />

      <div className="au-divider">
        <span>{modo === "signup" ? "Creá tu cuenta" : "Entrá con tu cuenta"}</span>
      </div>

      <form className="au-form" onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label className="au-field">
          <span>Email (el que recibió la invitación)</span>
          <input
            type="email"
            autoComplete="email"
            placeholder="vos@clinica.com"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setErr(null); }}
            disabled={pending}
          />
        </label>
        <label className="au-field">
          <span>Contraseña</span>
          <input
            type="password"
            autoComplete={modo === "signup" ? "new-password" : "current-password"}
            placeholder={modo === "signup" ? "Mínimo 8 caracteres" : ""}
            value={password}
            onChange={(e) => { setPassword(e.target.value); setErr(null); }}
            disabled={pending}
          />
        </label>

        {modo === "signup" ? <ConsentCheckbox checked={consent} onChange={(v) => { setConsent(v); setErr(null); }} /> : null}

        {err ? <p className="au-err">{err}</p> : null}

        <button
          type="submit"
          className="fi-btn fi-btn-primary au-submit"
          disabled={pending || (modo === "signup" && !consent)}
        >
          {pending
            ? modo === "signup" ? "Creando cuenta…" : "Entrando…"
            : modo === "signup" ? "Crear cuenta y ver la invitación" : "Entrar y ver la invitación"}
        </button>
      </form>

      <div className="au-form-switch" style={{ marginTop: 16 }}>
        {modo === "signup" ? (
          <p>
            ¿Ya tenés cuenta?{" "}
            <button type="button" className="au-link" onClick={() => { setModo("login"); setErr(null); }}>
              Ya tengo cuenta
            </button>
          </p>
        ) : (
          <p>
            ¿No tenés cuenta?{" "}
            <button type="button" className="au-link" onClick={() => { setModo("signup"); setErr(null); }}>
              Crear cuenta
            </button>
          </p>
        )}
      </div>
    </Pane>
  );
}

// ─── Con sesión: decisión ────────────────────────────────────────────────────

export function InvitationDecision({
  token,
  preview,
  sessionEmail,
}: {
  token: string;
  preview: InvitationPreview | null;
  sessionEmail: string | null;
}) {
  const router = useRouter();
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const cambiarCuenta = () => {
    startTransition(async () => {
      const { createSupabaseBrowserClient } = await import("@/lib/supabase/client");
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
      router.refresh();
    });
  };

  if (!preview) {
    return (
      <Pane>
        <Head
          title="No encontramos esta invitación"
          sub="El link puede estar incompleto o haber sido reemplazado por uno más nuevo. Pedile a la clínica que te reenvíe la invitación."
        />
        <a href="/login" className="fi-btn fi-btn-ghost au-submit">Ir al inicio</a>
      </Pane>
    );
  }

  const emailMatch =
    sessionEmail != null && sessionEmail.toLowerCase() === preview.email.toLowerCase();
  const rol = roleLabel(preview.role, preview.es_colegiado);

  if (preview.estado === "ACEPTADA") {
    return (
      <Pane>
        <Head
          title={emailMatch ? "Ya aceptaste esta invitación" : "Esta invitación ya fue usada"}
          sub={
            emailMatch
              ? `Ya formás parte de ${preview.organization_name}.`
              : "Si creés que es un error, pedile a la clínica una invitación nueva."
          }
        />
        {emailMatch ? (
          <a href="/hoy" className="fi-btn fi-btn-primary au-submit">Ir a Folio</a>
        ) : null}
      </Pane>
    );
  }

  if (preview.estado === "REVOCADA") {
    return (
      <Pane>
        <Head
          title="La invitación fue revocada"
          sub={`La invitación a ${preview.organization_name} ya no está vigente. Pedile a la clínica que te invite de nuevo.`}
        />
      </Pane>
    );
  }

  if (preview.expired || preview.estado === "EXPIRADA") {
    return (
      <Pane>
        <Head
          title="La invitación expiró"
          sub={`El link para sumarte a ${preview.organization_name} venció (dura 7 días). Pedile a la clínica que te invite de nuevo.`}
        />
      </Pane>
    );
  }

  if (!emailMatch) {
    return (
      <Pane>
        <Head
          title="Esta invitación es para otro email"
          sub={`Estás con la sesión de ${sessionEmail ?? "otra cuenta"}, pero la invitación se envió a ${preview.email}. Cambiá de cuenta para aceptarla.`}
        />
        <button
          type="button"
          className="fi-btn fi-btn-primary au-submit"
          onClick={cambiarCuenta}
          disabled={pending}
        >
          {pending ? "Cerrando sesión…" : "Cambiar de cuenta"}
        </button>
      </Pane>
    );
  }

  const aceptar = () => {
    if (!consent) {
      setErr("Tenés que aceptar el aviso de privacidad para continuar.");
      return;
    }
    setErr(null);
    startTransition(async () => {
      const result = await acceptInvitationAction(token, { consent: true });
      if (!result.ok) {
        setErr(result.error.message);
        return;
      }
      setDone(true);
      // Navegación dura: fuerza re-evaluar layout + membership recién creada.
      window.location.assign("/hoy");
    });
  };

  return (
    <Pane>
      <Head
        title={`Sumate a ${preview.organization_name}`}
        sub={`Te invitaron como ${rol}. Al aceptar, tu cuenta (${preview.email}) pasa a formar parte del equipo.`}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <ConsentCheckbox checked={consent} onChange={(v) => { setConsent(v); setErr(null); }} />

        {err ? <p className="au-err">{err}</p> : null}
        {done ? (
          <p style={{ color: "var(--green)", fontSize: 13 }}>Listo. Te llevamos a Folio…</p>
        ) : null}

        <button
          type="button"
          className="fi-btn fi-btn-primary au-submit"
          onClick={aceptar}
          disabled={pending || done || !consent}
        >
          {pending ? "Aceptando…" : done ? "Listo" : "Aceptar invitación"}
        </button>
        <button
          type="button"
          className="au-link au-link--block"
          onClick={cambiarCuenta}
          disabled={pending}
        >
          No soy yo — cambiar de cuenta
        </button>
      </div>
    </Pane>
  );
}
