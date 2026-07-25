"use server";

/**
 * Folio · Server Actions del portal del paciente (Fase 3 · P3).
 *
 * Wrapper delgado sobre el orchestrator del linkage (`lib/portal/link-actions`).
 * Existe para que el Client Component del portal invoque el matcher AUDITADO por
 * un límite server-action explícito (el orchestrator ya es "use server", pero
 * exponerlo desde el segment del portal mantiene el import graph claro).
 *
 * El matcher toma la cuenta de la SESIÓN del caller (auth.uid()), nunca de un
 * arg — un cliente no puede correrlo "como" otra cuenta. Los identificadores
 * (DNI/teléfono) son opcionales: sin ellos, sólo hay match por email (que jamás
 * alcanza el umbral de auto-link → cae a claim, seguro).
 */

import { redirect } from "next/navigation";
import { z } from "zod";

import type { Result } from "@/lib/db/errors";
import { err } from "@/lib/db/errors";
import {
  runLinkageForCurrentAccount,
  type LinkageResult,
} from "@/lib/portal/link-actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const linkageInput = z.object({
  dni: z.string().trim().max(40).optional(),
  telefono: z.string().trim().max(40).optional(),
  /** Token de Turnstile del widget del portal. Obligatorio (fail-closed en prod)
   * cuando se aportan DNI/teléfono — el path que puede auto-linkear. */
  captchaToken: z.string().max(4096).optional(),
});

export async function runPortalLinkage(
  input: z.infer<typeof linkageInput> = {},
): Promise<Result<LinkageResult>> {
  const parsed = linkageInput.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos inválidos.", parsed.error.message);
  }
  return runLinkageForCurrentAccount({
    dni: parsed.data.dni ?? null,
    telefono: parsed.data.telefono ?? null,
    captchaToken: parsed.data.captchaToken ?? null,
  });
}

/**
 * Logout del PORTAL (botón Salir del shell). Espeja `signOut` de staff pero
 * aterriza en /portal/login: el paciente que sale del portal no tiene nada que
 * hacer en la landing de profesionales, y desde ahí puede volver a entrar con
 * su magic-link.
 */
export async function signOutPortal(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  // Paridad con el signOut de staff: un humano puede ser staff Y paciente a la
  // vez — si sale desde el portal, no dejamos la cookie de org activa para que
  // el próximo user del mismo navegador no herede el switcher.
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  cookieStore.delete("folio.active_org");

  redirect("/portal/login");
}
