/**
 * Folio · /api/admin/confirm-user
 *
 * Endpoint admin one-shot para confirmar manualmente un email en auth.users.
 * Útil cuando un usuario se creó antes del autoconfirm en signUpEmail y quedó
 * con email_confirmed_at = null, bloqueando el login con "Email o contraseña
 * incorrectos".
 *
 * Auth: Bearer ${CRON_SECRET}.
 * Uso: POST /api/admin/confirm-user?email=foo@bar.com
 *
 * No fail-loud — devuelve resumen del estado actual del user, incluso si ya
 * estaba confirmado.
 *
 * ─── Audit 2026-05-23 finding C3 + A3 ─────────────────────────────────────
 *
 * C3: el endpoint permite confirmar emails arbitrarios con solo Bearer. Si el
 * secret leaks, un atacante crea un user externo y bypassea el email-verify.
 *
 * A3: la versión histórica usaba `listUsers({ perPage: 200 })` — se rompía a
 * partir del usuario 201 ("user no encontrado" cuando sí existía).
 *
 * Fix Sprint 0 Task 0.4:
 *   - prod-escape-hatch: en producción requiere ALLOW_PROD_CONFIRM_USER=
 *     yes-im-sure-2026 explícita además del Bearer. Procedimiento de uso
 *     idéntico al de migrate (set env → redeploy → curl → unset → redeploy).
 *   - Paginated lookup vía `findUserByEmail` helper (lib/auth/find-user-by-email).
 *
 * Long-term: este endpoint debería desaparecer y reemplazarse por una UI
 * supervisada en `/admin/usuarios` con audit log explícito.
 */

import { NextResponse } from "next/server";

import { findUserByEmail } from "@/lib/auth/find-user-by-email";
import { checkAdminGate } from "@/lib/security/admin-gate";
import { verifyBearer } from "@/lib/security/verify-bearer";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (!verifyBearer(auth, process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Audit C3 gate: requiere escape hatch explícito en producción.
  const gated = checkAdminGate({
    mode: "prod-escape-hatch",
    escapeHatch: { envVar: "ALLOW_PROD_CONFIRM_USER", expected: "yes-im-sure-2026" },
  });
  if (gated) return gated;

  const url = new URL(req.url);
  const email = url.searchParams.get("email");
  if (!email) {
    return NextResponse.json({ ok: false, error: "falta query param email" }, { status: 400 });
  }

  const service = createSupabaseServiceClient();

  // Audit A3: paginated lookup en vez del viejo perPage:200 ceiling.
  const user = await findUserByEmail(service, email);
  if (!user) {
    return NextResponse.json({ ok: false, error: "user no encontrado" }, { status: 404 });
  }

  if (user.email_confirmed_at) {
    return NextResponse.json({
      ok: true,
      already_confirmed: true,
      user_id: user.id,
      email_confirmed_at: user.email_confirmed_at,
    });
  }

  const { error: updErr } = await service.auth.admin.updateUserById(user.id, {
    email_confirm: true,
  });
  if (updErr) {
    return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    confirmed: true,
    user_id: user.id,
    email,
  });
}

export async function GET(req: Request) {
  return POST(req);
}
