import { Suspense } from "react";
import Link from "next/link";
import { FolioMark } from "@/components/folio-mark";

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
export const metadata = { title: "Cambiar contraseña" };

export default function ResetPasswordPage() {
  return (
    <main className="fx-auth-reset-page">
      <Link className="fx-auth-brand" href="/" aria-label="Folio, volver al inicio">
        <FolioMark size={29} /><span>folio</span>
      </Link>
      <Suspense fallback={<div style={{ color: "var(--ink-3)" }}>Cargando…</div>}>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
