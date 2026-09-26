"use server";

import { z } from "zod";
import { decryptColumn } from "@/lib/crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getActiveSession } from "@/lib/db/session";
import { err, ok } from "@/lib/db/errors";
import { limitByKey } from "@/lib/security/rate-limit";
import { newInvitationFingerprintKeyCipher } from "./admin-v1";

const uuid = z.string().uuid();
const issued = z.object({ invitationId: uuid, token: z.string().regex(/^[0-9a-f]{64}$/), expiresAt: z.string().datetime({ offset: true }) });
const revoked = z.object({ revoked: z.boolean() });
const reviewRow = z.object({ receiptId: uuid, questionnaireVersion: z.literal("admin.v1"), receivedAt: z.string(), answersCipherBase64: z.string() });

function staffError(code: string | undefined, mutation: boolean) {
  if (code === "42501") return err("forbidden", "No tenés permiso vigente para este turno.");
  if (code === "22023") return err("validation", "El turno o aporte no está disponible.");
  const result = err("db_error", mutation
    ? "No pudimos confirmar el cambio. Comprobá el estado antes de emitir otro enlace."
    : "No pudimos consultar los aportes.");
  if (!result.ok && mutation) result.error.mutationOutcome = "review_required";
  return result;
}

async function invoke(turnoId: string, name: string, extra: Record<string, unknown> = {}, mutation = false) {
  if (!uuid.safeParse(turnoId).success) return err("validation", "Turno inválido.");
  const session = await getActiveSession();
  if (!session.ok) return session;
  const limit = await limitByKey(`patient-intake.staff.${name}`, `${session.data.organizationId}:${session.data.userId}`, mutation ? 30 : 120);
  if (!limit.ok) return err("forbidden", "Esperá un momento antes de repetir esta acción.");
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc(name, { p_org: session.data.organizationId, p_turno: turnoId, ...extra });
    if (error) return staffError(error.code, mutation);
    return ok(data as unknown);
  } catch {
    const result = err("network", mutation
      ? "Se interrumpió la respuesta. No vuelvas a emitir hasta revisar el estado."
      : "No pudimos consultar los aportes.");
    if (!result.ok && mutation) result.error.mutationOutcome = "uncertain";
    return result;
  }
}

/** M144 creates the raw credential once. An uncertain issue cannot recover it. */
export async function issuePatientIntakeLink(turnoId: string) {
  let key: string;
  try { key = newInvitationFingerprintKeyCipher(); }
  catch { return err("db_error", "No pudimos preparar un enlace seguro."); }
  const result = await invoke(turnoId, "patient_intake_issue", { p_fingerprint_key_cifrado: key }, true);
  if (!result.ok) return result;
  const parsed = issued.safeParse(result.data);
  if (!parsed.success) {
    const failure = err("db_error", "No pudimos confirmar el enlace emitido. No emitas otro sin revisar.");
    if (!failure.ok) failure.error.mutationOutcome = "review_required";
    return failure;
  }
  return ok(parsed.data);
}

export async function revokePatientIntakeLink(turnoId: string) {
  const result = await invoke(turnoId, "patient_intake_revoke", {}, true);
  if (!result.ok) return result;
  const parsed = revoked.safeParse(result.data);
  if (!parsed.success) return staffError(undefined, true);
  return ok(parsed.data);
}

export async function reviewPatientIntake(turnoId: string) {
  const result = await invoke(turnoId, "patient_intake_review");
  if (!result.ok) return result;
  const rows = z.array(reviewRow).max(100).safeParse(result.data);
  if (!rows.success) return err("db_error", "No pudimos leer los aportes.");
  try {
    return ok(rows.data.map((row) => {
      const clear = decryptColumn(Buffer.from(row.answersCipherBase64, "base64"));
      if (!clear) throw new Error("cipher_missing");
      return { receiptId: row.receiptId, questionnaireVersion: row.questionnaireVersion,
        receivedAt: row.receivedAt, origin: "aportado por el paciente" as const,
        answers: JSON.parse(clear) as Record<string, unknown> };
    }));
  } catch { return err("db_error", "No pudimos descifrar los aportes."); }
}
