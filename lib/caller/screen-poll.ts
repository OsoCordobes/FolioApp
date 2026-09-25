export interface CallSnapshot {
  cursor: number;
  reset: boolean;
  snapshot: { cursor: number }[];
}

/** A reset or reconnect never announces historical calls. */
export function shouldPlayCallTone(next: CallSnapshot, priorCursor: number | null, baseline: boolean, enabled: boolean) {
  return enabled && baseline && !next.reset && priorCursor !== null && next.cursor > priorCursor &&
    next.snapshot.some(call => call.cursor > priorCursor);
}

export function callerRetryDelay(retryAfter: string | null, failures: number) {
  const seconds = Number(retryAfter);
  if (retryAfter !== null && Number.isSafeInteger(seconds) && seconds > 0) return seconds * 1000;
  return Math.min(5000 * 2 ** Math.min(failures, 8), 60_000);
}
