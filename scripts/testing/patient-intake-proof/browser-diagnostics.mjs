const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = /^[0-9a-f]{64}$/i;
const generation = /^(0|[1-9][0-9]*)$/;

/** Match only the six primitive arguments of the real issue server action. */
/** @param {unknown} value @param {string} turnoId */
export function isIssueActionPayload(value, turnoId) {
  return Array.isArray(value) && value.length === 6 && value[0] === turnoId && uuid.test(turnoId)
    && typeof value[1] === "string" && hash.test(value[1]) // session scope
    && typeof value[2] === "string" && uuid.test(value[2]) // operation id
    && typeof value[3] === "string" && generation.test(value[3])
    && typeof value[4] === "string" && hash.test(value[4]) // context hash
    && typeof value[5] === "string" && hash.test(value[5]); // token hash
}

const phases = new Set(["not_seen", "other_action_seen", "payload", "fetch", "response", "db_read", "db_done", "abort_done"]);
const kinds = new Set(["none", "timeout", "network", "database", "abort", "payload", "terminal_timeout", "other"]);

/** No response body, URL, operation id, token, or exception text may be emitted. */
/** @param {unknown} phase @param {unknown} status @param {unknown} rows @param {unknown} kind */
export function interceptDiagnostic(phase, status, rows, kind) {
  const safePhase = typeof phase === "string" && phases.has(phase) ? phase : "other";
  const safeStatus = Number.isInteger(status) && Number(status) >= 100 && Number(status) <= 599 ? status : "none";
  const safeRows = Number.isInteger(rows) && Number(rows) >= 0 && Number(rows) <= 2 ? rows : "none";
  const safeKind = typeof kind === "string" && kinds.has(kind) ? kind : "other";
  return `phase=${safePhase} http=${safeStatus} rows=${safeRows} kind=${safeKind}`;
}

/** @param {unknown} error */
export function interceptErrorKind(error) {
  if (!error || typeof error !== "object") return "other";
  /** @type {{ name?: unknown; code?: unknown; message?: unknown }} */
  const named = error;
  const message = typeof named.message === "string" ? named.message : "";
  if (named.name === "TimeoutError" || named.name === "AbortError" || named.code === "ETIMEDOUT"
    || /timed out|timeout/i.test(message)) return "timeout";
  if (named.code === "ECONNRESET" || named.code === "ECONNREFUSED"
    || /socket hang up|ECONNRESET|connection reset|ECONNREFUSED|connection refused/i.test(message)) return "network";
  if (typeof named.code === "string" && /^[0-9A-Z]{5}$/.test(named.code)) return "database";
  return "other";
}

/** @template T @param {Promise<T>} terminal @param {number} timeoutMs @param {() => T} timedOut */
export async function waitForIntercept(terminal, timeoutMs, timedOut) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  try {
    return await Promise.race([terminal, new Promise(resolve => { timer = setTimeout(() => resolve(timedOut()), timeoutMs); })]);
  } finally { if (timer) clearTimeout(timer); }
}
