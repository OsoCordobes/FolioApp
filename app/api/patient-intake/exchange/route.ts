import type { NextRequest } from "next/server";
import { allowPublicAttempt, INTAKE_COOKIE, inputRecord, json, publicFailure, readJsonBounded, sessionMarker, validPublicPost } from "@/lib/patient-intake/http";
import { exchangeInvitation } from "@/lib/patient-intake/public-service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!validPublicPost(request)) return publicFailure();
  if (!await allowPublicAttempt(request, "exchange")) return publicFailure(429);
  try {
    const body = inputRecord(await readJsonBounded(request, 256));
    if (!body || typeof body.token !== "string" || !/^[0-9a-f]{64}$/.test(body.token) || Object.keys(body).length !== 1) return publicFailure();
    const exchange = await exchangeInvitation(body.token);
    const expiry = new Date(exchange.expiresAt);
    if (expiry.getTime() <= Date.now()) return publicFailure();
    const response = json({ ok: true, marker: sessionMarker(exchange.session), expiresAt: exchange.expiresAt });
    response.cookies.set(INTAKE_COOKIE, exchange.session, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict",
      path: "/api/patient-intake", expires: expiry,
    });
    return response;
  } catch { return publicFailure(); }
}
