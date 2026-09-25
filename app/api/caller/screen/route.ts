import { NextRequest, NextResponse } from "next/server";

import { CALLER_COOKIE, CALLER_COOKIE_PATH, callerSnapshot, parseCallerCookie, parseCallerCursor } from "@/lib/caller/screen-http";
import { rateLimit } from "@/lib/security/rate-limit";
import { createCallerScreenClient } from "@/lib/supabase/caller-screen";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", "Vary": "Cookie" };
const reply = (status: number, message: string, retryAfter?: number) => NextResponse.json(
  { error: message },
  { status, headers: { ...headers, ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}) } },
);
function unpair(response: NextResponse) {
  response.cookies.set(CALLER_COOKIE, "", { path: CALLER_COOKIE_PATH, maxAge: 0, httpOnly: true,
    secure: process.env.NODE_ENV === "production", sameSite: "strict" });
  return response;
}

export async function GET(request: NextRequest) {
  const session = parseCallerCookie(request.cookies.get(CALLER_COOKIE)?.value);
  if (!session) return unpair(reply(401, "Emparejá esta pantalla para continuar."));
  const cursor = parseCallerCursor(request.nextUrl.searchParams.get("cursor"));
  if (cursor === undefined) return reply(400, "Consulta inválida.");
  const limited = await rateLimit("caller.screen", session.token, { maxRequests: 900, windowSec: 3600 });
  if (!limited.ok) return reply(429, "Esperá un momento para reconectar.", limited.resetIn);
  try {
    const client = createCallerScreenClient();
    const { data, error } = await client.rpc("caller_screen_read", { p_org: session.org, p_token: session.token, p_cursor: cursor });
    if (error?.code === "42501") return unpair(reply(401, "La pantalla ya no está autorizada. Emparejala de nuevo."));
    if (error) return reply(503, "No pudimos actualizar la pantalla.", 5);
    const parsed = callerSnapshot.safeParse(data);
    if (!parsed.success) return reply(503, "No pudimos actualizar la pantalla.", 5);
    return NextResponse.json(parsed.data, { headers });
  } catch { return reply(503, "No pudimos actualizar la pantalla.", 5); }
}
