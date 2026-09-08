import { NextResponse } from "next/server";
import { exportPersonalData } from "@/lib/me/personal-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const result = await exportPersonalData();
  if (!result.ok) {
    const code = result.error.code;
    return NextResponse.json({ ok: false, error: result.error }, {
      status: code === "auth_required" ? 401 : code === "mfa_required" || code === "forbidden" ? 403 : code === "conflict" ? 409 : code === "validation" ? 413 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return new NextResponse(JSON.stringify(result.data.payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.data.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
