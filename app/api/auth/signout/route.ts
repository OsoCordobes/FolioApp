/**
 * Folio · /api/auth/signout · cierra sesión y redirige a /login.
 *
 * Lo invoca el botón "Cerrar sesión" del sidebar via form action.
 */

import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), {
    status: 303,
  });
}
