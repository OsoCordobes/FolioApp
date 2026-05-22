"use server";

/**
 * Folio · Server Action para actualizar la contraseña post-reset-link.
 *
 * Asume que el usuario ya tiene sesión activa (la dejó el code-exchange en
 * /api/auth/reset). Si no la tiene, devolvemos un error y le pedimos pedir
 * un nuevo link.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface UpdatePasswordResult {
  ok: boolean;
  error?: string;
}

export async function updatePassword(password: string): Promise<UpdatePasswordResult> {
  if (!password || password.length < 8) {
    return { ok: false, error: "La contraseña debe tener al menos 8 caracteres." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      error: "Tu link expiró. Pedí un nuevo email de recuperación desde 'Recuperar contraseña'.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { ok: false, error: "No pudimos guardar la contraseña nueva. Probá de nuevo." };
  }

  return { ok: true };
}
