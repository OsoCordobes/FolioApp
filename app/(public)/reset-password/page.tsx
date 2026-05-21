import { Suspense } from "react";

import { ResetPasswordForm } from "./reset-password-form";

/**
 * Folio · /reset-password
 *
 * Landing for the Supabase password-recovery email link. Supabase appends
 * its `code` or `token_hash` + `type=recovery` to the redirectTo URL after
 * the user clicks the email. Here we render a client form that:
 *   1. Exchanges the code for a session (via the helper inside
 *      ResetPasswordForm) — this is what Supabase's @supabase/ssr does
 *      under the hood; we let supabase-js handle it.
 *   2. Lets the user pick a new password.
 *   3. Calls supabase.auth.updateUser({ password }) server-side.
 *   4. Redirects to /hoy on success.
 *
 * The actual auth handshake is delicate enough to keep in a client
 * component so we can read URL params, surface errors clearly, and
 * fall back to a sign-in nudge if the link is expired.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Folio · Cambiar contraseña" };

export default function ResetPasswordPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "32px 24px",
        background: "var(--bg)",
      }}
    >
      <Suspense fallback={<div style={{ color: "var(--ink-3)" }}>Cargando…</div>}>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
