/**
 * Folio · password reset callback.
 *
 * Supabase manda el email con un link a esta ruta. Acá:
 *   1. Cambiamos el `code` por una sesión (queda logueado temporalmente).
 *   2. Redirigimos a /reset-password donde el usuario elige su contraseña nueva.
 *
 * Si el code falta o ya está usado, el redirect lleva a /login con un mensaje
 * de error explicando que hay que pedir un nuevo link.
 */

import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(
        "El link de recuperación venció o ya se usó. Pedí uno nuevo.",
      )}`,
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(
        "No pudimos validar el link. Pedí uno nuevo desde 'Recuperar contraseña'.",
      )}`,
    );
  }

  return NextResponse.redirect(`${origin}/reset-password`);
}
