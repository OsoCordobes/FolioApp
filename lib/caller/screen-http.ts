import { z } from "zod";

export const CALLER_COOKIE = "folio.caller_screen";
export const CALLER_COOKIE_PATH = "/api/caller/screen";
export const PAIR_CODE = z.string().regex(/^[a-f0-9]{16}$/);
export const SCREEN_TOKEN = z.string().regex(/^[a-f0-9]{64}$/);
export const UUID = z.string().uuid();

export const callerSnapshot = z.object({
  cursor: z.number().int().nonnegative(),
  reset: z.boolean(),
  snapshot: z.array(z.object({
    code: z.string().regex(/^A\d{4}$/),
    destination: z.string().min(1).max(32),
    cursor: z.number().int().nonnegative(),
  })).max(20),
});

export function parseCallerCookie(raw: string | undefined) {
  if (!raw || raw.length !== 101) return null;
  const [org, token, extra] = raw.split(".");
  if (extra || !UUID.safeParse(org).success || !SCREEN_TOKEN.safeParse(token).success) return null;
  return { org, token };
}

export function parseCallerCursor(raw: string | null): number | null | undefined {
  if (raw === null) return null;
  if (!/^(0|[1-9]\d{0,14})$/.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : undefined;
}

export function isSameOrigin(origin: string | null, requestUrl: string) {
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(requestUrl).origin; } catch { return false; }
}

export async function readSmallJson(request: Request, maxBytes = 256): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("empty_body");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) throw new Error("body_too_large");
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
