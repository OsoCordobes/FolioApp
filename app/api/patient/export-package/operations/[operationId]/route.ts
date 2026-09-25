import { readPackageOperation } from "@/lib/patient/export-package-delivery";
import { exactPackageQuery, invalidPackageRequest, packageContext, packageFailure, packageJson,
  packageResult, unavailablePackage, UUID } from "@/lib/patient/export-package-delivery-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request,
  { params }: { params: Promise<{ operationId: string }> }) {
  try {
    const { operationId } = await params;
    const query = new URL(request.url).searchParams;
    const patientId = query.get("patientId") ?? "";
    if (!exactPackageQuery(query, ["patientId"]) ||
        !UUID.test(operationId) || !UUID.test(patientId)) return invalidPackageRequest();
    const context = await packageContext("status");
    if (!context.ok) return packageFailure(context.error);
    const status = await readPackageOperation(context.data.client, context.data.session,
      patientId, operationId);
    return packageResult(status, operation => packageJson({ ok: true, operation }));
  } catch { return unavailablePackage(); }
}
