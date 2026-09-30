"use server";

import { z } from "zod";
import { createHash } from "node:crypto";
import { decryptColumn } from "@/lib/crypto";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { getActiveSession } from "@/lib/db/session";
import { err, ok } from "@/lib/db/errors";
import { limitByKey } from "@/lib/security/rate-limit";
import { readMfaStatus } from "@/lib/auth/mfa-access";
import { newInvitationFingerprintKeyCipher } from "./admin-v1";
import { runAssuredIntakeRpc } from "./staff-assurance";
import {
  incorporationComparison, incorporationFailure, incorporationOperationRequest,
  incorporationPublicResult, incorporationReadRequest, incorporationRequest,
  incorporationRpcError, runIncorporation,
} from "./incorporation";

const uuid = z.string().uuid();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const generation = z.string().regex(/^(0|[1-9][0-9]*)$/);
const snapshot = z.object({ generation, contextHash: hash, active: z.boolean(), invitationId: uuid.nullish(), expiresAt: z.string().nullish() });
const operationResult = z.discriminatedUnion("status", [
  z.object({ status: z.literal("issued"), generation, invitationId: uuid, expiresAt: z.string() }),
  z.object({ status: z.literal("revoked"), generation, revoked: z.boolean() }),
  z.object({ status: z.literal("superseded"), generation }),
  z.object({ status: z.literal("not_recorded"), generation }),
]);
const reviewRow = z.object({ receiptId: uuid, questionnaireVersion: z.literal("admin.v1"), receivedAt: z.string(), answersCipherBase64: z.string() });

function staffError(code: string | undefined, mutation: boolean) {
  if (code === "42501") return err("forbidden", "No tenés permiso vigente para este turno.");
  if (code === "40001") return err("conflict", "El enlace cambió. Comprobá el estado y elegí nuevamente qué hacer.");
  if (code === "22023") return err("validation", "El turno o aporte no está disponible.");
  const result = err("db_error", mutation
    ? "No pudimos confirmar el cambio. Comprobá el estado antes de emitir otro enlace."
    : "No pudimos consultar los aportes.");
  if (!result.ok && mutation) result.error.mutationOutcome = "review_required";
  return result;
}

async function invoke(turnoId: string, name: string, extra: Record<string, unknown> = {}, mutation = false, expectedScope?: string) {
  if (!uuid.safeParse(turnoId).success) return err("validation", "Turno inválido.");
  const session = await getActiveSession();
  if (!session.ok) return session;
  const limit = await limitByKey(`patient-intake.staff.${name}`, `${session.data.organizationId}:${session.data.userId}`, mutation ? 30 : 120);
  if (!limit.ok) return err("forbidden", "Esperá un momento antes de repetir esta acción.");
  try {
    const client = await createSupabaseServerClient();
    const { data: { session: authSession }, error: sessionError } = await client.auth.getSession();
    if (sessionError || !authSession) return err("auth_required", "Volvé a iniciar sesión.");
    const parts = authSession.access_token.split(".");
    if (parts.length !== 3) return err("auth_required", "Volvé a iniciar sesión.");
    const claim = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { session_id?: unknown; sub?: unknown };
    if (!uuid.safeParse(claim.session_id).success || claim.sub !== session.data.userId) return err("auth_required", "Volvé a iniciar sesión.");
    const scope = createHash("sha256").update(`${session.data.userId}:${session.data.organizationId}:${session.data.memberId}:${claim.session_id}`).digest("hex");
    if (expectedScope && scope !== expectedScope) return err("forbidden", "Cambió tu sesión. Volvé a abrir el turno.");
    const assured = await runAssuredIntakeRpc<{ data: unknown; error: { code?: string } | null }>(
      () => client.auth.mfa.getAuthenticatorAssuranceLevel(),
      () => readMfaStatus(client),
      () => client.rpc(name, { p_org: session.data.organizationId, p_turno: turnoId, ...extra }),
    );
    if (assured.kind === "unknown") return err("network", "No pudimos comprobar tu verificación en dos pasos. Reintentá.");
    if (assured.kind === "needs_mfa") return err("mfa_required", "Para compartir un formulario, completá la verificación en dos pasos.");
    const { data, error } = assured.result;
    if (error) return name.startsWith("patient_intake_incorporation_")
      ? incorporationRpcError(error.code, mutation) : staffError(error.code, mutation);
    return ok({ value: data as unknown, scope, organizationId: session.data.organizationId });
  } catch {
    if (name.startsWith("patient_intake_incorporation_")) return incorporationFailure("network", mutation ? "uncertain" : undefined);
    const result = err("network", mutation
      ? "Se interrumpió la respuesta. No vuelvas a emitir hasta revisar el estado."
      : "No pudimos consultar los aportes.");
    if (!result.ok && mutation) result.error.mutationOutcome = "uncertain";
    return result;
  }
}

export async function getPatientIntakeLinkState(turnoId: string) {
  const result = await invoke(turnoId, "patient_intake_link_state");
  if (!result.ok) return result;
  const parsed = snapshot.safeParse(result.data.value);
  return parsed.success ? ok({ ...parsed.data, scope: result.data.scope }) : err("db_error", "No pudimos comprobar el enlace.");
}

export async function issuePatientIntakeLink(turnoId: string, scope: string, operationId: string, expectedGeneration: string, expectedContext: string, tokenHash: string) {
  if (!uuid.safeParse(operationId).success || !generation.safeParse(expectedGeneration).success || !hash.safeParse(expectedContext).success || !hash.safeParse(tokenHash).success) return err("validation", "Solicitud inválida.");
  let key: string;
  try { key = newInvitationFingerprintKeyCipher(); }
  catch { return err("db_error", "No pudimos preparar un enlace seguro."); }
  const result = await invoke(turnoId, "patient_intake_issue_v2", { p_operation: operationId, p_expected_generation: expectedGeneration, p_expected_context: expectedContext, p_token_hash: tokenHash, p_fingerprint_key_cifrado: key }, true, scope);
  if (!result.ok) return result;
  const parsed = operationResult.safeParse(result.data.value);
  if (!parsed.success) {
    const failure = err("db_error", "No pudimos confirmar el enlace. Comprobá el resultado.");
    if (!failure.ok) failure.error.mutationOutcome = "review_required";
    return failure;
  }
  return ok(parsed.data);
}

export async function revokePatientIntakeLink(turnoId: string, scope: string, operationId: string, expectedGeneration: string, expectedContext: string) {
  if (!uuid.safeParse(operationId).success || !generation.safeParse(expectedGeneration).success || !hash.safeParse(expectedContext).success) return err("validation", "Solicitud inválida.");
  const result = await invoke(turnoId, "patient_intake_revoke_v2", { p_operation: operationId, p_expected_generation: expectedGeneration, p_expected_context: expectedContext }, true, scope);
  if (!result.ok) return result;
  const parsed = operationResult.safeParse(result.data.value);
  if (!parsed.success) return staffError(undefined, true);
  return ok(parsed.data);
}

export async function patientIntakeLinkOperationStatus(turnoId: string, scope: string, operationId: string) {
  if (!uuid.safeParse(operationId).success) return err("validation", "Solicitud inválida.");
  const result = await invoke(turnoId, "patient_intake_link_operation_status", { p_operation: operationId }, false, scope);
  if (!result.ok) return result;
  const parsed = operationResult.safeParse(result.data.value);
  return parsed.success ? ok(parsed.data) : err("db_error", "No pudimos comprobar el resultado.");
}

export async function reviewPatientIntake(turnoId: string, scope: string) {
  const result = await invoke(turnoId, "patient_intake_review", {}, false, scope);
  if (!result.ok) return result;
  const rows = z.array(reviewRow).max(100).safeParse(result.data.value);
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

export async function getPatientIntakeIncorporationSnapshot(turnoId: string, scope: string, receiptId: string) {
  const parsed = incorporationReadRequest.safeParse({ turnoId, scope, receiptId });
  if (!parsed.success) return incorporationFailure("validation");
  const result = await invoke(turnoId, "patient_intake_incorporation_snapshot", { p_receipt: receiptId }, false, scope);
  if (!result.ok) return result;
  try {
    const comparison = incorporationComparison(result.data.value);
    if (comparison.receiptId !== receiptId) return incorporationFailure();
    return ok(comparison);
  } catch { return incorporationFailure(); }
}

export async function applyPatientIntakeIncorporation(input: unknown) {
  const parsed = incorporationRequest.safeParse(input);
  if (!parsed.success) return incorporationFailure("validation");
  const { turnoId, scope } = parsed.data;
  return runIncorporation(parsed.data, {
    staff: (name, args, mutation) => invoke(turnoId, name, args, mutation, scope),
    materialize: async (args) => {
      try {
        const { data, error } = await createSupabaseServiceClient().rpc("patient_intake_incorporation_materialize", args);
        return error ? incorporationRpcError(error.code, true) : ok(data as unknown);
      } catch { return incorporationFailure("network", "uncertain"); }
    },
  });
}

export async function patientIntakeIncorporationStatus(turnoId: string, scope: string, operationId: string) {
  const parsed = incorporationOperationRequest.safeParse({ turnoId, scope, operationId });
  if (!parsed.success) return incorporationFailure("validation");
  const result = await invoke(turnoId, "patient_intake_incorporation_status", { p_operation: operationId }, false, scope);
  return result.ok ? incorporationPublicResult(result.data.value, operationId) : result;
}

export async function cancelPatientIntakeIncorporation(turnoId: string, scope: string, operationId: string) {
  const parsed = incorporationOperationRequest.safeParse({ turnoId, scope, operationId });
  if (!parsed.success) return incorporationFailure("validation");
  const result = await invoke(turnoId, "patient_intake_incorporation_cancel", { p_operation: operationId }, true, scope);
  return result.ok ? incorporationPublicResult(result.data.value, operationId) : result;
}
