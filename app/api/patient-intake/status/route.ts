import type { NextRequest } from "next/server";
import { allowPublicAttempt, boundSession, INTAKE_COOKIE, inputRecord, json, publicFailure, readJsonBounded, validPublicPost } from "@/lib/patient-intake/http";
import { operationStatus } from "@/lib/patient-intake/public-service";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  if (!validPublicPost(request)) return publicFailure();
  const raw = request.cookies.get(INTAKE_COOKIE)?.value;
  if (!raw) return publicFailure();
  if (!await allowPublicAttempt(request, "status", raw)) return publicFailure(429);
  try {
    const body = inputRecord(await readJsonBounded(request, 256));
    if (!body || !boundSession(raw, body.marker) || typeof body.operationId !== "string" || !UUID.test(body.operationId) ||
        Object.keys(body).some(k => !["marker", "operationId"].includes(k))) return publicFailure();
    const status = await operationStatus(raw, body.operationId);
    return json({ ok: true, ...status });
  } catch { return json({ ok: false, status: "uncertain", message: "No pudimos confirmar la recepción. Conservá tus respuestas y consultá con el consultorio." }, 503); }
}
