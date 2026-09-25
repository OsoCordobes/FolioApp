export type PendingCall = { operationId: string; destination: "RECEPCION" | "CONSULTORIO"; room: number | null };

/** Only a confirmed receipt resolves an operation that may already have committed. */
export function pendingAfterAttempt(intent: PendingCall, confirmed: boolean): PendingCall | null {
  return confirmed ? null : intent;
}
