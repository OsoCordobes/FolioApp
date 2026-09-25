import { Suspense } from "react";
import Link from "next/link";
import { FolioMark } from "@/components/folio-mark";

import { ResetPasswordForm } from "./reset-password-form";

/**
 * Folio · /reset-password
 *
 * Landing for the Supabase password-recovery email link. Supabase appends
 * a PKCE `code` to the redirectTo URL after
 * the user clicks the email. Here we render a client form that:
 *   1. Lets @supabase/ssr exchange the code once and validates the resulting
 *      recovery session before showing the form.
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
