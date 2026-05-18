/**
 * Folio · Cloudflare Turnstile (captcha) server-side verification.
 *
 * Turnstile es el captcha invisible de Cloudflare. El widget en el cliente
 * (booking) emite un token; este módulo lo valida contra la API de Cloudflare.
 *
 * Env vars:
 *   - TURNSTILE_SECRET_KEY — secret del site (Cloudflare dashboard)
 *   - NEXT_PUBLIC_TURNSTILE_SITE_KEY — pública, embed en el cliente
 *
 * En desarrollo (sin secret configurada), `verifyTurnstile` retorna `true`
 * para no bloquear el dev loop. En producción es **obligatorio** que esté
 * la secret seteada.
 */

interface SiteVerifyResponse {
  success: boolean;
  "error-codes"?: string[];
  challenge_ts?: string;
  hostname?: string;
  action?: string;
}

export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp?: string | null,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  // Dev mode: sin secret seteada → permitir (warning visible en build/start)
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error("[turnstile] TURNSTILE_SECRET_KEY no configurada en producción");
      return false;
    }
    return true;
  }

  if (!token || token.length < 10) return false;

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) return false;
    const json: SiteVerifyResponse = await res.json();
    return json.success === true;
  } catch {
    return false;
  }
}
