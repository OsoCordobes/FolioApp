"use client";

/**
 * Folio · Auth · forms (Login, Signup, Forgot).
 *
 * Port fiel de auth.jsx (líneas 1176-1411). En F1 son visualmente
 * idénticos al prototipo; el `onSubmit` es no-op (preventDefault) y
 * se conecta a Supabase en F3. La navegación entre vistas (login →
 * signup → forgot) es interna y client-side.
 */

import { useMemo, useState, type ReactNode } from "react";

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
  onSubmit: () => void;
}

function Login({ setVista, onSubmit }: SubViewProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");

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
    onSubmit();
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

      <button type="button" className="au-btn-google" onClick={onSubmit}>
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
            }}
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

        <button type="submit" className="fi-btn fi-btn-primary au-submit">
          Entrar
          <ArrowRightTiny />
        </button>
      </form>
    </AuthShell>
  );
}

// ─── Signup ────────────────────────────────────────────────────────────────

function Signup({ setVista, onSubmit }: SubViewProps) {
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);

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

      <button type="button" className="au-btn-google" onClick={onSubmit}>
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
          onSubmit();
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

        <p className="au-fine">
          Al crear tu cuenta, aceptás los{" "}
          <a href="#" className="au-link">
            términos
          </a>{" "}
          y la{" "}
          <a href="#" className="au-link">
            privacidad
          </a>
          .
        </p>

        <button type="submit" className="fi-btn fi-btn-primary au-submit">
          Empezar 7 días gratis
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

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (email.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)) setSent(true);
  };

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
    </AuthShell>
  );
}

// ─── Composer (default export) ─────────────────────────────────────────────

export function AuthForms({ initialVista = "login" }: { initialVista?: Vista }) {
  const [vista, setVista] = useState<Vista>(initialVista);
  // En F1 onSubmit no hace nada real. F3 lo conecta a Supabase Auth.
  const onSubmit = () => {
    // TODO[F3]: invocar Server Action de signIn / signUp / recovery.
  };

  return (
    <main className="au-main">
      {vista === "login" ? <Login setVista={setVista} onSubmit={onSubmit} /> : null}
      {vista === "signup" ? <Signup setVista={setVista} onSubmit={onSubmit} /> : null}
      {vista === "forgot" ? <Forgot setVista={setVista} /> : null}
    </main>
  );
}
