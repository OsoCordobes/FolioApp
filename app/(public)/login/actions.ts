"use server";

/**
 * Folio · Server Actions de autenticación.
 *
 * Estas son las únicas APIs que el cliente toca para login/logout. Cuando
 * la action termina, retorna `{ ok: true }` o `{ ok: false, error }`. El
 * cliente decide qué redirección hacer (usualmente router.push('/hoy')
 * post-login para que el middleware refresque la sesión).
 */

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface AuthResult {
  ok: boolean;
  error?: string;
}

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<AuthResult> {
  if (!email || !email.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)) {
    return { ok: false, error: "Email inválido." };
  }
  if (!password || password.length < 8) {
    return { ok: false, error: "Contraseña inválida." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Mensaje genérico para evitar enumeración de usuarios (no decir "user not found")
    return { ok: false, error: "Email o contraseña incorrectos." };
  }
  return { ok: true };
}

export async function signInWithGoogle(): Promise<AuthResult> {
  const supabase = await createSupabaseServerClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3010";
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${appUrl}/api/auth/callback`,
    },
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  if (data.url) {
    redirect(data.url);
  }
  return { ok: true };
}

export async function requestPasswordReset(email: string): Promise<AuthResult> {
  if (!email || !email.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)) {
    return { ok: false, error: "Email inválido." };
  }

  const supabase = await createSupabaseServerClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3010";
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    // Phase 4 fix · /reset-password is the canonical landing.
    // /api/auth/reset stays as a 302 shim for any in-flight emails from
    // before this change (see app/api/auth/reset/route.ts).
    redirectTo: `${appUrl}/reset-password`,
  });

  if (error) {
    // Mensaje genérico (no confirmar si el email existe)
    return { ok: true };
  }
  return { ok: true };
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  // Limpiar la cookie de org activa para que el próximo user en el mismo
  // navegador no herede el switcher del anterior.
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  cookieStore.delete("folio.active_org");

  redirect("/login");
}
