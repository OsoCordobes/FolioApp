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

import { z } from "zod";

import type { Result } from "@/lib/db/errors";
import { err } from "@/lib/db/errors";
import {
  runLinkageForCurrentAccount,
  type LinkageResult,
} from "@/lib/portal/link-actions";

const linkageInput = z.object({
  dni: z.string().trim().max(40).optional(),
  telefono: z.string().trim().max(40).optional(),
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
  });
}
