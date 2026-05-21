/**
 * Folio · safe-redirect — open-redirect mitigation.
 *
 * `searchParams.get("redirect")` on /login is attacker-controllable.
 * Without validation, `/login?redirect=https://evil.com` would push the
 * authenticated user off-domain. Per Ley 25.326 + standard OWASP guidance
 * for healthcare apps, redirect targets must be same-origin paths only.
 *
 * Rules:
 *   - Must start with a single `/`
 *   - Must NOT start with `//` (protocol-relative)
 *   - Must NOT start with `/\` (backslash escape)
 *   - Must NOT contain `://` (absolute URL)
 *   - Empty / null / malformed → fallback
 *
 * Usage:
 *   const target = safeRedirect(searchParams.get("redirect"), "/hoy");
 *   router.push(target);
 */

export function safeRedirect(
  raw: string | null | undefined,
  fallback: `/${string}`,
): string {
  if (typeof raw !== "string") return fallback;
  if (raw.length === 0) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  if (raw.startsWith("/\\")) return fallback;
  if (raw.includes("://")) return fallback;
  // Optional defense in depth: bound path length to avoid pathological URLs.
  if (raw.length > 2048) return fallback;
  return raw;
}
