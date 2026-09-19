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

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

// Window.turnstile global type lives in components/booking/booking-wizard.tsx

import {
  requestPasswordReset,
  resendSignupConfirmation,
  signInWithGoogle,
  signInWithPassword,
} from "@/app/(public)/login/actions";
import { signUpAndInitOrganization } from "@/app/(public)/onboarding/actions";
import { CheckEmailPanel } from "@/components/auth/check-email-panel";
import { PasswordStrengthMeter } from "@/components/auth/password-strength-meter";
import { TurnstileChallenge } from "@/components/auth/turnstile-challenge";
import { FolioMark } from "@/components/folio-mark";
import { MENSAJE_OAUTH_GENERICO, mensajeOauth } from "@/lib/auth/oauth-messages";
import { safeRedirect } from "@/lib/security/safe-redirect";
import { supportMailto } from "@/lib/support";

type Vista = "login" | "signup" | "forgot";

interface AuthShellProps {
  children: ReactNode;
  vistaSwitch?: ReactNode;
}

function AuthShell({ children, vistaSwitch }: AuthShellProps) {
  return (
    <div className="au-form-pane fx-auth-form">
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
  setVista: (v: Vista, email?: string) => void;
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

function Login({ setVista, prefilledEmail, notice, clearNotice }: LoginProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(prefilledEmail ?? "");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  // Ítem 1.5: código machine-readable del error de login. Con
  // "email_not_confirmed" mostramos el botón "Reenviar link" bajo el error.
  const [errCode, setErrCode] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const loginInFlightRef = useRef(false);
  // Captcha PROGRESIVO (F-AUTH): el server no lo pide en los primeros intentos
  // de la hora — un profesional que entra a su consultorio no ve nada. Recién
  // cuando responde `captcha_required` montamos el widget y reintentamos con
  // el token. Ver LOGIN_CAPTCHA_AFTER en app/(public)/login/actions.ts.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const captchaVisible = errCode === "captcha_required";

  // Si la URL trae ?error=<code> (típicamente desde el OAuth callback),
  // traducir y mostrar el mensaje amigable en el banner de error.
  useEffect(() => {
    const errorCode = searchParams.get("error");
    if (errorCode) {
      setErr(mensajeOauth(errorCode));
    }
  }, [searchParams]);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (loginInFlightRef.current) return;
    if (!email.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)) {
      setErr("Ingresá un email válido");
      return;
    }
    // Login NO impone largo mínimo: cuentas legacy pueden tener contraseñas
    // <8 chars; la validación de credenciales la hace el server/Supabase Auth.
    // El min(8) se conserva solo en el alta (signup). (audit L1)
    if (!password) {
      setErr("Ingresá tu contraseña");
      return;
    }
    if (captchaVisible && TURNSTILE_SITE_KEY && !captchaToken) {
      setErr("Esperá a que termine la verificación de seguridad.");
      return;
    }
    loginInFlightRef.current = true;
    setErr("");
    startTransition(async () => {
      try {
        const result = await signInWithPassword(email, password, {
          turnstileToken: captchaToken,
        });
        if (!result.ok) {
          setErr(result.error ?? "Error al entrar");
          setErrCode(result.code ?? (captchaVisible ? "captcha_required" : null));
          // A submitted token may already be consumed, even when login fails.
          if (captchaVisible) setCaptchaResetKey((value) => value + 1);
          return;
        }
        const redirect = safeRedirect(searchParams.get("redirect"), "/hoy");
        router.push(redirect);
        router.refresh();
      } catch {
        setErr("No pudimos confirmar el ingreso. Comprobá tu sesión antes de volver a intentar.");
        if (captchaVisible) setCaptchaResetKey((value) => value + 1);
      } finally {
        loginInFlightRef.current = false;
      }
    });
  };

  const handleGoogle = () => {
    setErr("");
    setErrCode(null);
    startTransition(async () => {
      // En el camino feliz `signInWithGoogle` hace un redirect() del server y
      // esta línea no se alcanza. Si devuelve, devuelve un fallo — y hasta
      // ahora se descartaba: el usuario apretaba el botón y no pasaba
      // absolutamente nada, ni un mensaje. Ese silencio es lo que hizo
      // indistinguible "Google está mal configurado" de "el botón no anda".
      const result = await signInWithGoogle();
      if (result && !result.ok) setErr(result.error ?? MENSAJE_OAUTH_GENERICO);
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
        <h1>Volvé a tu consultorio.</h1>
        <p>Ingresá para seguir con tu día en Folio.</p>
      </header>

      {notice ? (
        <p className="au-notice fx-auth-notice" role="status">
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

      <form className="au-form" onSubmit={submit} aria-busy={pending}>
        <label className={"au-field" + (err && !email ? " is-err" : "")}>
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            aria-invalid={Boolean(err && !email)}
            aria-describedby={err ? "fx-login-error" : undefined}
            placeholder="vos@consultorio.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setErr("");
              setErrCode(null);
              clearNotice?.();
            }}
            disabled={pending}
          />
        </label>
        <div className={"au-field" + (err && email && !password ? " is-err" : "")}>
          <span className="au-field-row">
            <label htmlFor="fx-login-password">Contraseña</label>
            <button
              type="button"
              className="au-link au-link--ghost"
              onClick={() => setVista("forgot", email)}
            >
              ¿La olvidaste?
            </button>
          </span>
          <div className="au-pw">
            <input
              id="fx-login-password"
              type={showPw ? "text" : "password"}
              autoComplete="current-password"
              aria-invalid={Boolean(err && email && !password)}
              aria-describedby={err ? "fx-login-error" : undefined}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setErr("");
                setErrCode(null);
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
        </div>

        {err ? <p id="fx-login-error" className="au-err" role="alert">{err}</p> : null}
        {errCode === "email_not_confirmed" ? (
          <ResendConfirmationInline email={email} />
        ) : null}
        {captchaVisible && TURNSTILE_SITE_KEY ? <TurnstileChallenge onTokenChange={setCaptchaToken} resetKey={captchaResetKey} /> : null}

        <button
          type="submit"
          className="fi-btn fi-btn-primary au-submit"
          disabled={pending || (captchaVisible && Boolean(TURNSTILE_SITE_KEY) && !captchaToken)}
        >
          {pending ? "Ingresando…" : "Ingresar a Folio"}
          <ArrowRightTiny />
        </button>
      </form>
    </AuthShell>
  );
}

/**
 * Ítem 1.5 · Botón inline "Reenviar link" bajo el error de login cuando la
 * cuenta existe pero el email no está confirmado. Cooldown local de 60s para
 * no martillar la action (que además tiene rate-limit server-side).
 */
function ResendConfirmationInline({ email }: { email: string }) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  // Tick para que el disabled expire solo.
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    if (!cooldownUntil) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  const coolingDown = Boolean(cooldownUntil && cooldownUntil > Date.now());

  const onResend = () => {
    if (pending || coolingDown) return;
    setError(null);
    startTransition(async () => {
      const result = await resendSignupConfirmation(email);
      if (!result.ok) {
        setError(result.error ?? "No pude reenviar el link. Probá de nuevo.");
        return;
      }
      setSent(true);
      setCooldownUntil(Date.now() + 60_000);
    });
  };

  return (
    <div style={{ fontSize: 13, lineHeight: 1.5 }}>
      {error ? <p className="au-err">{error}</p> : null}
      {sent && !error ? (
        <p role="status" style={{ margin: "0 0 4px", color: "var(--ink-2)" }}>
          Link enviado a <b>{email}</b>. Revisá tu casilla.
        </p>
      ) : null}
      <button
        type="button"
        className="au-link"
        onClick={onResend}
        disabled={pending || coolingDown}
      >
        {pending ? "Reenviando…" : coolingDown ? "Link enviado (esperá un minuto)" : "Reenviar link de confirmación"}
      </button>
    </div>
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
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  // Ítem 1.5: email esperando confirmación (Confirm email ON). Mientras esté
  // set, reemplazamos el form por el CheckEmailPanel.
  const [awaitingEmail, setAwaitingEmail] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const signupInFlightRef = useRef(false);

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
    if (signupInFlightRef.current) return;
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
    signupInFlightRef.current = true;
    setErr("");
    startTransition(async () => {
      try {
        const result = await signUpAndInitOrganization(email, password, {
          turnstileToken: captchaToken,
          consent: true,
        });
        if (!result.ok) {
          setCaptchaResetKey((value) => value + 1);
          const msg = result.error ?? "";
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
        if (result.needsConfirmation) {
          setErr("");
          setAwaitingEmail(email);
          return;
        }
        const params = new URLSearchParams(nombre ? { nombre } : {});
        const qs = params.toString();
        startTransition(() => {
          router.push(qs ? `/onboarding?${qs}` : "/onboarding");
          router.refresh();
        });
      } catch {
        setErr("No pudimos confirmar si la cuenta se creó. Si ya tenés cuenta, entrá; si no, reintentá la verificación.");
        setCaptchaResetKey((value) => value + 1);
      } finally {
        signupInFlightRef.current = false;
      }
    });
  };
  const handleGoogle = () => {
    setErr("");
    startTransition(async () => {
      // Mismo motivo que en el login: el Result se descartaba y el botón
      // parecía muerto cuando el OAuth no estaba bien configurado.
      const result = await signInWithGoogle();
      if (result && !result.ok) setErr(result.error ?? MENSAJE_OAUTH_GENERICO);
    });
  };

  // Ítem 1.5: post-signup con Confirm email ON — panel "Revisá tu email".
  // (Después de TODOS los hooks para no romper las reglas de hooks.)
  if (awaitingEmail) {
    return (
      <CheckEmailPanel
        email={awaitingEmail}
        onBack={() => {
          // Token de Turnstile ya consumido en el intento de signup; el
          // effect (deps [awaitingEmail]) renderiza un widget fresco.
          setCaptchaToken(null);
          setAwaitingEmail(null);
        }}
      />
    );
  }

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
        <h1>Tu práctica empieza acá.</h1>
        <p>Creá tu cuenta y configurá tu consultorio paso a paso.</p>
      </header>

      <button type="button" className="au-btn-google" onClick={handleGoogle} disabled={pending}>
        <GoogleLogo />
        Continuar con Google
      </button>

      <div className="au-divider">
        <span>o con tu email</span>
      </div>

      <form
        className="au-form"
        aria-busy={pending}
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
          <PasswordStrengthMeter password={password} />
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
        {TURNSTILE_SITE_KEY ? <TurnstileChallenge onTokenChange={setCaptchaToken} resetKey={captchaResetKey} /> : null}

        {err ? <p className="au-err" role="alert">{err}</p> : null}

        <button
          type="submit"
          className="fi-btn fi-btn-primary au-submit"
          disabled={pending || !consent || (Boolean(TURNSTILE_SITE_KEY) && !captchaToken)}
        >
          {pending ? "Creando cuenta…" : "Crear cuenta"}
          <ArrowRightTiny />
        </button>
      </form>
    </AuthShell>
  );
}

// ─── Forgot password ───────────────────────────────────────────────────────

function Forgot({ setVista, prefilledEmail = "" }: SubViewProps & { prefilledEmail?: string }) {
  const [email, setEmail] = useState(prefilledEmail);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();
  const resetInFlightRef = useRef(false);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const sentHeadingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (sent) sentHeadingRef.current?.focus({ preventScroll: true });
  }, [sent]);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (resetInFlightRef.current) return;
    if (!email.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)) {
      setErr("Ingresá un email válido para recuperar tu acceso.");
      emailRef.current?.focus();
      return;
    }
    resetInFlightRef.current = true;
    setErr("");
    startTransition(async () => {
      try {
        const result = await requestPasswordReset(email);
        if (!result.ok) {
          setErr(result.error ?? "No pudimos pedir el enlace. Probá más tarde.");
          return;
        }
        // El servidor da el mismo resultado para emails existentes e inexistentes.
        setSent(true);
      } catch {
        setErr("No pudimos confirmar el envío. Revisá tu email antes de volver a intentar.");
      } finally {
        resetInFlightRef.current = false;
      }
    });
  };

  if (sent) {
    return (
      <AuthShell
        vistaSwitch={
          <p>
            <button type="button" className="au-link" onClick={() => setVista("login", email)}>
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
          <h1 ref={sentHeadingRef} tabIndex={-1} className="a11y-focus-heading">Revisá tu email.</h1>
          <p>
            Si hay una cuenta asociada a <b>{email}</b>, recibirás un enlace para recuperar el acceso.
            Revisá también la carpeta de spam o promociones.
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
          <button type="button" className="au-link" onClick={() => setVista("login", email)}>
            Volver a entrar
          </button>
        </p>
      }
    >
      <header className="au-form-head">
        <h1>Recuperá tu acceso.</h1>
        <p>Te enviaremos un enlace para elegir una nueva contraseña.</p>
      </header>
      <form className="au-form" onSubmit={submit} aria-busy={pending} noValidate>
        <label className={`au-field${err ? " is-err" : ""}`}>
          <span>Email de tu cuenta</span>
          <input
            type="email"
            ref={emailRef}
            autoComplete="email"
            required
            aria-invalid={Boolean(err)}
            aria-describedby={err ? "fx-forgot-error" : undefined}
            placeholder="vos@consultorio.com"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setErr(""); }}
            disabled={pending}
            autoFocus
          />
        </label>
        {err ? <p id="fx-forgot-error" className="au-err" role="alert">{err}</p> : null}
        <button type="submit" className="fi-btn fi-btn-primary au-submit" disabled={pending}>
          {pending ? "Enviando…" : "Enviar enlace de recuperación"}
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
          href={supportMailto("Recuperación de cuenta")}
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
  const switchVista = (next: Vista, email?: string) => {
    if (email !== undefined) setPrefilledEmail(email);
    setVista(next);
  };

  return (
    <main className="au-main fx-auth-main">
      <Link className="fx-auth-brand fx-auth-form-brand" href="/" aria-label="Folio, volver al inicio">
        <FolioMark size={29} />
        <span>folio</span>
      </Link>
      {vista === "login" ? (
        <Login
          setVista={switchVista}
          prefilledEmail={prefilledEmail}
          notice={notice}
          clearNotice={clearNotice}
        />
      ) : null}
      {vista === "signup" ? (
        <Signup setVista={setVista} switchToLoginWith={switchToLoginWith} />
      ) : null}
      {vista === "forgot" ? <Forgot setVista={switchVista} prefilledEmail={prefilledEmail} /> : null}
    </main>
  );
}
