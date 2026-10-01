/** Browser memory only. Every entry belongs to one authenticated staff session, org and turno. */
export type LinkSnapshot = { generation: string; contextHash: string; active: boolean; invitationId?: string | null; expiresAt?: string | null };
export type LinkOperation = {
  kind: "issue" | "revoke";
  scope: string;
  turnoId: string;
  operationId: string;
  expectedGeneration: string;
  expectedContext: string;
  token?: string;
  tokenHash?: string;
};
export type SavedLink = { token: string; generation: string; invitationId: string; expiresAt: string };
type Entry = { pending?: LinkOperation; link?: SavedLink; fence?: { generation: string; contextHash: string } };
const entries = new Map<string, Entry>();
const key = (scope: string, turnoId: string) => `${scope}:${turnoId}`;
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");

/** Invalidate delayed reads when staff access changes, including A→B→A. */
export class StaffAuthorityGate {
  private currentScope: string | null = null;
  private revision = 0;
  get scope(): string | null { return this.currentScope; }
  setScope(scope: string | null): boolean {
    if (scope === this.currentScope && scope !== null) return false;
    this.currentScope = scope;
    ++this.revision;
    return true;
  }
  capture(): { scope: string | null; revision: number } { return { scope: this.currentScope, revision: this.revision }; }
  allows(stamp: { scope: string | null; revision: number }): boolean {
    return stamp.scope !== null && stamp.scope === this.currentScope && stamp.revision === this.revision;
  }
}

export async function newLinkOperation(scope: string, turnoId: string, state: LinkSnapshot, kind: "issue" | "revoke"): Promise<LinkOperation> {
  const operation: LinkOperation = { kind, scope, turnoId, operationId: crypto.randomUUID(), expectedGeneration: state.generation, expectedContext: state.contextHash };
  if (kind === "issue") {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    operation.token = hex(bytes);
    operation.tokenHash = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
  }
  return operation;
}

export function rememberedLink(scope: string, turnoId: string, state: LinkSnapshot): SavedLink | null {
  const entry = entries.get(key(scope, turnoId));
  const link = entry?.link;
  if (!link) return null;
  if (!state.active || link.generation !== state.generation || link.invitationId !== state.invitationId) {
    delete entry!.link;
    return null;
  }
  return link;
}

export function pendingLinkOperation(scope: string, turnoId: string): LinkOperation | null {
  return entries.get(key(scope, turnoId))?.pending ?? null;
}

/** Old not_recorded responses cannot resurrect a resolved mutation. */
export function isPendingLinkOperation(operation: LinkOperation): boolean {
  return pendingLinkOperation(operation.scope, operation.turnoId)?.operationId === operation.operationId;
}

export function mayApplyLinkStatus(gate: StaffAuthorityGate, stamp: ReturnType<StaffAuthorityGate["capture"]>, operation: LinkOperation): boolean {
  return gate.allows(stamp) && isPendingLinkOperation(operation);
}

export function scopedResult<T>(gate: StaffAuthorityGate, stamp: ReturnType<StaffAuthorityGate["capture"]>, result: T): T | null {
  return gate.allows(stamp) ? result : null;
}

export function rememberedFence(scope: string, turnoId: string, state: LinkSnapshot): boolean {
  const fence = entries.get(key(scope, turnoId))?.fence;
  return fence?.generation === state.generation && fence.contextHash === state.contextHash;
}

export function beginLinkOperation(operation: LinkOperation): void {
  const name = key(operation.scope, operation.turnoId);
  const entry = entries.get(name) ?? {};
  if (entry.pending) throw new Error("staff_mutation_pending");
  entry.pending = operation;
  delete entry.link;
  entries.set(name, entry);
}

/** A delivered durable result resolves only the exact operation that was started. */
export function resolveLinkOperation(operation: LinkOperation, status: "issued" | "revoked" | "superseded", result?: { generation: string; invitationId?: string; expiresAt?: string }): void {
  const entry = entries.get(key(operation.scope, operation.turnoId));
  if (!entry || entry.pending?.operationId !== operation.operationId) return;
  delete entry.pending;
  delete entry.link;
  delete entry.fence;
  if (status === "issued" && operation.token && result?.invitationId && result?.expiresAt) {
    entry.link = { token: operation.token, generation: result.generation, invitationId: result.invitationId, expiresAt: result.expiresAt };
  }
  if (status === "revoked" && result) entry.fence = { generation: result.generation, contextHash: operation.expectedContext };
}

/** A CAS conflict fences the old operation only after fresh state proves its precondition changed. */
export function fenceConflictedOperation(operation: LinkOperation, state: LinkSnapshot): boolean {
  if (state.generation === operation.expectedGeneration && state.contextHash === operation.expectedContext) return false;
  resolveLinkOperation(operation, "superseded");
  return true;
}

export function __resetLinkMemoryForTest(): void { entries.clear(); }

export async function withActionDeadline<T>(action: () => Promise<T>, timeoutMs = 20_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("action_timeout")), timeoutMs); });
  try { return await Promise.race([action(), deadline]); }
  finally { if (timer) clearTimeout(timer); }
}
