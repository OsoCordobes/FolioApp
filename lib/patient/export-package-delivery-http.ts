import "server-only";

import { NextResponse } from "next/server";
import { getActiveSession } from "@/lib/db/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { limitByKey } from "@/lib/security/rate-limit";
import type { FolioError, Result } from "@/lib/db/errors";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESPONSE_HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const RATE_LIMITS = { begin: 12, status: 600, claim: 120, progress: 1200,
  finish: 120, manifest: 600, fragment: 1200 } as const;
type PackageRateScope = keyof typeof RATE_LIMITS;
type PackageRateError = { code: "rate_limited"; message: string; retryAfter: number };
export function exactPackageQuery(query: URLSearchParams, keys: string[]) {
  const actual = [...query.keys()];
  return actual.length === keys.length && actual.every(key => keys.includes(key)) &&
    new Set(actual).size === actual.length;
}

export function packageJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: RESPONSE_HEADERS });
}
export function packageFailure(error: FolioError | PackageRateError) {
  if (error.code === "rate_limited") return NextResponse.json({ ok: false,
    error: { code: "rate_limited", message: error.message } }, {
    status: 429, headers: { ...RESPONSE_HEADERS,
      "Retry-After": String(Math.max(1, Math.min(3600, error.retryAfter))) },
  });
  const status = error.code === "auth_required" ? 401 :
    ["no_org", "mfa_required", "forbidden"].includes(error.code) ? 403 :
      error.code === "not_found" ? 404 : error.code === "validation" ? 400 :
        error.code === "conflict" ? 409 : 503;
  return packageJson({ ok: false, error: { code: error.code, message: error.message } }, status);
}
export function packageResult<T>(result: Result<T>, success: (data: T) => NextResponse) {
  return result.ok ? success(result.data) : packageFailure(result.error);
}
export async function packageContext(scope: PackageRateScope) {
  const session = await getActiveSession();
  if (!session.ok) return session;
  const limit = await limitByKey(`patient.export-package.${scope}`,
    `${session.data.organizationId}:${session.data.userId}`, RATE_LIMITS[scope]);
  if (!limit.ok) return { ok: false as const, error: {
    code: "rate_limited" as const,
    message: "Demasiadas solicitudes de entrega. Esperá y reintentá.",
    retryAfter: limit.resetIn,
  } };
  try {
    const client = await createSupabaseServerClient();
    return { ok: true as const, data: { client, session: session.data } };
  } catch {
    return { ok: false as const, error: { code: "network" as const,
      message: "No se pudo verificar el acceso actual." } };
  }
}
export async function packageBody(request: Request, keys: string[]): Promise<Record<string, unknown> | null> {
  if (request.headers.get("origin") !== new URL(request.url).origin ||
      request.headers.get("content-type") !== "application/json" ||
      !request.body) return null;
  const reader = request.body.getReader();
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 2048) { await reader.cancel(); return null; }
      parts.push(part.value);
    }
    const input: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const record = input as Record<string, unknown>;
    return Object.keys(record).length === keys.length &&
      Object.keys(record).every(key => keys.includes(key)) ? record : null;
  } catch { return null; }
  finally { reader.releaseLock(); }
}
export const invalidPackageRequest = () => packageJson({ ok: false,
  error: { code: "validation", message: "La solicitud de entrega es inválida." } }, 400);
export const unavailablePackage = () => packageJson({ ok: false,
  error: { code: "network", message: "No se pudo verificar la entrega. Intentá nuevamente." } }, 503);
export const packageHeaders = RESPONSE_HEADERS;
