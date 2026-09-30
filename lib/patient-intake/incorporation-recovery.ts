import type { IncorporationKey, PublicIncorporationResult } from "./incorporation";
import type { getPatientIntakeIncorporationSnapshot } from "./staff";

type SnapshotResult = Awaited<ReturnType<typeof getPatientIntakeIncorporationSnapshot>>;
export type IncorporationComparison = Extract<SnapshotResult, { ok: true }>["data"];
export type IncorporationSnapshot = Pick<IncorporationComparison, "receiptId" | "identityId" | "adminRevision" | "contextHash">;
export type IncorporationOperation = Readonly<IncorporationSnapshot & {
  turnoId: string; scope: string; operationId: string; selectedKeys: readonly IncorporationKey[];
}>;

/** View-local conflict draft: no values, revision, or reusable operation ID. */
export type IncorporationDraft = Pick<IncorporationOperation, "scope" | "turnoId" | "receiptId" | "identityId" | "contextHash" | "selectedKeys">;
export function conflictDraft(operation: IncorporationOperation): IncorporationDraft {
  return { scope: operation.scope, turnoId: operation.turnoId, receiptId: operation.receiptId,
    identityId: operation.identityId, contextHash: operation.contextHash, selectedKeys: [...operation.selectedKeys] };
}
export function recoverDraftSelection(draft: IncorporationDraft, scope: string, turnoId: string, snapshot: IncorporationComparison): IncorporationKey[] | null {
  if (draft.scope !== scope || draft.turnoId !== turnoId || draft.receiptId !== snapshot.receiptId || draft.identityId !== snapshot.identityId || draft.contextHash !== snapshot.contextHash) return null;
  let selected = canonicalSelection(draft.selectedKeys).filter(key => snapshot.fields.some(field => field.key === key));
  if (selected.includes("tipoDocumento") !== selected.includes("numeroDocumento")) selected = selected.filter(key => key !== "tipoDocumento" && key !== "numeroDocumento");
  return selected;
}

/** Only opaque operation metadata lives beyond a view. Never retain comparison values here. */
const pending = new Map<string, IncorporationOperation>();
const entryKey = (scope: string, turnoId: string) => `${scope}:${turnoId}`;
const keys: readonly IncorporationKey[] = ["nombre", "apellido", "tipoDocumento", "numeroDocumento", "fechaNacimiento",
  "email", "telefono", "cobertura.nombre", "cobertura.plan", "cobertura.numeroAfiliado"];

export function canonicalSelection(selection: readonly IncorporationKey[]): IncorporationKey[] {
  return keys.filter(key => selection.includes(key));
}

export function toggleIncorporationSelection(selection: readonly IncorporationKey[], key: IncorporationKey, checked: boolean): IncorporationKey[] {
  const group: IncorporationKey[] = key === "tipoDocumento" || key === "numeroDocumento"
    ? ["tipoDocumento", "numeroDocumento"] : [key];
  return canonicalSelection(checked ? [...selection, ...group] : selection.filter(value => !group.includes(value)));
}

export function pendingIncorporation(scope: string, turnoId: string): IncorporationOperation | null {
  return pending.get(entryKey(scope, turnoId)) ?? null;
}

export function beginIncorporation(scope: string, turnoId: string, snapshot: IncorporationComparison,
  selection: readonly IncorporationKey[], operationId = crypto.randomUUID()): IncorporationOperation {
  if (pendingIncorporation(scope, turnoId)) throw new Error("incorporation_pending");
  const selectedKeys = canonicalSelection(selection);
  if (!selectedKeys.length || selectedKeys.some(key => !snapshot.fields.some(field => field.key === key))
    || selectedKeys.includes("tipoDocumento") !== selectedKeys.includes("numeroDocumento")) throw new Error("incorporation_selection_invalid");
  const operation = Object.freeze({ scope, turnoId, operationId, receiptId: snapshot.receiptId,
    identityId: snapshot.identityId, adminRevision: snapshot.adminRevision, contextHash: snapshot.contextHash,
    selectedKeys: Object.freeze(selectedKeys) });
  pending.set(entryKey(scope, turnoId), operation);
  return operation;
}

export function isPendingIncorporation(operation: IncorporationOperation): boolean {
  return pendingIncorporation(operation.scope, operation.turnoId) === operation;
}

/** A result for another operation/selection must never unlock a new mutation. */
export function reconcileIncorporation(operation: IncorporationOperation, result: PublicIncorporationResult): "pending" | "terminal" | "invalid" {
  if (!isPendingIncorporation(operation) || result.operationId !== operation.operationId) return "invalid";
  if (result.status === "not_recorded") return "pending";
  const tombstone = result.status === "cancelled" && result.receiptId === null && result.identityId === null && result.selectedKeys === null;
  if (!tombstone && (result.receiptId !== operation.receiptId || result.identityId !== operation.identityId
    || JSON.stringify(result.selectedKeys) !== JSON.stringify(operation.selectedKeys))) return "invalid";
  if (!["applied", "unchanged", "conflict", "cancelled"].includes(result.status)) return "pending";
  pending.delete(entryKey(operation.scope, operation.turnoId));
  return "terminal";
}

/** A new actor/session must not recover the previous actor's operation. */
export function adoptIncorporationScope(scope: string, turnoId: string): void {
  for (const [key, operation] of pending) if (operation.turnoId === turnoId && operation.scope !== scope) pending.delete(key);
}

export function forgetIncorporation(turnoId: string): void {
  for (const [key, operation] of pending) if (operation.turnoId === turnoId) pending.delete(key);
}

export function __resetIncorporationMemoryForTest(): void { pending.clear(); }
