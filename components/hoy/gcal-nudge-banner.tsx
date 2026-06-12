"use client";

/**
 * Folio · GcalNudgeBanner — empujón de conexión de Google Calendar en /hoy.
 *
 * La visión del producto: "todo tiene que ser un espejo del Google Calendar
 * del profesional". El OAuth one-time es inevitable, pero hoy vive enterrado
 * en /configuracion → Integraciones. Este banner lo trae al primer plano:
 * el Server Component de /hoy decide el modo (lib/google/health.ts,
 * decideGcalNudge) y acá solo se resuelve la interacción:
 *
 *   - modo "conectar":   colegiado sin integración GOOGLE_CALENDAR.
 *   - modo "reconectar": integración muerta (Google revocó el refresh token
 *     → invalid_grant persistido en integration.ultimo_error).
 *
 * CTA: reusa la server action `connectGoogleCalendar()` (redirect al consent
 * de Google). Dismiss: localStorage por member, 7 días de silencio
 * (GCAL_NUDGE_DISMISS_MS). Mismo patrón visual que EmailVerifyBanner:
 * franja sobria arriba del contenido, tokens de folio.css.
 */

import { useEffect, useState, useTransition } from "react";

import {
  gcalNudgeDismissKey,
  isNudgeDismissVigente,
  type GcalNudgeModo,
} from "@/lib/google/health";

import { connectGoogleCalendar } from "@/app/(app)/configuracion/actions";

const COPY: Record<GcalNudgeModo, { texto: React.ReactNode; cta: string; ctaPending: string }> = {
  conectar: {
    texto: (
      <>
        <b>Conectá tu Google Calendar</b> para que tus turnos se reflejen solos
        y tus eventos personales bloqueen horarios en la agenda.
      </>
    ),
    cta: "Conectar Google Calendar",
    ctaPending: "Abriendo Google…",
  },
  reconectar: {
    texto: (
      <>
        <b>Tu Google Calendar se desconectó</b> (Google revocó el acceso).
        Reconectalo para que tus turnos se sigan reflejando solos.
      </>
    ),
    cta: "Reconectar",
    ctaPending: "Abriendo Google…",
  },
};

interface GcalNudgeBannerProps {
  modo: GcalNudgeModo;
  /** member.id de la sesión — namespacea la clave de dismiss en localStorage. */
  memberId: string;
}

export function GcalNudgeBanner({ modo, memberId }: GcalNudgeBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Hidratar el dismiss desde localStorage en un efecto (no en el estado
  // inicial) para que el render del server coincida con el primer render del
  // cliente — mismo criterio que EmailVerifyBanner.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(gcalNudgeDismissKey(memberId));
      if (raw != null && isNudgeDismissVigente(Number(raw), Date.now())) {
        setDismissed(true);
      }
    } catch {
      // Privacy mode / storage bloqueado: el banner se muestra igual.
    }
  }, [memberId]);

  if (dismissed) return null;

  const onConnect = () => {
    if (pending) return;
    setActionError(null);
    startTransition(async () => {
      const result = await connectGoogleCalendar();
      // En éxito la action hace redirect() server-side (throw NEXT_REDIRECT)
      // y nunca llegamos acá; solo aterriza el envelope de error (p. ej.
      // GOOGLE_OAUTH_CLIENT_ID sin configurar).
      if (result && !result.ok) {
        setActionError(result.error.message);
      }
    });
  };

  const onDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(gcalNudgeDismissKey(memberId), String(Date.now()));
    } catch {
      // Privacy mode: se oculta solo por esta vista.
    }
  };

  const copy = COPY[modo];

  return (
    <div
      role="status"
      className="fi-gcal-nudge-banner"
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
      <span aria-hidden style={{ display: "flex", flexShrink: 0 }}>
        <svg width="16" height="16" viewBox="0 0 24 24">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
      </span>
      <div style={{ flex: 1, lineHeight: 1.4 }}>
        {copy.texto}
        {actionError ? (
          <span role="alert" style={{ display: "block", color: "var(--red, #991b1b)" }}>
            {actionError}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className="fi-btn fi-btn-primary"
        onClick={onConnect}
        disabled={pending}
        style={{ flexShrink: 0 }}
      >
        {pending ? copy.ctaPending : copy.cta}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Ocultar este aviso por 7 días"
        title="Ocultar por 7 días"
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
