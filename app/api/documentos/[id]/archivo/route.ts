import { readDocumentoDownload } from "@/lib/db/documentos";
import { clinicalFileResponse, CLINICAL_RESPONSE_HEADERS } from "@/lib/storage/clinical-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const result = await readDocumentoDownload(id);
    if (!result.ok) {
      const code = result.error.code;
      const status = code === "auth_required" ? 401 : code === "forbidden" || code === "mfa_required" || code === "no_org" ? 403 : code === "not_found" ? 404 : code === "validation" ? 422 : 503;
      return Response.json({ ok: false, error: { code, message: result.error.message } }, { status, headers: CLINICAL_RESPONSE_HEADERS });
    }
    return clinicalFileResponse(request, result.data);
  } catch {
    return Response.json({ ok: false, error: { code: "network", message: "No pudimos abrir el archivo. Intentá nuevamente." } }, { status: 503, headers: CLINICAL_RESPONSE_HEADERS });
  }
}

export const HEAD = GET;
