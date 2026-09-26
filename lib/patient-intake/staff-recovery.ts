/** Memory-only guard for closing/reopening a modal while an Action is in flight. */
export type PendingStaffMutation = "issue" | "revoke";
const pending = new Map<string, PendingStaffMutation>();

export function pendingStaffMutation(turnoId: string): PendingStaffMutation | null {
  return pending.get(turnoId) ?? null;
}

export function beginStaffMutation(turnoId: string, kind: PendingStaffMutation): void {
  if (pending.has(turnoId)) throw new Error("staff_mutation_pending");
  pending.set(turnoId, kind);
}

/** Clear only after a conclusive Action response was received by the same open control. */
export function finishStaffMutation(turnoId: string, kind: PendingStaffMutation, delivered: boolean): void {
  if (delivered && pending.get(turnoId) === kind) pending.delete(turnoId);
}

/** Test-only reset; no UI path can clear an uncertain mutation. */
export function __resetStaffMutationForTest(): void { pending.clear(); }

export async function withActionDeadline<T>(action: () => Promise<T>, timeoutMs = 20_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("action_timeout")), timeoutMs);
  });
  try { return await Promise.race([action(), deadline]); }
  finally { if (timer) clearTimeout(timer); }
}
