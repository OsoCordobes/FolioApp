"use client";

/**
 * Folio · Portal del paciente · form de login por MAGIC-LINK (Fase 3 · P3).
 *
 * El paciente ingresa su email; le mandamos un magic-link (OTP) vía
 * `sendPortalMagicLink`. Sin password. Turnstile obligatorio (mismo widget que
 * el signup de staff). Anti-enumeración: tras enviar, mostramos SIEMPRE el panel
 * "revisá tu email" (no revelamos si el email tenía cuenta).
 *
 * Reusa los tokens/clases `au-*` de folio.css (hand-written, brass/cream) — el
 * portal comparte la estética de la pantalla de auth, sin introducir CSS nuevo.
 */

import Script from "next/script";
import { useEffect, useRef, useState, useTransition } from "react";

import { sendPortalMagicLink } from "./actions";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

const ArrowRightTiny = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

const MailGlyph = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </svg>
);

export function PortalLoginForm({ initialError }: { initialError?: string | null }) {
  const [email, setEmail] = useState("");
  const [err, setErr] = useState(initialError ?? "");
  const [sent, setSent] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const captchaContainerRef = useRef<HTMLDivElement | null>(null);
  const captchaWidgetIdRef = useRef<string | null>(null);

  // Render Turnstile (mismo patrón que el signup de staff). Sin site-key
  // (dev/visual) se omite el widget y el server verifica permisivo.
  useEffect(() => {
    if (sent) return;
    if (!TURNSTILE_SITE_KEY) return;
    if (!captchaContainerRef.current) return;
    const tryRender = () => {
      if (!window.turnstile) return false;
      if (captchaWidgetIdRef.current) return true;
      captchaWidgetIdRef.current = window.turnstile.render(captchaContainerRef.current!, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: "auto",
        size: "flexible",
        callback: (token: string) => setCaptchaToken(token),
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
  }, [sent]);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!email.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)) {
      setErr("Ingresá un email válido.");
      return;
    }
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      setErr("Esperá unos segundos a que la verificación termine.");
      return;
    }
    setErr("");
    startTransition(async () => {
      const result = await sendPortalMagicLink({ email, captchaToken: captchaToken ?? undefined });
      if (!result.ok) {
        setErr(result.error ?? "No pude enviar el link. Probá de nuevo.");
        // Token de un solo uso ya consumido: forzar re-render del widget.
        setCaptchaToken(null);
        return;
      }
      setSent(true);
    });
  };

  if (sent) {
    return (
      <div className="au-form-pane">
        <div className="au-form-inner">
          <div className="au-sent">
            <div className="au-sent-glyph"><MailGlyph /></div>
            <h2>Revisá tu email.</h2>
            <p>
              Si <b className="fm-mono">{email}</b> tiene una cuenta en Folio, te
              enviamos un link para entrar. Expira en unos minutos. Revisá spam o
              promociones si no lo ves.
            </p>
            <button
              type="button"
              className="au-link au-link--block"
              onClick={() => { setSent(false); setCaptchaToken(null); }}
            >
              Usar otro email
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="au-form-pane">
      <div className="au-form-inner">
        <header className="au-form-head">
          <h2>Portal del paciente</h2>
          <p style={{ color: "var(--ink-2)", fontSize: "var(--fs-sm)", marginTop: 6 }}>
            Ingresá con tu email. Te mandamos un link — sin contraseñas.
          </p>
        </header>

        <form className="au-form" onSubmit={submit}>
          <label className="au-field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              placeholder="vos@email.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setErr(""); }}
              disabled={pending}
              autoFocus
            />
          </label>

          {TURNSTILE_SITE_KEY ? (
            <>
              <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
              <div ref={captchaContainerRef} style={{ marginTop: 4 }} />
            </>
          ) : null}

          {err ? <p className="au-err">{err}</p> : null}

          <button
            type="submit"
            className="fi-btn fi-btn-primary au-submit"
            disabled={pending || (Boolean(TURNSTILE_SITE_KEY) && !captchaToken)}
          >
            {pending ? "Enviando…" : "Enviarme el link"}
            <ArrowRightTiny />
          </button>
        </form>
      </div>
    </div>
  );
}
