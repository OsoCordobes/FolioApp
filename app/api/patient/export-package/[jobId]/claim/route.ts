import { claimPackageOperation } from "@/lib/patient/export-package-delivery";
import { invalidPackageRequest, packageBody, packageContext, packageFailure,
  packageJson, packageResult, unavailablePackage, UUID } from "@/lib/patient/export-package-delivery-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await params;
    const body = await packageBody(request, ["patientId", "operationId", "revision"]);
    if (!UUID.test(jobId) || !body || typeof body.patientId !== "string" ||
        typeof body.operationId !== "string" || !UUID.test(body.patientId) ||
        !UUID.test(body.operationId) || !Number.isSafeInteger(body.revision)) return invalidPackageRequest();
    const context = await packageContext();
    if (!context.ok) return packageFailure(context.error);
    const claim = await claimPackageOperation(context.data.client, context.data.session,
      { patientId: body.patientId, operationId: body.operationId, jobId }, body.revision as number);
    return packageResult(claim, lease => packageJson({ ok: true, lease }));
  } catch { return unavailablePackage(); }
}
