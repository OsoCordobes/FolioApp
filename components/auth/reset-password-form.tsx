"use client";

/**
 * Folio · Form para elegir nueva contraseña post-reset-link.
 *
 * Reusa los estilos `au-*` del Login para mantener look & feel consistente.
 */

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { updatePassword } from "@/app/(public)/reset-password/actions";

const ArrowRightTiny = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

const EyeOpen = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeClosed = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <path d="M1 1l22 22" />
  </svg>
);

export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

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

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (password.length < 8) {
      setErr("Mínimo 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setErr("Las contraseñas no coinciden.");
      return;
    }
    setErr("");
    startTransition(async () => {
      const result = await updatePassword(password);
      if (!result.ok) {
        setErr(result.error ?? "No pudimos guardar la contraseña.");
        return;
      }
      setDone(true);
      setTimeout(() => {
        router.push("/hoy");
        router.refresh();
      }, 1200);
    });
  };

  if (done) {
    return (
      <main className="au-main">
        <div className="au-form-pane">
          <div className="au-form-inner">
            <div className="au-sent">
              <div className="au-sent-glyph">
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <h2>Contraseña actualizada.</h2>
              <p>Te llevamos a tu agenda…</p>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="au-main">
      <div className="au-form-pane">
        <div className="au-form-inner">
          <header className="au-form-head">
            <h2>Elegí tu nueva contraseña</h2>
          </header>
          <form className="au-form" onSubmit={submit}>
            <label className="au-field">
              <span>Contraseña nueva</span>
              <div className="au-pw">
                <input
                  type={showPw ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Mínimo 8 caracteres"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (err) setErr("");
                  }}
                  disabled={pending}
                  autoFocus
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
                      <span
                        key={i}
                        className={
                          i < pwStrength ? `au-pw-bar is-on s-${pwStrength}` : "au-pw-bar"
                        }
                      />
                    ))}
                  </div>
                  <span className="au-pw-label">{pwLbl}</span>
                </div>
              ) : null}
            </label>
            <label className="au-field">
              <span>Confirmar contraseña</span>
              <input
                type={showPw ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Repetí la contraseña"
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  if (err) setErr("");
                }}
                disabled={pending}
              />
            </label>

            {err ? <p className="au-err">{err}</p> : null}

            <button type="submit" className="fi-btn fi-btn-primary au-submit" disabled={pending}>
              {pending ? "Guardando…" : "Guardar contraseña"}
              <ArrowRightTiny />
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
