/** In-memory only. A lost response never discards the operation or its answers. */
export interface SubmissionAttempt {
  operationId: string;
  answers: Record<string, unknown>;
  phase: "sending" | "uncertain" | "not_received" | "received";
  receiptId?: string;
}

export function newSubmissionAttempt(answers: Record<string, unknown>, operationId = crypto.randomUUID()): SubmissionAttempt {
  return { operationId, answers: structuredClone(answers), phase: "sending" };
}

export function reconcileAttempt(attempt: SubmissionAttempt, status: unknown): SubmissionAttempt {
  if (attempt.phase === "received") return attempt;
  if (!status || typeof status !== "object") return { ...attempt, phase: "uncertain" };
  const data = status as Record<string, unknown>;
  if (data.status === "received" && typeof data.receiptId === "string") {
    return { ...attempt, phase: "received", receiptId: data.receiptId };
  }
  if (data.status === "not_received") return { ...attempt, phase: "not_received" };
  return { ...attempt, phase: "uncertain" };
}

/** Ignore delayed responses from another operation and never downgrade a receipt. */
export function mergeAttemptForOperation(current: SubmissionAttempt | null, operationId: string, status: unknown): SubmissionAttempt | null {
  if (!current || current.operationId !== operationId) return current;
  return reconcileAttempt(current, status);
}
