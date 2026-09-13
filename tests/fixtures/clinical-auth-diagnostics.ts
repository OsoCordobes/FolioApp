const roles = new Set(['OWNER', 'ASISTENTE', 'COORDINADOR']);
const errorClasses = new Set([
  'AuthApiError', 'AuthRetryableFetchError', 'AuthUnknownError', 'AuthSessionMissingError',
  'AuthInvalidTokenResponseError', 'TimeoutError', 'AbortError', 'TypeError',
]);
const errorCodes = new Set([
  'session_not_found', 'session_expired', 'bad_jwt', 'user_not_found',
  'invalid_credentials', 'refresh_token_not_found', 'refresh_token_already_used',
  'request_timeout', 'unexpected_failure', 'over_request_rate_limit',
]);

function field(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  try { return Reflect.get(value, key); } catch { return undefined; }
}
function allowed(value: unknown, values: ReadonlySet<string>): string {
  return typeof value === 'string' && values.has(value) ? value : 'unknown';
}

/** Project only safe, bounded facts; never stringify the provider error or JWT. */
export function clinicalAuthFailureMessage(error: unknown, context: {
  expectedRole: unknown; expectedUserId: unknown; claims: unknown; elapsedMs: unknown; nowMs: number;
}): string {
  const status = field(error, 'status');
  const sub = field(context.claims, 'sub');
  const exp = field(context.claims, 'exp');
  const elapsed = context.elapsedMs;
  const facts = {
    expectedRole: allowed(context.expectedRole, roles),
    httpStatus: typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : 'unknown',
    errorClass: allowed(field(error, 'name'), errorClasses),
    errorCode: allowed(field(error, 'code'), errorCodes),
    elapsedMs: typeof elapsed === 'number' && Number.isFinite(elapsed) && elapsed >= 0 && Number.isSafeInteger(Math.round(elapsed)) ? Math.round(elapsed) : 'unknown',
    subMatches: typeof sub === 'string' && sub.length > 0 && typeof context.expectedUserId === 'string' && sub === context.expectedUserId,
    aal2: field(context.claims, 'aal') === 'aal2',
    expired: typeof exp === 'number' && Number.isFinite(exp) && Number.isFinite(context.nowMs) && exp <= context.nowMs / 1000,
  };
  return `Local clinical fixture failed: browser Auth identity. ${JSON.stringify(facts)}`;
}
