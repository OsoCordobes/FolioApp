import { NextRequest, NextResponse } from "next/server";
import { dispatchBookingFollowups } from "@/lib/email/booking-followups";
import { dispatchBillingFollowups } from "@/lib/email/billing-followups";
import { dispatchEmailDeliveries } from "@/lib/email/durable";
import { verifyBearer } from "@/lib/security/verify-bearer";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ok:false,error:"cron_unconfigured"},{status:503});
  if (!verifyBearer(req.headers.get("authorization"),process.env.CRON_SECRET)) return NextResponse.json({ok:false,error:"unauthorized"},{status:401});
  try {
    // At most three bounded 10s sends; each claim has a separate 2min lease.
    const billing = await dispatchBillingFollowups(1);
    const email = await dispatchEmailDeliveries(1);
    const booking = await dispatchBookingFollowups(1);
    const ok = billing.failed === 0 && email.failed === 0 && booking.failed === 0;
    return NextResponse.json({ok,billing,email,booking},{status:ok ? 200 : 503});
  } catch { return NextResponse.json({ok:false,error:"email_worker_failed"},{status:503}); }
}
export const POST = GET;
