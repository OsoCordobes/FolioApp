import { readPackageManifestPage } from "@/lib/patient/export-package-delivery";
import { exactPackageQuery, invalidPackageRequest, packageContext, packageFailure, packageJson,
  packageResult, unavailablePackage, UUID } from "@/lib/patient/export-package-delivery-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await params;
    const query = new URL(request.url).searchParams;
    const patientId = query.get("patientId") ?? "";
    const operationId = query.get("operationId") ?? "";
    const offset = query.get("offset") ?? "";
    const limit = query.get("limit") ?? "";
    if (!exactPackageQuery(query, ["patientId", "operationId", "offset", "limit"]) ||
        !UUID.test(jobId) || !UUID.test(patientId) || !UUID.test(operationId) ||
        !/^(0|[1-9]\d{0,3})$/.test(offset) || !/^([1-9]|[1-4]\d|50)$/.test(limit)) return invalidPackageRequest();
    const context = await packageContext("manifest");
    if (!context.ok) return packageFailure(context.error);
    const page = await readPackageManifestPage(context.data.client, context.data.session,
      { patientId, operationId, jobId }, Number(offset), Number(limit));
    return packageResult(page, manifest => packageJson({ ok: true, manifest: {
      format: "folio.export-package.v1", captureMeaning: "preparation_time_not_global_snapshot",
      ...manifest } }));
  } catch { return unavailablePackage(); }
}
