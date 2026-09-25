import "server-only";

import { NextResponse } from "next/server";
import { getActiveSession } from "@/lib/db/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FolioError, Result } from "@/lib/db/errors";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESPONSE_HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export function packageJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: RESPONSE_HEADERS });
}
export function packageFailure(error: FolioError) {
  const status = error.code === "auth_required" ? 401 :
    ["no_org", "mfa_required", "forbidden"].includes(error.code) ? 403 :
      error.code === "not_found" ? 404 : error.code === "validation" ? 400 :
        error.code === "conflict" ? 409 : 503;
  return packageJson({ ok: false, error: { code: error.code, message: error.message } }, status);
}
export function packageResult<T>(result: Result<T>, success: (data: T) => NextResponse) {
  return result.ok ? success(result.data) : packageFailure(result.error);
}
export async function packageContext() {
  const session = await getActiveSession();
  if (!session.ok) return session;
  try {
    const client = await createSupabaseServerClient();
    return { ok: true as const, data: { client, session: session.data } };
  } catch {
    return { ok: false as const, error: { code: "network" as const,
      message: "No se pudo verificar el acceso actual." } };
  }
}
export async function packageBody(request: Request, keys: string[]): Promise<Record<string, unknown> | null> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json") || !request.body) return null;
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
