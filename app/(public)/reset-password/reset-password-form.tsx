"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Folio · /reset-password · client form.
 *
 * Workflow:
 *   1. URL params from Supabase: ?code=... (PKCE) or ?token_hash=...&type=recovery.
 *   2. On mount we let @supabase/ssr exchange the code for a session
 *      automatically (the helper does this when the page loads).
 *   3. User types new password + confirm. Submit calls
 *      supabase.auth.updateUser({ password }).
 *   4. On success, router.push("/hoy").
 *
 * If the link is expired or invalid, supabase returns an error and we show
 * a "request a new link" affordance.
 */

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [exchangeError, setExchangeError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The Supabase JS client picks up `code` or `token_hash` on mount via
  // detectSessionInUrl. We instantiate the browser client once.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    // Listen for PASSWORD_RECOVERY events; the SDK fires this when the
    // URL params are valid + the session is established.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        // ready to submit the new password
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Detect a stale / used link early. Supabase passes back error params
  // on failure (e.g. ?error=expired).
  useEffect(() => {
    const error = searchParams.get("error") ?? searchParams.get("error_description");
    if (error) setExchangeError(decodeURIComponent(error));
  }, [searchParams]);

  const onSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (password.length < 8) {
      setErr("Mínimo 8 caracteres");
      return;
    }
    if (password !== confirm) {
      setErr("Las contraseñas no coinciden");
      return;
    }
    setErr(null);
    startTransition(async () => {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setErr(error.message);
        return;
      }
      setOk(true);
      // Send the user to /hoy. The middleware will refresh the session
      // cookie on the way through.
      setTimeout(() => router.push("/hoy"), 800);
    });
  };

  if (exchangeError) {
    return (
      <div className="au-form-pane" style={{ maxWidth: 420 }}>
        <h2>El link expiró</h2>
        <p style={{ color: "var(--ink-3)" }}>
          El link de recuperación dejó de ser válido. Pedí uno nuevo desde el
          login.
        </p>
        <button
          type="button"
          className="fi-btn fi-btn-primary au-submit"
          onClick={() => router.push("/login")}
        >
          Volver a /login
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="au-form-pane au-form"
      style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 420, width: "100%" }}
    >
      <header className="au-form-head">
        <h2>Elegí una nueva contraseña</h2>
        <p style={{ color: "var(--ink-3)", marginTop: 4, fontSize: 13 }}>
          Mínimo 8 caracteres. La guardamos cifrada por Supabase Auth.
        </p>
      </header>

      <label className="au-field">
        <span>Nueva contraseña</span>
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setErr(null);
          }}
          disabled={pending || ok}
        />
      </label>

      <label className="au-field">
        <span>Repetí la contraseña</span>
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            setErr(null);
          }}
          disabled={pending || ok}
        />
      </label>

      {err ? <p className="au-err">{err}</p> : null}
      {ok ? (
        <p style={{ color: "var(--green)", fontSize: 13 }}>
          Listo. Te redirijo a /hoy…
        </p>
      ) : null}

      <button
        type="submit"
        className="fi-btn fi-btn-primary au-submit"
        disabled={pending || ok || password.length < 8 || password !== confirm}
      >
        {pending ? "Guardando…" : ok ? "Listo" : "Cambiar contraseña"}
      </button>
    </form>
  );
}
