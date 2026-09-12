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
  const [exchanging, setExchanging] = useState(true);
  const [pending, startTransition] = useTransition();

  // El link de recuperación de Supabase trae un `code` (PKCE) que tenemos que
  // intercambiar manualmente por una sesión en el cliente. Sin ese exchange
  // explícito, `updateUser({ password })` tira "Auth session missing".
  // detectSessionInUrl=true en @supabase/ssr cubre el caso del hash fragment,
  // pero el code-param requiere exchangeCodeForSession explícito.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const code = searchParams.get("code");
    const errorParam =
      searchParams.get("error_description") ?? searchParams.get("error");

    if (errorParam) {
      setExchangeError(decodeURIComponent(errorParam));
      setExchanging(false);
      return;
    }

    if (!code) {
      // Tal vez el link viene como hash fragment (#access_token=...). En ese
      // caso @supabase/ssr ya hizo el work via detectSessionInUrl; verificamos
      // que haya sesión antes de mostrar el form.
      supabase.auth.getSession().then(({ data }) => {
        if (!data.session) {
          setExchangeError(
            "Link inválido o expirado. Pedí uno nuevo desde el login.",
          );
        }
        setExchanging(false);
      });
      return;
    }

    let cancelled = false;
    supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
      if (cancelled) return;
      if (error) {
        setExchangeError(error.message);
      }
      setExchanging(false);
    });
    return () => {
      cancelled = true;
    };
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
      <div className="au-form-pane fx-auth-form">
        <header className="au-form-head">
          <h1>Necesitás un enlace nuevo.</h1>
          <p>Este enlace de recuperación ya no es válido. Podés pedir otro para recuperar el acceso.</p>
        </header>
        <button
          type="button"
          className="fi-btn fi-btn-primary au-submit"
          onClick={() => router.push("/forgot")}
        >
          Pedir un nuevo enlace
        </button>
      </div>
    );
  }

  if (exchanging) {
    return (
      <div className="au-form-pane fx-auth-form" role="status" aria-busy="true">
        <header className="au-form-head">
          <h1>Verificando el enlace…</h1>
          <p>Esperá mientras comprobamos el acceso a tu cuenta.</p>
        </header>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="au-form-pane au-form fx-auth-form"
      aria-busy={pending}
    >
      <header className="au-form-head">
        <h1>Elegí una nueva contraseña.</h1>
        <p>
          Usá al menos 8 caracteres y repetila para confirmar.
        </p>
      </header>

      <label className="au-field">
        <span>Nueva contraseña</span>
        <input
          type="password"
          autoComplete="new-password"
          aria-describedby={err ? "fx-reset-error" : undefined}
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
          aria-describedby={err ? "fx-reset-error" : undefined}
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            setErr(null);
          }}
          disabled={pending || ok}
        />
      </label>

      {err ? <p id="fx-reset-error" className="au-err" role="alert">{err}</p> : null}
      {ok ? (
        <p role="status" style={{ color: "var(--green)", fontSize: 13 }}>
          Contraseña actualizada. Abriendo tu consultorio…
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
