import { getOperationsSnapshot } from "@/lib/db/operations";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
export async function GET() {
 const result = await getOperationsSnapshot();
 if (!result.ok) return Response.json({ok:false,error:{code:result.error.code,message:result.error.message}},{status:result.error.code==="auth_required"?401:result.error.code==="forbidden"||result.error.code==="mfa_required"?403:503,headers});
 return Response.json({ok:true,data:result.data},{headers});
}
