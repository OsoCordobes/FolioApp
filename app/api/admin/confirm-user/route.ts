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
 */

import { NextResponse } from "next/server";

import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const email = url.searchParams.get("email");
  if (!email) {
    return NextResponse.json({ ok: false, error: "falta query param email" }, { status: 400 });
  }

  const service = createSupabaseServiceClient();

  // Buscar el user por email
  const { data: list, error: listErr } = await service.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listErr) {
    return NextResponse.json({ ok: false, error: listErr.message }, { status: 500 });
  }

  const user = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
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
