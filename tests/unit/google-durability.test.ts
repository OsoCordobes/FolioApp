/* eslint-disable @typescript-eslint/no-explicit-any -- synthetic provider fixtures */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const requireActual = createRequire(import.meta.url);
function load(file: string, mocks: Record<string, unknown>) { const exports: Record<string, any> = {}; runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: (name: string) => name in mocks ? mocks[name] : requireActual(name.startsWith('@/') ? resolve(name.slice(2)) : name.startsWith('.') ? resolve(dirname(file), name) : name), console, process, AbortSignal, Date, Set, Map, Buffer, URL, crypto }); return exports; }
const event = (id: string) => ({ id, start: { dateTime: '2026-09-08T12:00:00Z' }, end: { dateTime: '2026-09-08T12:30:00Z' }, status: 'confirmed' });
function calendar(pages: unknown[]) { let at = 0; const calls: any[] = []; const api = { events: { list: async (...args: any[]) => { calls.push(args); const next = pages[at++]; if (next instanceof Error)
            throw next; const body=next as any; return { data: body==null?body:{kind:'calendar#events',etag:'synthetic-etag',...(!body.nextPageToken?{nextSyncToken:'complete'}:{}),...body} }; } } }; return { api, calls, module: load('lib/google/calendar.ts', { 'googleapis': { google: { calendar: () => api } }, './oauth': { makeOAuth2Client: () => ({}) } }) }; }
test('Google listing follows every page even when an intermediate page is empty', async () => { const c = calendar([{ items: [event('one')], nextPageToken: 'p2' }, { items: [], nextPageToken: 'p3' }, { items: [event('last')], nextSyncToken: 'never-used' }]); const events = await c.module.listEvents('synthetic', '2026-09-08', '2026-10-08', 'selected'); assert.equal(events.length, 2); assert.equal(c.calls.length, 3); assert.equal(c.calls[1][0].pageToken, 'p2'); assert.equal(c.calls[2][0].calendarId, 'selected'); assert.ok(c.calls.every(call => call[1]?.signal && call[1].timeout > 0)); assert.ok(c.calls.every(call => call[0].syncToken === undefined)); });
test('a failed later page rejects the entire snapshot', async () => { const c = calendar([{ items: [event('one')], nextPageToken: 'p2' }, new Error('synthetic provider outage')]); await assert.rejects(() => c.module.listEvents('synthetic', '2026-09-08', '2026-10-08')); });
test('page token cycle and malformed active event reject instead of implying absence', async () => { for (const pages of [[{ items: [], nextPageToken: 'repeat' }, { items: [], nextPageToken: 'repeat' }], [{ items: [{ id: 'bad', start: { dateTime: 'nonsense' }, end: { dateTime: 'nonsense' } }] }]]) {
    const c = calendar(pages);
    await assert.rejects(() => c.module.listEvents('synthetic', '2026-09-08', '2026-10-08'));
} });
function dbQuery(data: unknown) { const q: any = {}; for (const key of ['select', 'eq', 'is', 'limit'])
    q[key] = () => q; q.maybeSingle = async () => ({ data, error: null }); return q; }
function outboundFixture(options: {
    uncertain?: boolean;
    foreign?: boolean;
    superseded?: boolean;
    revoked?: boolean;
    revokedAfterRead?: boolean;
    missingEtag?: boolean;
} = {}) {
    const job = { id: 'job', organization_id: 'org', integration_id: 'integration', turno_id: 'turn', calendar_id: 'selected', event_id: 'f0123456789', lease_token: 'lease', claimed_version: 1, desired_version: 1 };
    const calls: any[] = [];
    let existing: any = options.missingEtag ? {id:job.event_id,extendedProperties:{private:{folio_operation:job.event_id}}} : options.foreign ? { id: job.event_id, summary: 'Private user event' } : undefined;
    const service = { rpc: async (name: string, args: unknown) => { calls.push([name, args]); return { data: name === 'google_claim_outbound' ? [job] : name === 'google_outbound_access' ? !options.revoked&&(!options.revokedAfterRead||calls.filter(c=>c[0]==='google_outbound_access').length===1) : true, error: null }; }, from: (table: string) => dbQuery(table === 'integration' ? { id: 'integration', organization_id: 'org', profesional_id: 'member', refresh_token_cifrado: 'cipher', meta_json: { calendar_id: 'selected' } } : table === 'turno' ? { id: 'turn', organization_id: 'org', profesional_id: 'member', inicio: '2026-09-09T12:00:00Z', duracion_min: 30, estado: 'AGENDADO', gcal_event_id: null } : table === 'organization' ? { timezone: 'America/Argentina/Cordoba' } : { desired_version: options.superseded ? 2 : 1, lease_token: 'lease' }) };
    const loaded = load('lib/google/outbound.ts', { 'server-only': {}, '@/lib/crypto': { decryptColumn: () => 'synthetic' }, '@/lib/supabase/server': { createSupabaseServiceClient: () => service }, './health': { isInvalidGrantError: () => false }, './calendar': {
            getEvent: async (...args: any[]) => { calls.push(['get', ...args]); if (!existing)
                throw { code: 404 }; return existing; },
            createEvent: async (...args: any[]) => { calls.push(['create', ...args]); existing = { id: job.event_id, etag: 'revision1', extendedProperties: { private: { folio_operation: job.event_id } } }; if (options.uncertain)
                throw new Error('timeout after provider accepted'); return job.event_id; },
            updateEvent: async (...args: any[]) => { calls.push(['update', ...args]); },
        } });
    return { module: loaded, calls };
}
test('outbound uncertain accepted insert retries by GET stable ID and does not create twice', async () => {
    const f = outboundFixture({ uncertain: true });
    assert.equal((await f.module.dispatchGoogleOutbound()).retryable, 1);
    assert.equal((await f.module.dispatchGoogleOutbound()).complete, 1);
    assert.equal(f.calls.filter(c => c[0] === 'create').length, 1);
    assert.equal(f.calls.filter(c => c[0] === 'get').length, 2);
    const insert = f.calls.find(c => c[0] === 'create');
    assert.equal(insert[3], 'selected');
    assert.equal(insert[4], 'f0123456789');
    assert.equal(insert[2].summary, 'Turno reservado');
    assert.equal(insert[2].attendeeEmail, undefined);
    assert.equal(f.calls.find(c => c[0] === 'update')[6], 'revision1');
});
test('outbound never patches foreign provider events, nor knowingly superseded versions', async () => {
    for (const options of [{ foreign: true }, { superseded: true }]) {
        const f = outboundFixture(options);
        await f.module.dispatchGoogleOutbound();
        assert.equal(f.calls.filter(c => ['create', 'update'].includes(c[0])).length, 0);
    }
});
test('cancelled caller prevents listing before any provider I/O', async () => { const f = calendar([]); const ctrl = new AbortController(); ctrl.abort(); await assert.rejects(() => f.module.listEvents('synthetic', '2026-09-08', '2026-10-08', 'selected', ctrl.signal)); assert.equal(f.calls.length, 0); });
test('inbound real orchestrator never applies a failed paginated snapshot and rehydrates claimed scope', async () => {
    for (const fail of [true, false]) {
        const calls: any[] = [];
        const integration = { id: 'integration', organization_id: 'org', profesional_id: 'member', refresh_token_cifrado: 'cipher', meta_json: { calendar_id: 'selected' } };
        const service = { from: (name: string) => dbQuery(name === 'integration' ? integration : { timezone: 'America/Argentina/Cordoba' }), rpc: async (name: string, args: any) => { calls.push([name, args]); return { data: name === 'google_integration_access' ? true : name === 'google_claim_inbound' ? { lease: 'lease', organization_id: 'org', profesional_id: 'member', calendar_id: 'selected' } : { upserted: 1, deleted: 1 }, error: null }; } };
        const cal = calendar(fail ? [{ items: [event('first')], nextPageToken: 'later' }, new Error('expired sync 410')] : [{ items: [], nextPageToken: 'last' }, { items: [] }]);
        const loaded = load('lib/google/inbound.ts', { '@/lib/crypto': { decryptColumn: () => 'synthetic' }, './calendar': cal.module, './health': { isInvalidGrantError: () => false } });
        if (fail) {
            await assert.rejects(() => loaded.syncGoogleInbound(service, integration));
            assert.ok(!calls.some(c => c[0] === 'google_apply_snapshot'));
            assert.ok(calls.some(c => c[0] === 'google_fail_inbound'));
        }
        else {
            await loaded.syncGoogleInbound(service, integration);
            assert.ok(calls.some(c => c[0] === 'google_apply_snapshot' && c[1].p_calendar === 'selected'));
        }
    }
});
test('webhook requires current token, resource, and finite future expiry before sync', async () => {
    const { NextResponse } = requireActual('next/server');
    let syncs = 0;
    const meta: any = { watch_resource_id: 'resource', watch_token: 'secret', watch_expires_at: new Date(Date.now() + 60000).toISOString() };
    const loaded = load('app/api/google/webhook/route.ts', { 'next/server': { NextResponse }, '@/lib/security/verify-bearer': { verifyBearer: (value: string, expected: string) => value === `Bearer ${expected}` }, '@/lib/google/inbound': { syncGoogleInbound: async () => { syncs++; return { ok: true }; } }, '@/lib/supabase/server': { createSupabaseServiceClient: () => ({ from: () => dbQuery({ id: 'integration', meta_json: meta }) }) } });
    const request = (token: string) => new Request('https://synthetic.test/api/google/webhook', { method: 'POST', headers: { 'x-goog-channel-id': 'channel', 'x-goog-resource-id': 'resource', 'x-goog-resource-state': 'exists', 'x-goog-channel-token': token } });
    await loaded.POST(request('wrong'));
    assert.equal(syncs, 0);
    await loaded.POST(request('secret'));
    assert.equal(syncs, 1);
    meta.watch_expires_at = 'invalid';
    await loaded.POST(request('secret'));
    assert.equal(syncs, 1);
});
test('watch renewal persists replacement before stopping the old channel, and preserves old on uncertain commit', async () => {
    const { NextResponse } = requireActual('next/server');
    for (const uncertain of [false, true]) {
        const calls: string[] = [];
        const row = { id: 'integration', organization_id: 'org', profesional_id: 'member', refresh_token_cifrado: 'cipher', meta_json: { calendar_id: 'selected', watch_channel_id: 'old', watch_resource_id: 'old-resource', watch_token: 'previous' } };
        const service = { rpc: async (name: string) => { calls.push(name); return name === 'google_due_integrations' ? { data: [row], error: null } : name === 'google_integration_access' ? {data:true,error:null} : { data: uncertain ? null : true, error: uncertain ? { code: 'DB_ERROR' } : null }; }, from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }) };
        const loaded = load('app/api/cron/google-watch-renew/route.ts', { 'next/server': { NextResponse }, '@/lib/crypto': { decryptColumn: () => 'synthetic' }, '@/lib/google/health': { isInvalidGrantError: () => false }, '@/lib/security/verify-bearer': { verifyBearer: () => true }, '@/lib/supabase/server': { createSupabaseServiceClient: () => service }, '@/lib/google/calendar': { startWatchChannel: async (_token: string, _channel: string, _url: string, calendarId: string, secret: string, signal: AbortSignal) => { assert.equal(calendarId, 'selected'); assert.ok(secret.length >= 32); assert.ok(signal); calls.push('start'); return { resourceId: 'new-resource', expiration: String(Date.now() + 86400000) }; }, stopWatchChannel: async (_token: string, channel: string) => { calls.push('stop:' + channel); } } });
        const oldApp = process.env.NEXT_PUBLIC_APP_URL, oldSecret = process.env.CRON_SECRET;
        process.env.NEXT_PUBLIC_APP_URL = 'https://synthetic.test';
        process.env.CRON_SECRET = 'synthetic';
        try {
            await loaded.GET(new Request('https://synthetic.test/cron'));
        }
        finally {
            if (oldApp === undefined)
                delete process.env.NEXT_PUBLIC_APP_URL;
            else
                process.env.NEXT_PUBLIC_APP_URL = oldApp;
            if (oldSecret === undefined)
                delete process.env.CRON_SECRET;
            else
                process.env.CRON_SECRET = oldSecret;
        }
        if (uncertain)
            assert.ok(!calls.some(c => c.startsWith('stop:')));
        else
            assert.ok(calls.indexOf('google_commit_watch') < calls.indexOf('stop:old'));
    }
});


test('independent review: missing ETag or revoked current scope cannot authorize a provider mutation',async()=>{
 for(const options of [{missingEtag:true},{revoked:true},{revokedAfterRead:true}]){const f=outboundFixture(options);await f.module.dispatchGoogleOutbound();assert.equal(f.calls.filter(c=>['create','update'].includes(c[0])).length,0);if(options.revoked)assert.equal(f.calls.filter(c=>c[0]==='get').length,0);}
});

test('independent review: impossible all-day date rejects the complete snapshot',async()=>{
 const f=calendar([{items:[{id:'invalid-day',start:{date:'2026-02-30'},end:{date:'2026-03-03'},status:'confirmed'}]}]);
 await assert.rejects(()=>f.module.listEvents('synthetic','2026-02-01','2026-03-10'));
 const timed=calendar([{items:[{id:'invalid-time',start:{dateTime:'2026-02-30T12:00:00Z'},end:{dateTime:'2026-03-03T12:00:00Z'},status:'confirmed'}]}]);
 await assert.rejects(()=>timed.module.listEvents('synthetic','2026-02-01','2026-03-10'));
});

test('independent review: long-running absence still blocks the entire current window',()=>{
 const loaded=load('lib/google/inbound.ts',{'@/lib/crypto':{decryptColumn:()=>null},'./calendar':{}});
 const plan=loaded.planInboundSync({events:[{id:'long-absence',start:'2024-01-01',end:'2026-12-31',allDay:true,status:'confirmed'}],existing:[],folioEventIds:new Set(),windowStartMs:Date.parse('2026-09-08T03:00:00Z'),windowEndMs:Date.parse('2026-10-08T03:00:00Z'),timeZone:'America/Argentina/Cordoba'});
 assert.equal(plan.upserts.length,30);assert.equal(plan.upserts[0].inicio,'2026-09-08T03:00:00.000Z');
});


test('independent review: OAuth callback blocks synthetic, unaccepted and MFA-denied scopes before token exchange',async()=>{
 const {NextResponse}=requireActual('next/server');
 for(const reason of ['synthetic','invited','mfa','lookup']){
  let exchanged=0;
  const service={from:(table:string)=>{const q=dbQuery(table==='member'?{id:'member',organization_id:'org',accepted_at:reason==='invited'?null:'accepted',invited_by_id:reason==='invited'?'inviter':null}:{id:'org',is_synthetic:reason==='synthetic'});q.upsert=async()=>({error:null});if(reason==='lookup'&&table==='organization')q.maybeSingle=async()=>({data:null,error:{message:'private database details'}});return q;}};
  const loaded=load('app/api/google/callback/route.ts',{'next/server':{NextResponse},'next/headers':{cookies:async()=>({get:()=>({value:'state'})})},'@/lib/observability/safe-log':{safeLog:()=>{}},'@/lib/crypto':{encryptColumn:()=> 'cipher'},'@/lib/google/oauth':{exchangeCodeForTokens:async()=>{exchanged++;return {access_token:'synthetic',refresh_token:'synthetic'};}},'@/lib/google/oauth-state':{GOOGLE_OAUTH_STATE_COOKIE:'synthetic-state',googleOAuthStateCookieOptions:()=>({}),verifyGoogleOAuthState:()=>({ok:true,memberId:'member',fromOnboarding:false})},'@/lib/supabase/server':{createSupabaseServerClient:async()=>service},'@/lib/auth/mfa-access':{verifyMfaSession:async()=>reason==='mfa'?{ok:false,error:{code:'mfa_required'}}:{ok:true,data:{user:{id:'user'}}}}});
  await loaded.GET(new Request('https://synthetic.test/api/google/callback?code=synthetic&state=state'));assert.equal(exchanged,0,reason);
 }
});


test('independent review: missing collection envelope cannot authorize an empty destructive snapshot',async()=>{
 const loaded=load('lib/google/calendar.ts',{'googleapis':{google:{calendar:()=>({events:{list:async()=>({data:{}})}})}},'./oauth':{makeOAuth2Client:()=>({})}});
 await assert.rejects(()=>loaded.listEvents('synthetic','2026-09-08','2026-10-08'));
});
