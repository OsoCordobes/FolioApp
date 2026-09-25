import { finishPackageOperation } from "@/lib/patient/export-package-delivery";
import { invalidPackageRequest, packageBody, packageContext, packageFailure,
  packageJson, packageResult, unavailablePackage, UUID } from "@/lib/patient/export-package-delivery-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await params;
    const body = await packageBody(request, ["patientId", "operationId", "leaseToken", "revision"]);
    if (!UUID.test(jobId) || !body || typeof body.patientId !== "string" ||
        typeof body.operationId !== "string" || typeof body.leaseToken !== "string" ||
        !UUID.test(body.patientId) || !UUID.test(body.operationId) ||
        !UUID.test(body.leaseToken) || !Number.isSafeInteger(body.revision)) return invalidPackageRequest();
    const context = await packageContext();
    if (!context.ok) return packageFailure(context.error);
    const finished = await finishPackageOperation(context.data.client, context.data.session,
      { patientId: body.patientId, operationId: body.operationId, jobId },
      body.leaseToken, body.revision as number);
    return packageResult(finished, () => packageJson({ ok: true, state: "ready" }));
  } catch { return unavailablePackage(); }
}
