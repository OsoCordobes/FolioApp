/** Opaque marker: exact nonnegative PostgreSQL bigint plus the org's local day.
 * Reject legacy counters: they cannot detect midnight without a database write. */
export function isAgendaRevisionToken(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(0|[1-9]\d{0,18}):(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match || BigInt(match[1]) > BigInt("9223372036854775807")) return false;
  const year = Number(match[2]), month = Number(match[3]), day = Number(match[4]);
  if (year === 0 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
