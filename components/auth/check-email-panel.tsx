"use client";

/**
 * Folio · CheckEmailPanel — "Revisá tu email" post-signup (ítem 1.5).
 *
 * Se muestra cuando signUpAndInitOrganization devuelve
 * `needsConfirmation: true` (toggle "Confirm email" ON en Supabase): la
 * cuenta se creó pero no hay sesión hasta que el user abra el link del mail.
 *
 * Reenvío: llama `resendSignupConfirmation` (sin sesión, rate-limited
 * server-side) con cooldown client-side 60s el primero → 5min los
 * siguientes, persistido en sessionStorage (mismo patrón que
 * email-verify-banner.tsx) para que un refresh no resetee la ventana.
 */

import { useEffect, useState, useTransition } from "react";

import { resendSignupConfirmation } from "@/app/(public)/login/actions";

const COOLDOWN_KEY = "folio.check-email-panel.cooldown-until";
const RESENDS_KEY = "folio.check-email-panel.resends";
const COOLDOWN_FIRST_MS = 60 * 1000;
const COOLDOWN_NEXT_MS = 5 * 60 * 1000;

interface CheckEmailPanelProps {
  /** Email al que se envió el link de confirmación. */
  email: string;
  /** Vuelve al form de registro para corregir el email. */
  onBack?: () => void;
}

export function CheckEmailPanel({ email, onBack }: CheckEmailPanelProps) {
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [resends, setResends] = useState(0);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Hidratar cooldown desde sessionStorage (effect, no initial state, para
  // que el server render coincida con el client render).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(COOLDOWN_KEY);
      if (raw) {
        const ts = Number(raw);
        if (Number.isFinite(ts) && ts > Date.now()) {
          setCooldownUntil(ts);
          setSent(true);
        }
      }
      const rawResends = sessionStorage.getItem(RESENDS_KEY);
      if (rawResends) {
        const n = Number(rawResends);
        if (Number.isFinite(n) && n > 0) setResends(n);
      }
    } catch {
      // Privacy mode, ignore.
    }
  }, []);

  // Tick para que el countdown del label avance.
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    if (!cooldownUntil) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  const secondsLeft = cooldownUntil
    ? Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000))
    : 0;
  const coolingDown = secondsLeft > 0;

  const onResend = () => {
    if (pending || coolingDown) return;
    setError(null);
    startTransition(async () => {
      const result = await resendSignupConfirmation(email);
      if (!result.ok) {
        setError(result.error ?? "No pude reenviar el link. Probá de nuevo.");
        return;
      }
      const nextResends = resends + 1;
      const cooldownMs = nextResends <= 1 ? COOLDOWN_FIRST_MS : COOLDOWN_NEXT_MS;
      const next = Date.now() + cooldownMs;
      setSent(true);
      setResends(nextResends);
      setCooldownUntil(next);
      try {
        sessionStorage.setItem(COOLDOWN_KEY, String(next));
        sessionStorage.setItem(RESENDS_KEY, String(nextResends));
      } catch {
        // Privacy mode, ignore.
      }
    });
  };

  return (
    <div className="au-form-pane">
      <div className="au-form-inner">
        <header className="au-form-head">
          <h2>Revisá tu email</h2>
          <p>
            Te enviamos un link a <b>{email}</b>. Abrilo para confirmar tu
            cuenta y seguir con la configuración.
          </p>
        </header>

        <p style={{ fontSize: 13, color: "var(--ink-3)", margin: 0, lineHeight: 1.5 }}>
          Puede tardar un minuto. Si no lo ves, revisá la carpeta de spam o
          promociones.
        </p>

        {error ? (
          <p className="au-err" role="alert">
            {error}
          </p>
        ) : null}
        {sent && !error ? (
          <p role="status" style={{ fontSize: 13, color: "var(--ink-2)", margin: 0 }}>
            Link reenviado.{" "}
            {coolingDown ? `Podés volver a reenviar en ${formatCooldown(secondsLeft)}.` : ""}
          </p>
        ) : null}

        <button
          type="button"
          className="fi-btn fi-btn-primary au-submit"
          onClick={onResend}
          disabled={pending || coolingDown}
        >
          {pending ? "Reenviando…" : "Reenviar link"}
        </button>

        <p style={{ fontSize: 13, margin: 0 }}>
          ¿Ya tenías cuenta?{" "}
          <a href="/login" className="au-link">
            Iniciá sesión
          </a>
        </p>
        {onBack ? (
          <p style={{ fontSize: 13, margin: 0 }}>
            <button type="button" className="au-link" onClick={onBack}>
              Usar otro email
            </button>
          </p>
        ) : null}
      </div>
    </div>
  );
}

function formatCooldown(seconds: number): string {
  if (seconds >= 60) {
    const m = Math.ceil(seconds / 60);
    return `${m} minuto${m === 1 ? "" : "s"}`;
  }
  return `${seconds} segundo${seconds === 1 ? "" : "s"}`;
}
