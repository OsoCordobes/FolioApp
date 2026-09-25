import { NextResponse } from "next/server";
import { writeAuditEntry } from "@/lib/db/audit";
import { readPackageFragment } from "@/lib/patient/export-package-delivery";
import { exactPackageQuery, invalidPackageRequest, packageContext, packageFailure, packageHeaders,
  unavailablePackage, UUID } from "@/lib/patient/export-package-delivery-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request, { params }: {
  params: Promise<{ jobId: string; entryId: string; ordinal: string }>;
}) {
  try {
    const { jobId, entryId, ordinal } = await params;
    const query = new URL(request.url).searchParams;
    const patientId = query.get("patientId") ?? "";
    const operationId = query.get("operationId") ?? "";
    if (!exactPackageQuery(query, ["patientId", "operationId"]) ||
        !UUID.test(jobId) || !UUID.test(entryId) || !UUID.test(patientId) ||
        !UUID.test(operationId) || !/^(0|[1-9]\d{0,3})$/.test(ordinal)) return invalidPackageRequest();
    const context = await packageContext();
    if (!context.ok) return packageFailure(context.error);
    const fragment = await readPackageFragment(context.data.client, context.data.session,
      { patientId, operationId, jobId }, entryId, Number(ordinal));
    if (!fragment.ok) return packageFailure(fragment.error);
    await writeAuditEntry({ organizationId: context.data.session.organizationId,
      actorId: context.data.session.userId, actorRole: context.data.session.role,
      action: "paciente.export-package.fragment", resourceType: "paciente",
      resourceId: patientId,
      ip: request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip"),
      userAgent: request.headers.get("user-agent"),
      payload: { formato: "package", canal: "profesional", job_id: jobId,
        entry_id: entryId, ordinal: Number(ordinal) } });
    return new NextResponse(Buffer.from(fragment.data.bytes), { status: 200,
      headers: { ...packageHeaders, "Content-Type": "application/octet-stream",
        "Content-Length": String(fragment.data.bytes.byteLength),
        "X-Folio-Fragment-Sha256": fragment.data.sha256,
        "X-Folio-File-Sha256": fragment.data.fileSha256,
        "X-Folio-Fragment-Count": String(fragment.data.totalFragments) } });
  } catch { return unavailablePackage(); }
}
