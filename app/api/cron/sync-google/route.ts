import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/server';
import { verifyBearer } from '@/lib/security/verify-bearer';
import { dispatchGoogleOutbound } from '@/lib/google/outbound';
import { syncGoogleInbound, type IntegrationRow } from '@/lib/google/inbound';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request: NextRequest) {
    if (!process.env.CRON_SECRET || !verifyBearer(request.headers.get('authorization'), process.env.CRON_SECRET))
        return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45000)]);
    const service = createSupabaseServiceClient();
    try {
        const [outbound, inbound] = await Promise.all([dispatchGoogleOutbound(3, undefined, signal), (async () => {
                const picked = await service.rpc('google_due_integrations', { p_limit: 10, p_watch: false });
                if (picked.error)
                    throw new Error('google_pick_failed');
                const stats = { processed: 0, complete: 0, failed: 0 };
                for (const row of (picked.data ?? []) as IntegrationRow[]) {
                    if (signal.aborted)
                        break;
                    stats.processed++;
                    try {
                        const result = await syncGoogleInbound(service, row, signal);
                        if (!result.skipped)
                            stats.complete++;
                    }
                    catch {
                        stats.failed++;
                    }
                }
                return stats;
            })()]);
        return NextResponse.json({ ok: true, outbound, inbound });
    }
    catch {
        return NextResponse.json({ ok: false, error: 'google_sync_failed' }, { status: 503 });
    }
}
export const POST = GET;
