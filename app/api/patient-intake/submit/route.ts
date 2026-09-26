import type { NextRequest } from "next/server";
import { allowPublicAttempt, boundSession, INTAKE_COOKIE, inputRecord, json, publicFailure, readJsonBounded, validPublicPost } from "@/lib/patient-intake/http";
import { submitContribution } from "@/lib/patient-intake/public-service";
import { canonicalAdminV1 } from "@/lib/patient-intake/admin-v1";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  if (!validPublicPost(request)) return publicFailure();
  const raw = request.cookies.get(INTAKE_COOKIE)?.value;
  if (!raw) return publicFailure();
  if (!await allowPublicAttempt(request, "submit", raw)) return publicFailure(429);
  let body: Record<string, unknown> | null;
  try { body = inputRecord(await readJsonBounded(request, 20 * 1024)); }
  catch { return json({ ok: false, code: "invalid_answers", message: "Revisá los datos." }, 400); }
  try {
    if (!body || !boundSession(raw, body.marker) || typeof body.operationId !== "string" || !UUID.test(body.operationId) ||
        !Object.hasOwn(body, "answers") || Object.keys(body).some(k => !["marker", "operationId", "answers"].includes(k))) return publicFailure();
    try { canonicalAdminV1(body.answers); }
    catch { return json({ ok: false, code: "invalid_answers", message: "Revisá los datos." }, 400); }
    const receipt = await submitContribution(raw, body.operationId, body.answers);
    return json({ ok: true, ...receipt });
  } catch {
    // A lost response or a revoked/expired session may follow a committed write.
    return json({ ok: false, status: "uncertain", message: "No pudimos confirmar la recepción. Consultá el estado de esta operación." }, 503);
  }
}
