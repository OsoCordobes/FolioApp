/**
 * Folio · /api/auth/signout · cierra sesión y redirige al landing (/).
 *
 * Lo invoca el botón "Cerrar sesión" del sidebar via form action. Caer en el
 * landing público (no en /login) le da al usuario salida visible: desde ahí
 * hay "Ingresar" en header/footer/CTA para volver a entrar.
 * Limpia también la cookie folio.active_org para que el próximo user que
 * entre en el mismo navegador no herede el org switcher del anterior.
 */

import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  const res = NextResponse.redirect(new URL("/", request.url), {
    status: 303,
  });
  res.cookies.delete("folio.active_org");
  return res;
}
