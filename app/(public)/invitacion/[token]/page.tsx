import { Suspense } from "react";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { InvitationAuth, InvitationDecision, type InvitationPreview } from "./invitation-client";

/**
 * Folio · /invitacion/[token] — aceptación de invitación de equipo (M49/M51).
 *
 * El link del email trae el token CRUDO en el path; en DB solo vive su sha256
 * (member_invitation.token_hash). La página maneja dos estados:
 *
 *   1. SIN sesión: la RPC get_invitation_preview es authenticated-only, así
 *      que no podemos previsualizar nada — mostramos una pantalla neutra
 *      "Te invitaron a un equipo en Folio" con crear cuenta / iniciar sesión
 *      INLINE (sin pasar por /login: el middleware redirige a /hoy a los
 *      usuarios logueados que pisan /login, lo que rompería la vuelta).
 *
 *   2. CON sesión: llamamos la RPC (cliente RLS-aware autenticado) y
 *      renderizamos la decisión: aceptar / expirada / revocada / ya aceptada /
 *      email distinto al de la sesión.
 *
 * El accept va por la RPC SECURITY DEFINER accept_member_invitation (M49) con
 * consentimiento (Ley 25.326) + rate limit en la action.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Folio · Invitación al equipo" };

// Token = randomBytes(32).toString("base64url") → 43 chars [A-Za-z0-9_-].
// Guard barato contra paths basura antes de tocar la DB.
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,128}$/;

export default async function InvitacionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const tokenValido = TOKEN_SHAPE.test(token);

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let body: React.ReactNode;

  if (!tokenValido) {
    body = <InvitationDecision token={token} preview={null} sessionEmail={null} />;
  } else if (!user) {
    body = <InvitationAuth token={token} />;
  } else {
    const { data, error } = await supabase.rpc("get_invitation_preview", { p_token: token });
    const preview = !error && data ? (data as InvitationPreview) : null;
    body = (
      <InvitationDecision token={token} preview={preview} sessionEmail={user.email ?? null} />
    );
  }

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
        {body}
      </Suspense>
    </main>
  );
}
