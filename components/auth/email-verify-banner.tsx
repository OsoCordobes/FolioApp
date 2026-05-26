"use client";

/**
 * Folio · EmailVerifyBanner
 *
 * Shown above the main app shell when the current user's email is not yet
 * verified (`session.emailVerified === false`). Today this is essentially
 * never true because signup auto-confirms — the banner is here as
 * forward-looking infrastructure for two cases:
 *
 *   1. Email-change flows: when a user updates their email in the future,
 *      Supabase clears email_confirmed_at until they click the new
 *      confirmation link. The banner activates automatically during that
 *      window.
 *   2. Switch to verified signup: when we eventually flip
 *      `admin.createUser({ email_confirm: true })` to `auth.signUp()` with
 *      real verification, every new signup hits this banner with zero
 *      additional UI work.
 *
 * Behavior:
 *   - "Send link" calls the W9 server action and writes the request id to
 *     sessionStorage so a refresh doesn't re-fire.
 *   - "Sent" state with a 5-min cooldown to discourage abuse.
 *   - "Dismiss" hides the banner for the rest of the session (sessionStorage
 *     key, NOT localStorage — we want it back on next browser session so
 *     unverified state stays visible).
 */

import { useEffect, useState, useTransition } from "react";

import { requestEmailVerification } from "@/app/(public)/login/actions";

const DISMISS_KEY = "folio.email-verify-banner.dismissed";
const COOLDOWN_KEY = "folio.email-verify-banner.cooldown-until";
const COOLDOWN_MS = 5 * 60 * 1000;

interface EmailVerifyBannerProps {
  /** Email of the current user — shown in the banner copy. */
  email: string;
}

export function EmailVerifyBanner({ email }: EmailVerifyBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [status, setStatus] = useState<"idle" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  // Hydrate dismissed + cooldown from sessionStorage. Effect (not initial
  // state) so server render matches client render.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === "1") setDismissed(true);
      const raw = sessionStorage.getItem(COOLDOWN_KEY);
      if (raw) {
        const ts = Number(raw);
        if (Number.isFinite(ts) && ts > Date.now()) {
          setCooldownUntil(ts);
          setStatus("sent");
        }
      }
    } catch {
      // Privacy-mode browsers, ignore.
    }
  }, []);

  // Tick down cooldown UI label so the user sees the countdown move.
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    if (!cooldownUntil) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  if (dismissed) return null;

  const onSend = () => {
    if (pending) return;
    if (cooldownUntil && cooldownUntil > Date.now()) return;
    setError(null);
    startTransition(async () => {
      const result = await requestEmailVerification();
      if (!result.ok) {
        setStatus("error");
        setError(result.error ?? "Algo salió mal.");
        return;
      }
      const next = Date.now() + COOLDOWN_MS;
      setStatus("sent");
      setCooldownUntil(next);
      try {
        sessionStorage.setItem(COOLDOWN_KEY, String(next));
      } catch {
        // Privacy mode, ignore.
      }
    });
  };

  const onDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Privacy mode, ignore.
    }
  };

  const secondsLeft = cooldownUntil
    ? Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000))
    : 0;

  return (
    <div
      role="status"
      className="fi-email-verify-banner"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 16px",
        background: "var(--surface-soft, #fff7e0)",
        borderBottom: "1px solid var(--accent-warm, #d8b766)",
        fontSize: 13,
        color: "var(--ink-2, #6b5a2e)",
      }}
    >
      <span aria-hidden style={{ fontSize: 16 }}>✉️</span>
      <div style={{ flex: 1, lineHeight: 1.4 }}>
        {status === "sent" ? (
          <>
            Te enviamos un link a <b>{email}</b>. Revisá tu casilla (puede
            tardar un minuto). {secondsLeft > 0 ? `Podés reenviar en ${formatCooldown(secondsLeft)}.` : ""}
          </>
        ) : status === "error" ? (
          <>
            {error ?? "No pude enviar el link."}{" "}
            <button
              type="button"
              onClick={onSend}
              disabled={pending}
              className="au-link"
              style={{ background: "none", border: 0, cursor: "pointer", padding: 0 }}
            >
              Reintentar
            </button>
          </>
        ) : (
          <>
            Verificá <b>{email}</b> para recibir recordatorios y links de
            recuperación.{" "}
            <button
              type="button"
              onClick={onSend}
              disabled={pending}
              className="au-link"
              style={{ background: "none", border: 0, cursor: "pointer", padding: 0 }}
            >
              {pending ? "Enviando…" : "Enviar link"}
            </button>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Ocultar este aviso"
        title="Ocultar"
        style={{
          background: "none",
          border: 0,
          cursor: "pointer",
          fontSize: 18,
          lineHeight: 1,
          padding: "0 4px",
          color: "inherit",
        }}
      >
        ×
      </button>
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
