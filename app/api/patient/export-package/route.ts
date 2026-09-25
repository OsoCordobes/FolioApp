import { startPackageOperation } from "@/lib/patient/export-package-delivery";
import { PACKAGE_CAPACITY_MESSAGE } from "@/lib/patient/export-package-capacity";
import { invalidPackageRequest, packageBody, packageContext, packageFailure,
  packageJson, packageResult, unavailablePackage, UUID } from "@/lib/patient/export-package-delivery-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The operation ID is supplied once by the caller and must be retained for
 * uncertain responses. Fingerprint and entry count are always server-derived. */
export async function POST(request: Request) {
  try {
    const body = await packageBody(request, ["patientId", "operationId"]);
    if (!body || typeof body.patientId !== "string" || !UUID.test(body.patientId) ||
        typeof body.operationId !== "string" || !UUID.test(body.operationId)) return invalidPackageRequest();
    const context = await packageContext("begin");
    if (!context.ok) return packageFailure(context.error);
    const { client, session } = context.data;
    const operation = await startPackageOperation(client, session, body.patientId, body.operationId);
    if (!operation.ok && operation.error.code === "validation" &&
        operation.error.message === PACKAGE_CAPACITY_MESSAGE) {
      return packageJson({ ok: false, error: { code: "capacity", message: PACKAGE_CAPACITY_MESSAGE } }, 413);
    }
    return packageResult(operation, data => packageJson({ ok: true, operation: data }, 201));
  } catch { return unavailablePackage(); }
}
