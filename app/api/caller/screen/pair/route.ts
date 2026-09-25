import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { CALLER_COOKIE, CALLER_COOKIE_PATH, isSameOrigin, PAIR_CODE, readSmallJson, UUID } from "@/lib/caller/screen-http";
import { rateLimit } from "@/lib/security/rate-limit";
import { createCallerScreenClient } from "@/lib/supabase/caller-screen";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ code: PAIR_CODE }).strict();
const resultSchema = z.object({ organizationId: UUID, token: z.string().regex(/^[a-f0-9]{64}$/) });
const headers = { "Cache-Control": "no-store", "Vary": "Cookie" };
const reply = (status: number, message: string) => NextResponse.json({ error: message }, { status, headers });

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request.headers.get("origin"), request.url)) return reply(403, "Solicitud no permitida.");
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) return reply(415, "Formato no admitido.");
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 256) return reply(413, "Solicitud demasiado grande.");
  let body: unknown;
  try { body = await readSmallJson(request); } catch { return reply(400, "Código inválido."); }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return reply(400, "Código inválido.");
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limited = await rateLimit("caller.pair", ip, { maxRequests: 20, windowSec: 3600 });
  if (!limited.ok) return NextResponse.json({ error: "Esperá antes de volver a intentar." }, { status: 429, headers: { ...headers, "Retry-After": String(limited.resetIn) } });
  try {
    const client = createCallerScreenClient();
    const { data, error } = await client.rpc("caller_pair", { p_code: parsed.data.code });
    if (error) return reply(error.code === "42501" ? 403 : 503, "El código venció o ya se usó. Pedí uno nuevo.");
    const result = resultSchema.safeParse(data);
    if (!result.success) return reply(503, "No pudimos completar el emparejamiento.");
    const response = NextResponse.json({ paired: true }, { headers });
    response.cookies.set(CALLER_COOKIE, `${result.data.organizationId}.${result.data.token}`, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict",
      path: CALLER_COOKIE_PATH, maxAge: 12 * 60 * 60,
    });
    return response;
  } catch { return reply(503, "No pudimos completar el emparejamiento."); }
}
