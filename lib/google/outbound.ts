import "server-only";
import { decryptColumn } from "@/lib/crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { createEvent, getEvent, updateEvent } from "./calendar";
import { isInvalidGrantError } from "./health";
interface OutboundJob {
    id: string;
    organization_id: string;
    integration_id: string;
    turno_id: string;
    calendar_id: string;
    event_id: string;
    lease_token: string;
    claimed_version: number;
    desired_version: number;
}
function httpStatus(error: unknown): number { const e = error as {
    code?: unknown;
    response?: {
        status?: unknown;
    };
}; return Number(e?.response?.status ?? e?.code ?? 0); }
const cancelled = new Set(['CANCELADO', 'NO_ASISTIO', 'REAGENDADO']);
export async function dispatchGoogleOutbound(limit = 10, turnoId?: string, signal?: AbortSignal) {
    signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000);
    const service = createSupabaseServiceClient();
    const picked = await service.rpc('google_claim_outbound', { p_limit: limit, p_turno: turnoId ?? null });
    if (picked.error)
        throw new Error('google_claim_failed');
    const stats = { processed: 0, complete: 0, retryable: 0, terminal: 0 };
    for (const job of (picked.data ?? []) as OutboundJob[]) {
        stats.processed++;
        let success = false, terminal = false, errorCode: string | null = null;
        try {
            signal?.throwIfAborted();
            const [integration, turno] = await Promise.all([
                service.from('integration').select('id,organization_id,profesional_id,refresh_token_cifrado,meta_json').eq('id', job.integration_id).eq('organization_id', job.organization_id).eq('proveedor', 'GOOGLE_CALENDAR').maybeSingle(),
                service.from('turno').select('id,organization_id,profesional_id,inicio,duracion_min,estado,gcal_event_id').eq('id', job.turno_id).eq('organization_id', job.organization_id).maybeSingle(),
            ]);
            if (integration.error || turno.error || !integration.data || !turno.data)
                throw new Error('source_unavailable');
            const i = integration.data, t = turno.data;
            if ((i.meta_json?.calendar_id || 'primary') !== job.calendar_id)
                throw new Error('calendar_scope_changed');
            const allowed=await service.rpc('google_outbound_access',{p_id:job.id,p_lease:job.lease_token});
            if(allowed.error||allowed.data!==true)throw new Error('source_unavailable');
            const token = decryptColumn(i.refresh_token_cifrado);
            if (!token)
                throw new Error('source_unavailable');
            // Legacy random IDs never justify a new event. An operator must establish ownership.
            if (t.gcal_event_id && t.gcal_event_id !== job.event_id) {
                const previous = await service.from('google_outbound_job').select('id').eq('organization_id', job.organization_id).eq('turno_id', job.turno_id).eq('event_id', t.gcal_event_id).limit(1).maybeSingle();
                if (previous.error || !previous.data)
                    throw new Error('ownership_review');
            }
            const desiredCancelled = cancelled.has(t.estado) || i.profesional_id !== t.profesional_id;
            let existing;
            try {
                existing = await getEvent(token, job.event_id, job.calendar_id, signal);
            }
            catch (error) {
                if (httpStatus(error) !== 404 && httpStatus(error) !== 410)
                    throw error;
            }
            if (existing && existing.extendedProperties?.private?.folio_operation !== job.event_id)
                throw new Error('ownership_review');
            if(existing && (typeof existing.etag!=='string'||!existing.etag))throw new Error('source_unavailable');
            // A newer source version must run first; no stale request is emitted knowingly.
            const current = await service.from('google_outbound_job').select('desired_version,lease_token').eq('id', job.id).maybeSingle();
            if (current.error || !current.data || current.data.lease_token !== job.lease_token || Number(current.data.desired_version) !== Number(job.claimed_version))
                throw new Error('source_unavailable');
            const stillAllowed=await service.rpc('google_outbound_access',{p_id:job.id,p_lease:job.lease_token});
            if(stillAllowed.error||stillAllowed.data!==true)throw new Error('source_unavailable');
            signal.throwIfAborted();
            if (desiredCancelled) {
                if (existing && existing.status !== 'cancelled')
                    await updateEvent(token, job.event_id, { status: 'cancelled' }, job.calendar_id, signal, existing.etag ?? undefined);
            }
            else {
                if (existing?.status === 'cancelled')
                    throw new Error('ownership_review');
                const org = await service.from('organization').select('timezone').eq('id', job.organization_id).is('deleted_at', null).maybeSingle();
                if (org.error || !org.data)
                    throw new Error('source_unavailable');
                const payload = { summary: 'Turno reservado', description: 'Reserva gestionada por Folio.', start: new Date(t.inicio).toISOString(), end: new Date(Date.parse(t.inicio) + Number(t.duracion_min) * 60000).toISOString(), timeZone: org.data.timezone || 'America/Argentina/Cordoba' };
                if (existing)
                    await updateEvent(token, job.event_id, payload, job.calendar_id, signal, existing.etag ?? undefined);
                else
                    await createEvent(token, payload, job.calendar_id, job.event_id, signal);
            }
            success = true;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : '';
            errorCode = isInvalidGrantError(error) ? 'invalid_grant' : ['ownership_review', 'calendar_scope_changed', 'source_unavailable'].includes(message) ? message : 'provider_unavailable';
            terminal = ['ownership_review', 'calendar_scope_changed', 'invalid_grant'].includes(errorCode);
        }
        const finished = await service.rpc('google_finish_outbound', { p_id: job.id, p_lease: job.lease_token, p_success: success, p_error: errorCode, p_terminal: terminal });
        if (finished.error || finished.data !== true)
            stats.retryable++;
        else if (success)
            stats.complete++;
        else if (terminal)
            stats.terminal++;
        else
            stats.retryable++;
    }
    return stats;
}
