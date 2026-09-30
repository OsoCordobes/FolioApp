import "server-only";

import { z } from "zod";
import { blindIndex, blindIndexPhone, decryptColumn, encryptColumn } from "@/lib/crypto";
import { err, ok, type FolioErrorCode, type Result } from "@/lib/db/errors";
import { normalizarCobertura } from "@/lib/pacientes/cobertura";
import { canonicalAdminV1 } from "./admin-v1";

export const incorporationKeys = [
  "nombre", "apellido", "tipoDocumento", "numeroDocumento", "fechaNacimiento",
  "email", "telefono", "cobertura.nombre", "cobertura.plan", "cobertura.numeroAfiliado",
] as const;
export type IncorporationKey = typeof incorporationKeys[number];
const key = z.enum(incorporationKeys);
const uuid = z.string().uuid();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const decimal = z.string().max(19).regex(/^(0|[1-9][0-9]*)$/)
  .refine(value => /^(0|[1-9][0-9]*)$/.test(value) && value.length <= 19
    && BigInt(value) <= BigInt("9223372036854775807"));
const selected = z.array(key).min(1).max(10).refine(keys => new Set(keys).size === keys.length)
  .refine(keys => keys.includes("tipoDocumento") === keys.includes("numeroDocumento"))
  .transform(keys => incorporationKeys.filter(key => keys.includes(key)));
const safeRevision = z.number().refine(value => Number.isSafeInteger(value) && value >= 0);
const timestamp = z.string().datetime({ offset: true });
const cipher = z.string().min(1).max(24000);
const currentSchema = z.object({
  nombre_cifrado: cipher.nullable(), apellido_cifrado: cipher.nullable(),
  tipo_doc: z.enum(["DNI", "LE", "LC", "CI", "PASAPORTE"]).nullable(),
  numero_doc_cifrado: cipher.nullable(), fecha_nacimiento: z.string().nullable(),
  email_cifrado: cipher.nullable(), telefono_cifrado: cipher.nullable(),
  cobertura_nombre: z.string().nullable(), cobertura_plan: z.string().nullable(),
  cobertura_nro_afiliado_cifrado: cipher.nullable(),
}).strict();
const snapshotSchema = z.object({
  receiptId: uuid, questionnaireVersion: z.literal("admin.v1"), contextHash: hash,
  identityId: uuid, adminRevision: decimal, sourceCipherBase64: cipher, current: currentSchema,
}).strict();
type Current = z.infer<typeof currentSchema>;

const receiptSchema = z.object({
  status: z.enum(["pending", "materialized", "applied", "unchanged", "conflict", "cancelled"]),
  operationId: uuid, preparationId: uuid.nullable(), receiptId: uuid.nullable(),
  identityId: uuid.nullable(), selectedKeys: z.array(key).min(1).max(10).nullable(),
  changedKeys: z.array(key).max(10).nullable(), revisionBefore: safeRevision.nullable(),
  revisionAfter: safeRevision.nullable(), reason: z.string().nullable(), expiresAt: timestamp.nullable(),
}).superRefine((value, ctx) => {
  const invalid = () => ctx.addIssue({ code: "custom", message: "Invalid incorporation receipt" });
  if (value.preparationId === null) {
    if (value.status !== "cancelled" || value.receiptId !== null || value.identityId !== null
      || value.selectedKeys !== null || value.changedKeys !== null || value.revisionBefore !== null
      || value.revisionAfter !== null || value.expiresAt !== null || value.reason !== "cancel_before_prepare") invalid();
    return;
  }
  if (!value.receiptId || !value.identityId || !value.selectedKeys) { invalid(); return; }
  if (!selected.safeParse(value.selectedKeys).success) invalid();
  if (value.changedKeys && (new Set(value.changedKeys).size !== value.changedKeys.length
    || value.changedKeys.some(key => !value.selectedKeys!.includes(key)))) invalid();
  if (value.status === "pending" || value.status === "materialized") {
    if (!value.expiresAt || value.reason !== null || value.revisionBefore !== null || value.revisionAfter !== null
      || (value.status === "pending" ? value.changedKeys !== null : value.changedKeys === null)) invalid();
  } else if (value.expiresAt !== null) invalid();
  if (value.status === "applied" || value.status === "unchanged") {
    if (value.revisionBefore === null || value.revisionAfter === null || value.changedKeys === null
      || value.reason !== null || (value.status === "applied"
        ? value.revisionAfter !== value.revisionBefore + 1 || value.changedKeys.length === 0
        : value.revisionAfter !== value.revisionBefore || value.changedKeys.length !== 0)) invalid();
  }
});
type Receipt = z.infer<typeof receiptSchema>;
const absentSchema = z.object({ status: z.literal("not_recorded"), operationId: uuid }).strict();
export type PublicIncorporationResult = Omit<Receipt, "preparationId"> | z.infer<typeof absentSchema>;

export const incorporationRequest = z.object({
  turnoId: uuid, scope: hash, receiptId: uuid, selectedKeys: selected, operationId: uuid,
  identityId: uuid, adminRevision: decimal, contextHash: hash,
}).strict();
export const incorporationReadRequest = z.object({ turnoId: uuid, scope: hash, receiptId: uuid }).strict();
export const incorporationOperationRequest = z.object({ turnoId: uuid, scope: hash, operationId: uuid }).strict();
type Request = z.infer<typeof incorporationRequest>;

export function incorporationFailure(
  code: FolioErrorCode = "db_error", outcome?: "uncertain" | "review_required",
): Result<never> {
  const messages: Partial<Record<FolioErrorCode, string>> = {
    validation: "La selección no puede incorporarse. Revisá los datos del aporte.",
    forbidden: "No tenés permiso vigente para incorporar datos de este turno.",
    conflict: "Los datos o el turno cambiaron. Comprobá la operación antes de elegir nuevamente.",
    network: "Se interrumpió la respuesta. Comprobá la misma operación antes de continuar.",
  };
  const result = err(code, messages[code] ?? "No pudimos comprobar la incorporación. Revisá el estado de la operación.");
  if (!result.ok && outcome) result.error.mutationOutcome = outcome;
  return result;
}

export function incorporationRpcError(code?: string, mutation = false): Result<never> {
  if (code === "42501") return incorporationFailure("forbidden");
  if (code === "40001" || code === "23505") return incorporationFailure("conflict");
  if (code === "22023" || code === "23514") return incorporationFailure("validation");
  return incorporationFailure("db_error", mutation ? "review_required" : undefined);
}

/** PostgreSQL encode(bytea,'base64') may insert line breaks. Reject other aliases. */
function cipherBytes(value: string): Buffer {
  const compact = value.replace(/[\r\n]/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) throw new Error("invalid_cipher");
  const bytes = Buffer.from(compact, "base64");
  if (bytes.length < 29 || bytes.toString("base64") !== compact) throw new Error("invalid_cipher");
  return bytes;
}

export function encryptedByteaToBase64(value: string): string {
  if (!/^\\x(?:[0-9a-fA-F]{2}){29,}$/.test(value)) throw new Error("invalid_bytea");
  return Buffer.from(value.slice(2), "hex").toString("base64");
}
function encrypt(value: string): string {
  const encrypted = encryptColumn(value);
  if (!encrypted) throw new Error("missing_cipher");
  return encryptedByteaToBase64(encrypted);
}
function clear(value: string | null): string | null {
  if (value === null) return null;
  const decrypted = decryptColumn(cipherBytes(value));
  if (!decrypted) throw new Error("invalid_clear");
  return decrypted.normalize("NFC").trim();
}
function answers(sourceCipherBase64: string): Partial<Record<IncorporationKey, string>> {
  const source = decryptColumn(cipherBytes(sourceCipherBase64));
  if (!source || Buffer.byteLength(source, "utf8") > 16384) throw new Error("invalid_source");
  const canonical = canonicalAdminV1(JSON.parse(source));
  if (canonical !== source) throw new Error("noncanonical_source");
  const parsed = JSON.parse(canonical) as Record<string, unknown>;
  const values: Partial<Record<IncorporationKey, string>> = {};
  for (const key of incorporationKeys) {
    const [top, sub] = key.split(".");
    const value = sub ? (parsed[top] as Record<string, unknown> | undefined)?.[sub] : parsed[top];
    if (typeof value === "string") values[key] = value;
  }
  return values;
}
function currentValue(current: Current, key: IncorporationKey): string | null {
  switch (key) {
    case "nombre": return clear(current.nombre_cifrado);
    case "apellido": return clear(current.apellido_cifrado);
    case "tipoDocumento": return current.tipo_doc;
    case "numeroDocumento": return clear(current.numero_doc_cifrado);
    case "fechaNacimiento": return current.fecha_nacimiento;
    case "email": return clear(current.email_cifrado);
    case "telefono": return clear(current.telefono_cifrado);
    case "cobertura.nombre": return current.cobertura_nombre;
    case "cobertura.plan": return current.cobertura_plan;
    case "cobertura.numeroAfiliado": return clear(current.cobertura_nro_afiliado_cifrado);
  }
}

export function incorporationComparison(input: unknown) {
  const snapshot = snapshotSchema.parse(input);
  const proposed = answers(snapshot.sourceCipherBase64);
  return {
    receiptId: snapshot.receiptId, identityId: snapshot.identityId,
    adminRevision: snapshot.adminRevision, contextHash: snapshot.contextHash,
    fields: incorporationKeys.filter(key => proposed[key] !== undefined).map(key => ({
      key, current: currentValue(snapshot.current, key), proposed: proposed[key]!,
    })),
  };
}

class SelectionError extends Error {}

/** Derive a selective patch only from an authenticated preparation's immutable source. */
export function buildIncorporationPatch(
  sourceCipherBase64: string, rawCurrent: unknown, rawKeys: unknown, organizationId: string,
): Record<string, string | null> {
  uuid.parse(organizationId);
  const keys = selected.parse(rawKeys);
  const current = currentSchema.parse(rawCurrent);
  const source = answers(sourceCipherBase64);
  if (keys.some(key => source[key] === undefined)) throw new SelectionError("missing_source_key");
  const patch: Record<string, string | null> = {};
  for (const key of keys) {
    if (key.startsWith("cobertura.")) continue;
    const proposed = source[key]!;
    if (key === "telefono" && !blindIndexPhone(proposed, organizationId)) throw new SelectionError("phone_index_required");
    if (proposed === currentValue(current, key)) continue;
    switch (key) {
      case "nombre": patch.nombre_cifrado = encrypt(proposed); break;
      case "apellido": patch.apellido_cifrado = encrypt(proposed); break;
      case "tipoDocumento": patch.tipo_doc = proposed; break;
      case "numeroDocumento":
        patch.numero_doc_cifrado = encrypt(proposed); patch.dni_hash = blindIndex(proposed, organizationId); break;
      case "fechaNacimiento": patch.fecha_nacimiento = proposed; break;
      case "email": patch.email_cifrado = encrypt(proposed); patch.email_hash = blindIndex(proposed.toLowerCase(), organizationId); break;
      case "telefono": patch.telefono_cifrado = encrypt(proposed); patch.telefono_hash = blindIndexPhone(proposed, organizationId); break;
    }
  }
  if (patch.nombre_cifrado || patch.apellido_cifrado) {
    const first = keys.includes("nombre") ? source.nombre : clear(current.nombre_cifrado);
    const last = keys.includes("apellido") ? source.apellido : clear(current.apellido_cifrado);
    if (!first || !last) throw new Error("name_component_required");
    patch.nombre_hash = blindIndex(`${first} ${last}`, organizationId);
  }
  if (keys.some(key => key.startsWith("cobertura."))) {
    const currentCoverage = { nombre: current.cobertura_nombre, plan: current.cobertura_plan,
      nroAfiliado: clear(current.cobertura_nro_afiliado_cifrado) };
    const final = normalizarCobertura({
      nombre: keys.includes("cobertura.nombre") ? source["cobertura.nombre"] : currentCoverage.nombre,
      plan: keys.includes("cobertura.plan") ? source["cobertura.plan"] : currentCoverage.plan,
      nroAfiliado: keys.includes("cobertura.numeroAfiliado") ? source["cobertura.numeroAfiliado"] : currentCoverage.nroAfiliado,
    });
    const nameChanged = keys.includes("cobertura.nombre") && final.nombre !== currentCoverage.nombre;
    if ((nameChanged && ((currentCoverage.plan !== null && !keys.includes("cobertura.plan"))
      || (currentCoverage.nroAfiliado !== null && !keys.includes("cobertura.numeroAfiliado"))))
      || (keys.includes("cobertura.nombre") && final.nombre === null
        && (currentCoverage.plan !== null || currentCoverage.nroAfiliado !== null))
      || (final.nombre === null && (final.plan !== null || final.nroAfiliado !== null))) {
      throw new SelectionError("incompatible_coverage");
    }
    if (nameChanged) patch.cobertura_nombre = final.nombre;
    if (keys.includes("cobertura.plan") && final.plan !== currentCoverage.plan) {
      if (!final.plan) throw new SelectionError("coverage_plan_required");
      patch.cobertura_plan = final.plan;
    }
    if (keys.includes("cobertura.numeroAfiliado") && final.nroAfiliado !== currentCoverage.nroAfiliado) {
      if (!final.nroAfiliado) throw new SelectionError("coverage_affiliate_required");
      patch.cobertura_nro_afiliado_cifrado = encrypt(final.nroAfiliado);
    }
  }
  return patch;
}

function publicReceipt(receipt: Receipt): PublicIncorporationResult {
  return { status: receipt.status, operationId: receipt.operationId, receiptId: receipt.receiptId,
    identityId: receipt.identityId, selectedKeys: receipt.selectedKeys, changedKeys: receipt.changedKeys,
    revisionBefore: receipt.revisionBefore, revisionAfter: receipt.revisionAfter,
    reason: receipt.reason, expiresAt: receipt.expiresAt };
}

export function incorporationPublicResult(input: unknown, operationId: string): Result<PublicIncorporationResult> {
  const absent = absentSchema.safeParse(input);
  if (absent.success) return absent.data.operationId === operationId ? ok(absent.data) : incorporationFailure("db_error", "review_required");
  const parsed = receiptSchema.safeParse(input);
  return parsed.success && parsed.data.operationId === operationId
    ? ok(publicReceipt(parsed.data)) : incorporationFailure("db_error", "review_required");
}

export type IncorporationRpc = "patient_intake_incorporation_prepare" | "patient_intake_incorporation_apply"
  | "patient_intake_incorporation_status";
export type IncorporationTransport = {
  staff(name: IncorporationRpc, args: Record<string, unknown>, mutation: boolean): Promise<Result<{ value: unknown; organizationId: string }>>;
  materialize(args: { p_preparation: string; p_patch: Record<string, string | null>; p_source_fingerprint: string }): Promise<Result<unknown>>;
};
const terminal = (status: string) => ["applied", "unchanged", "conflict", "cancelled"].includes(status);

/** Internal server-only seam. The public action supplies authenticated RPCs, never browser callbacks. */
export async function runIncorporation(input: unknown, transport: IncorporationTransport): Promise<Result<PublicIncorporationResult>> {
  const valid = incorporationRequest.safeParse(input);
  if (!valid.success) return incorporationFailure("validation");
  const request = valid.data;
  const uncertain = () => incorporationFailure("network", "uncertain");
  async function status() {
    try {
      const result = await transport.staff("patient_intake_incorporation_status", { p_operation: request.operationId }, false);
      return result.ok ? incorporationPublicResult(result.data.value, request.operationId) : result;
    } catch { return uncertain(); }
  }
  async function reconcile(allowApply: boolean): Promise<Result<PublicIncorporationResult>> {
    const result = await status();
    if (!result.ok) return { ok: false, error: { ...result.error,
      mutationOutcome: result.error.mutationOutcome ?? "uncertain" } };
    if (terminal(result.data.status)) return result;
    if (allowApply && result.data.status === "materialized") return apply();
    return uncertain();
  }
  async function apply(): Promise<Result<PublicIncorporationResult>> {
    let result: Awaited<ReturnType<IncorporationTransport["staff"]>>;
    try { result = await transport.staff("patient_intake_incorporation_apply", {
      p_preparation: preparationId, p_operation: request.operationId,
    }, true); } catch { return reconcile(false); }
    if (!result.ok) return result.error.mutationOutcome ? reconcile(false) : result;
    return incorporationPublicResult(result.data.value, request.operationId);
  }
  let prepared: Awaited<ReturnType<IncorporationTransport["staff"]>>;
  try {
    prepared = await transport.staff("patient_intake_incorporation_prepare", {
      p_receipt: request.receiptId, p_keys: request.selectedKeys, p_expected_identity: request.identityId,
      p_expected_revision: request.adminRevision, p_expected_context: request.contextHash, p_operation: request.operationId,
    }, true);
  } catch { return reconcile(false); }
  if (!prepared.ok) return prepared.error.mutationOutcome ? reconcile(false) : prepared;
  const receipt = receiptSchema.safeParse(prepared.data.value);
  if (!receipt.success || !matchesRequest(receipt.data, request)) return incorporationFailure("db_error", "review_required");
  if (terminal(receipt.data.status)) return ok(publicReceipt(receipt.data));
  const preparationId = receipt.data.preparationId!;
  if (receipt.data.status === "materialized") return apply();
  const pendingSchema = z.object({ sourceCipherBase64: cipher, sourceFingerprint: hash, current: currentSchema });
  const pending = pendingSchema.safeParse(prepared.data.value);
  if (!pending.success) return incorporationFailure("db_error", "review_required");
  let patch: Record<string, string | null>;
  try {
    patch = buildIncorporationPatch(pending.data.sourceCipherBase64, pending.data.current,
      request.selectedKeys, prepared.data.organizationId);
  } catch (error) {
    return incorporationFailure(error instanceof SelectionError ? "validation" : "db_error", "review_required");
  }
  let materialized: Result<unknown>;
  try { materialized = await transport.materialize({ p_preparation: preparationId, p_patch: patch,
    p_source_fingerprint: pending.data.sourceFingerprint }); } catch { return reconcile(true); }
  if (!materialized.ok) return materialized.error.mutationOutcome ? reconcile(true) : materialized;
  const parsed = receiptSchema.safeParse(materialized.data);
  if (!parsed.success || parsed.data.preparationId !== preparationId || !matchesRequest(parsed.data, request)) {
    return incorporationFailure("db_error", "review_required");
  }
  if (terminal(parsed.data.status)) return ok(publicReceipt(parsed.data));
  return parsed.data.status === "materialized" ? apply() : incorporationFailure("db_error", "review_required");
}

function matchesRequest(receipt: Receipt, request: Request): boolean {
  if (receipt.operationId !== request.operationId) return false;
  if (receipt.status === "cancelled" && receipt.preparationId === null) return true;
  return receipt.receiptId === request.receiptId && receipt.identityId === request.identityId
    && JSON.stringify(receipt.selectedKeys) === JSON.stringify(request.selectedKeys);
}
