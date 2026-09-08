import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { verifyMpSignature, checkMpLiveMode } from "@/lib/mercadopago/webhook-security";
import { processBillingWebhook } from "@/lib/billing/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let payload: {id?:number|string;type?:string;action?:string;date_created?:string;data?:{id?:string};live_mode?:boolean};
  try { payload = JSON.parse(await request.text()); }
  catch { return new NextResponse("invalid-json",{status:400}); }
  if (!payload || typeof payload !== "object") return new NextResponse("invalid-event",{status:400});
  const dataId = payload.data?.id == null ? null : String(payload.data.id);
  const signature = verifyMpSignature({signatureHeader:request.headers.get("x-signature"),requestIdHeader:request.headers.get("x-request-id"),dataId});
  if (!signature.ok) return new NextResponse(`signature ${signature.reason}`,{status:signature.reason==="server-misconfigured"?503:403});
  if (!dataId || typeof payload.type !== "string") return new NextResponse("invalid-event",{status:400});
  // Provider notification ID, or a stable update identity when MP omits it.
  const identity = payload.id ?? [payload.type,dataId,payload.action,payload.date_created,request.headers.get("x-request-id")].join(":");
  const key = createHash("sha256").update(`mp:${payload.type}:${dataId}:${identity}`).digest("hex");
  try {
    const outcome = await processBillingWebhook({key,topic:payload.type,resourceId:dataId,discard:checkMpLiveMode(payload.live_mode).discard});
    return outcome === "done" ? NextResponse.json({ok:true}) : new NextResponse("retry-processing",{status:503});
  } catch { return new NextResponse("processing-unavailable",{status:503}); }
}
