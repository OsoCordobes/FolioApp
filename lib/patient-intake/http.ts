import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isUpstashConfigured, limitByIp, limitByKey } from "@/lib/security/rate-limit";

export const INTAKE_COOKIE = "folio.intake.session";
export const NO_STORE = { "Cache-Control": "no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" };

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function sessionMarker(raw: string): string {
  return createHash("sha256").update("folio.patient-intake.session-marker.v1\0").update(raw).digest("hex");
}

export function boundSession(raw: string | undefined, marker: unknown): raw is string {
  if (!raw || !/^[0-9a-f]{64}$/.test(raw) || typeof marker !== "string" || !/^[0-9a-f]{64}$/.test(marker)) return false;
  return timingSafeEqual(Buffer.from(sessionMarker(raw), "hex"), Buffer.from(marker, "hex"));
}

/** All public writes require an exact browser Origin and JSON, including status reads. */
export function validPublicPost(request: NextRequest): boolean {
  const host = request.headers.get("host");
  const expected = host ? `${new URL(request.url).protocol}//${host}` : null;
  return Boolean(expected && request.headers.get("origin") === expected) &&
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

export async function readJsonBounded(request: NextRequest, maxBytes: number): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new Error("body_too_large");
  if (!request.body) throw new Error("body_missing");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("body_too_large");
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const joined = Buffer.concat(chunks.map(c => Buffer.from(c)));
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined)) as unknown;
}

export function inputRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function allowPublicAttempt(request: NextRequest, scope: string, rawSession?: string): Promise<boolean> {
  // Public credential endpoints must not run without a real distributed limiter in production.
  if (process.env.NODE_ENV === "production" && !isUpstashConfigured()) return false;
  const ip = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ?? request.headers.get("x-real-ip");
  const byIp = await limitByIp(`patient-intake.${scope}`, ip, scope === "exchange" ? 15 : 90);
  if (!byIp.ok) return false;
  if (rawSession) {
    const bySession = await limitByKey(`patient-intake.${scope}.session`, sessionMarker(rawSession), 90);
    if (!bySession.ok) return false;
  }
  return true;
}

export function publicFailure(status = 403) {
  return json({ ok: false, message: "No pudimos verificar este enlace o sesión. Si ya enviaste datos, consultá con el consultorio antes de repetir." }, status);
}
