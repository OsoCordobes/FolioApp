"use client";

/**
 * Folio · Auth · forms (Login, Signup, Forgot).
 *
 * En F3 los forms están conectados a Server Actions de Supabase:
 *   - Login → signInWithPassword / signInWithGoogle
 *   - Signup → signUpAndInitOrganization (Ley 25.326 consent + Turnstile +
 *     rate-limit, audit-prep Phase 4)
 *   - Forgot → requestPasswordReset
 *
 * Estado pendiente del submit: `pending` flag deshabilita el botón y muestra
 * "Entrando..." mientras la Server Action resuelve.
 */

import Script from "next/script";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

// Window.turnstile global type lives in components/booking/booking-wizard.tsx

import {
  requestPasswordReset,
  signInWithGoogle,
  signInWithPassword,
} from "@/app/(public)/login/actions";
import { signUpAndInitOrganization } from "@/app/(public)/onboarding/actions";
import { safeRedirect } from "@/lib/security/safe-redirect";

type Vista = "login" | "signup" | "forgot";

interface AuthShellProps {
  children: ReactNode;
  vistaSwitch?: ReactNode;
}

function AuthShell({ children, vistaSwitch }: AuthShellProps) {
  return (
    <div className="au-form-pane">
      <div className="au-form-inner">{children}</div>
      {vistaSwitch ? <div className="au-form-switch">{vistaSwitch}</div> : null}
    </div>
  );
}

const GoogleLogo = () => (
  <svg width="16" height="16" viewBox="0 0 24 24">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

const ArrowRightTiny = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

const EyeOpen = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeClosed = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <path d="M1 1l22 22" />
  </svg>
);

// ─── Login ─────────────────────────────────────────────────────────────────

interface SubViewProps {
  setVista: (v: Vista) => void;
}

interface LoginProps extends SubViewProps {
  prefilledEmail?: string;
  /** Banner mostrado encima del form (p.ej. cuando viene de "ya existe ese email"). */
  notice?: string | null;
  clearNotice?: () => void;
}

/**
 * Mapeo de códigos de error del OAuth callback (definido en
 * app/api/auth/callback/route.ts:mapAuthError) a mensajes user-facing.
 * El callback redirige a /login?error=<code> cuando exchangeCodeForSession falla.
 */
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  oauth_failed:  "No pude completar el ingreso con Google. Reintentá.",
  rate_limited:  "Demasiados intentos seguidos. Esperá un minuto y reintentá.",
  code_expired:  "El link de Google expiró. Volvé a apretar 'Ingresar con Google'.",
  code_invalid:  "El código de Google no es válido. Reintentá el ingreso.",
  network:       "Hubo un problema de red al validar tu ingreso. Reintentá.",
};

function Login({ setVista, prefilledEmail, notice, clearNotice }: LoginProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(prefilledEmail ?? "");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  const [pending, startTransition] = useTransition();

  // Si la URL trae ?error=<code> (típicamente desde el OAuth callback),
  // traducir y mostrar el mensaje amigable en el banner de error.
  useEffect(() => {
    const errorCode = searchParams.get("error");
    if (errorCode) {
      const msg = OAUTH_ERROR_MESSAGES[errorCode] ?? "Algo salió mal con el ingreso. Reintentá.";
      setErr(msg);
    }
  }, [searchParams]);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!email.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)) {
      setErr("Ingresá un email válido");
      return;
    }
    if (password.length < 8) {
      setErr("Mínimo 8 caracteres");
      return;
    }
    setErr("");
    startTransition(async () => {
      const result = await signInWithPassword(email, password);
      if (!result.ok) {
        setErr(result.error ?? "Error al entrar");
        return;
      }
      // Mitigate open-redirect (Ley 25.326 + OWASP A01). Only same-origin
      // paths are honored; anything else (//evil.com, https://, javascript:,
      // etc.) falls back to /hoy.
      const redirect = safeRedirect(searchParams.get("redirect"), "/hoy");
      router.push(redirect);
      router.refresh();
    });
  };

  const handleGoogle = () => {
    startTransition(async () => {
      await signInWithGoogle();
      // Si redirige al provider, no llegamos acá; si falla, el error se muestra
      // recargando la página con ?error= (middleware no captura esto en F3).
    });
  };

  return (
    <AuthShell
      vistaSwitch={
        <p>
          ¿No tenés cuenta?{" "}
          <button type="button" className="au-link" onClick={() => setVista("signup")}>
            Crear cuenta
          </button>
        </p>
      }
    >
      <header className="au-form-head">
        <h2>Entrar</h2>
      </header>

      {notice ? (
        <p className="au-notice" role="status" style={{
          margin: "0 0 12px",
          padding: "10px 12px",
          background: "var(--accent-warm-soft)",
          color: "var(--accent-warm-2)",
          border: "1px solid var(--accent-warm)",
          borderRadius: "var(--r-md)",
          fontSize: "var(--fs-sm)",
        }}>
          {notice}
        </p>
      ) : null}

      <button type="button" className="au-btn-google" onClick={handleGoogle} disabled={pending}>
        <GoogleLogo />
        Continuar con Google
      </button>

      <div className="au-divider">
        <span>o con tu email</span>
      </div>

      <form className="au-form" onSubmit={submit}>
        <label className={"au-field" + (err && !email ? " is-err" : "")}>
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            placeholder="vos@consultorio.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setErr("");
              clearNotice?.();
            }}
            disabled={pending}
          />
        </label>
        <label className={"au-field" + (err && email && password.length < 8 ? " is-err" : "")}>
          <span className="au-field-row">
            Contraseña
            <button
              type="button"
              className="au-link au-link--ghost"
              onClick={() => setVista("forgot")}
            >
              ¿La olvidaste?
            </button>
          </span>
          <div className="au-pw">
            <input
              type={showPw ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setErr("");
              }}
              disabled={pending}
            />
            <button
              type="button"
              className="au-pw-toggle"
              onClick={() => setShowPw((s) => !s)}
              aria-label={showPw ? "Ocultar contraseña" : "Mostrar contraseña"}
            >
              {showPw ? <EyeClosed /> : <EyeOpen />}
            </button>
          </div>
        </label>

        {err ? <p className="au-err">{err}</p> : null}

        <button type="submit" className="fi-btn fi-btn-primary au-submit" disabled={pending}>
          {pending ? "Entrando..." : "Entrar"}
          <ArrowRightTiny />
        </button>
      </form>
    </AuthShell>
  );
}

// ─── Signup ────────────────────────────────────────────────────────────────

interface SignupProps extends SubViewProps {
  switchToLoginWith: (email: string, notice: string) => void;
}

function Signup({ setVista, switchToLoginWith }: SignupProps) {
  void setVista;
  const router = useRouter();
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  const [consent, setConsent] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaContainerRef = useRef<HTMLDivElement | null>(null);
  const captchaWidgetIdRef = useRef<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Render Turnstile when the Signup view mounts. Site-key absence
  // (dev / visual regression) skips the widget; verifyTurnstile()
  // server-side returns true under the same env condition.
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    if (!captchaContainerRef.current) return;
    // El Script de Cloudflare puede no haber cargado aún cuando este effect
    // corre. Polleamos cada 200ms hasta que window.turnstile exista.
    const tryRender = () => {
      if (!window.turnstile) return false;
      if (captchaWidgetIdRef.current) return true;
      captchaWidgetIdRef.current = window.turnstile.render(captchaContainerRef.current!, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: "auto",
        size: "flexible",
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
  }, []);

  // Signup desde /login crea la auth.user + organization placeholder + member
  // OWNER en una sola server-action atomica. El password se consume server-side;
  // si la action devuelve ok, hay cookie de sesión y el redirect a /onboarding
  // resume en Step 2 (sin volver a pedir password).
  //
  // Si el email ya tiene cuenta:
  //   - signUpAndInitOrganization detecta "already" en el error de admin.createUser
  //     y intenta sign-in con el password recibido. Si el password coincide,
  //     devuelve ok (la flow se retoma como un login normal).
  //   - Si el password NO coincide, la action devuelve error y nosotros saltamos
  //     a la vista login con el email prefillado + banner explicando.
  const handleSignup = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!email.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)) {
      setErr("Ingresá un email válido");
      return;
    }
    if (password.length < 8) {
      setErr("Mínimo 8 caracteres");
      return;
    }
    if (!consent) {
      setErr("Tenés que aceptar el aviso de privacidad para continuar.");
      return;
    }
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      setErr("Esperá unos segundos a que el captcha verifique.");
      return;
    }
    setErr("");
    startTransition(async () => {
      const result = await signUpAndInitOrganization(email, password, {
        turnstileToken: captchaToken,
        consent: true,
      });
      if (!result.ok) {
        const msg = result.error ?? "";
        // Heuristic: existing-account paths surface error messages mentioning
        // "already", "registered", "Invalid login credentials", "no pude entrar".
        const looksLikeExistingAccount =
          /already|registered|invalid login|no pude entrar|sesión|sesion/i.test(msg);
        if (looksLikeExistingAccount) {
          switchToLoginWith(
            email,
            "Esa cuenta ya existe. Entrá con tu contraseña — si la olvidaste, usá el link de abajo.",
          );
          return;
        }
        setErr(msg || "No pude crear la cuenta. Probá de nuevo.");
        return;
      }
      // Account created + cookie set. Pass nombre via URL so Step 2 can prefill.
      const params = new URLSearchParams(nombre ? { nombre } : {});
      const qs = params.toString();
      startTransition(() => {
        router.push(qs ? `/onboarding?${qs}` : "/onboarding");
        router.refresh();
      });
    });
  };
  const handleGoogle = () => {
    startTransition(async () => {
      await signInWithGoogle();
    });
  };

  const pwStrength = useMemo(() => {
    if (!password) return 0;
    let s = 0;
    if (password.length >= 8) s++;
    if (password.length >= 12) s++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) s++;
    if (/\d/.test(password)) s++;
    if (/[^a-zA-Z0-9]/.test(password)) s++;
    return Math.min(s, 4);
  }, [password]);
  const pwLbl = ["Muy débil", "Débil", "Aceptable", "Buena", "Excelente"][pwStrength];

  return (
    <AuthShell
      vistaSwitch={
        <p>
          ¿Ya tenés cuenta?{" "}
          <button type="button" className="au-link" onClick={() => setVista("login")}>
            Entrar
          </button>
        </p>
      }
    >
      <header className="au-form-head">
        <h2>Crear cuenta</h2>
      </header>

      <button type="button" className="au-btn-google" onClick={handleGoogle}>
        <GoogleLogo />
        Continuar con Google
      </button>

      <div className="au-divider">
        <span>o con tu email</span>
      </div>

      <form
        className="au-form"
        onSubmit={(e) => {
          e.preventDefault();
          handleSignup();
        }}
      >
        <label className="au-field">
          <span>Nombre y apellido</span>
          <input
            type="text"
            autoComplete="name"
            placeholder="Lorenzo Martínez"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </label>
        <label className="au-field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            placeholder="vos@consultorio.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="au-field">
          <span>Contraseña</span>
          <div className="au-pw">
            <input
              type={showPw ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Mínimo 8 caracteres"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="au-pw-toggle"
              onClick={() => setShowPw((s) => !s)}
              aria-label={showPw ? "Ocultar contraseña" : "Mostrar contraseña"}
            >
              {showPw ? <EyeClosed /> : <EyeOpen />}
            </button>
          </div>
          {password ? (
            <div className="au-pw-meter">
              <div className="au-pw-meter-bars">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className={i < pwStrength ? `au-pw-bar is-on s-${pwStrength}` : "au-pw-bar"} />
                ))}
              </div>
              <span className="au-pw-label">{pwLbl}</span>
            </div>
          ) : null}
        </label>

        {/* Ley 25.326 art. 14: explicit informed consent before processing PII */}
        <label className="au-consent" style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, lineHeight: 1.5 }}>
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => {
              setConsent(e.target.checked);
              setErr("");
            }}
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

        {/* Cloudflare Turnstile — invisible captcha. Only rendered if a site key is set. */}
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

        <button
          type="submit"
          className="fi-btn fi-btn-primary au-submit"
          disabled={pending || !consent || (Boolean(TURNSTILE_SITE_KEY) && !captchaToken)}
        >
          {pending ? "Creando cuenta…" : "Empezar 7 días gratis"}
          <ArrowRightTiny />
        </button>
      </form>
    </AuthShell>
  );
}

// ─── Forgot password ───────────────────────────────────────────────────────

function Forgot({ setVista }: { setVista: (v: Vista) => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!email.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)) return;
    startTransition(async () => {
      await requestPasswordReset(email);
      // Siempre marcamos como "enviado" (no confirmar si el email existe).
      setSent(true);
    });
  };
  // pending exposed via disabled below
  void pending;

  if (sent) {
    return (
      <AuthShell
        vistaSwitch={
          <p>
            <button type="button" className="au-link" onClick={() => setVista("login")}>
              ← Volver a entrar
            </button>
          </p>
        }
      >
        <div className="au-sent">
          <div className="au-sent-glyph">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-6l-2 3h-4l-2-3H2" />
              <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
            </svg>
          </div>
          <h2>Te enviamos un link.</h2>
          <p>
            Revisá <b className="fm-mono">{email}</b>. El link expira en 30 minutos. Si no lo ves, revisá la
            carpeta de spam o promociones.
          </p>
          <button type="button" className="au-link au-link--block" onClick={() => setSent(false)}>
            Reintentar con otro email
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      vistaSwitch={
        <p>
          ¿Te acordaste?{" "}
          <button type="button" className="au-link" onClick={() => setVista("login")}>
            Volver a entrar
          </button>
        </p>
      }
    >
      <header className="au-form-head">
        <h2>Recuperar contraseña</h2>
      </header>
      <form className="au-form" onSubmit={submit}>
        <label className="au-field">
          <span>Email de tu cuenta</span>
          <input
            type="email"
            autoComplete="email"
            placeholder="vos@consultorio.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </label>
        <button type="submit" className="fi-btn fi-btn-primary au-submit">
          Enviar link
          <ArrowRightTiny />
        </button>
      </form>
      <p
        style={{
          fontSize: 12,
          color: "var(--ink-2)",
          marginTop: 16,
          textAlign: "center",
          lineHeight: 1.5,
        }}
      >
        ¿Perdiste acceso al email también?{" "}
        <a
          href="mailto:soporte@folio.app?subject=Recuperaci%C3%B3n%20de%20cuenta"
          className="au-link"
        >
          Escribinos a soporte
        </a>{" "}
        con tu nombre y matrícula.
      </p>
    </AuthShell>
  );
}

// ─── Composer (default export) ─────────────────────────────────────────────

export function AuthForms({ initialVista = "login" }: { initialVista?: Vista }) {
  const [vista, setVista] = useState<Vista>(initialVista);
  const [prefilledEmail, setPrefilledEmail] = useState<string>("");
  const [notice, setNotice] = useState<string | null>(null);

  const switchToLoginWith = (email: string, msg: string) => {
    setPrefilledEmail(email);
    setNotice(msg);
    setVista("login");
  };
  const clearNotice = () => setNotice(null);

  return (
    <main className="au-main">
      {vista === "login" ? (
        <Login
          setVista={setVista}
          prefilledEmail={prefilledEmail}
          notice={notice}
          clearNotice={clearNotice}
        />
      ) : null}
      {vista === "signup" ? (
        <Signup setVista={setVista} switchToLoginWith={switchToLoginWith} />
      ) : null}
      {vista === "forgot" ? <Forgot setVista={setVista} /> : null}
    </main>
  );
}
