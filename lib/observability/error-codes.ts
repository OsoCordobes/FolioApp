// Approved machine codes only. Never accepts SQL text, identifiers or provider messages.
export const ERROR_CODES = new Set(['23505', '23503', '23514', '23502', '23P01', '42501', '40001', '40P01', '57014', '08006', '08001', '53300', 'P0001', 'PGRST116', 'PGRST301', 'PGRST302', 'no_org', 'locked', 'transition_invalid', 'auth_required', 'mfa_required', 'forbidden', 'not_found', 'validation', 'conflict', 'db_error', 'network', 'over_email_send_rate_limit', 'over_request_rate_limit', 'otp_expired', 'invalid_credentials', 'user_not_found', 'email_not_confirmed', 'request_timeout', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND']);
export function diagnosticCode(value: unknown, fallback = "db_error"): string {
  return typeof value === "string" && ERROR_CODES.has(value) ? value : ERROR_CODES.has(fallback) ? fallback : "db_error";
}
