/** Real PostgreSQL16 settlement races. No .env files, schema reset or providers.
 * Requires a fresh fully migrated loopback folio_test_launch_m121_<suffix> DB.
 * Commits synthetic fixtures and retains them as inspection evidence.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const value = process.env.LOCAL_SQL_TEST_URL;
if (!value) throw Error('Set an explicit LOCAL_SQL_TEST_URL for a new M121 synthetic database.');
const url = new URL(value);
if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || url.port !== '55439'
  || !/^\/folio_test_launch_m121_[a-z0-9_]+$/.test(url.pathname) || url.search || url.hash
  || value.includes('grkpayhxndztlfwxobnt')) throw Error('Only the dedicated PostgreSQL16 loopback M121 database is allowed.');
const config = { host: '127.0.0.1', port: 55439, database: url.pathname.slice(1), user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password), ssl: false, connectionTimeoutMillis: 5000, statement_timeout: 15000,
  application_name: 'folio-m121-synthetic-settlement' };
const clients = [];
const cases = [];
const id = n => '12100000-0000-4000-8000-' + String(n).padStart(12, '0');
async function connect() {
  const client = new pg.Client(config); await client.connect(); clients.push(client);
  await client.query('SET SESSION AUTHORIZATION postgres'); return client;
}
const admin = await connect();
async function actor(uid = 1) {
  const client = await connect(); await client.query('BEGIN;SET LOCAL ROLE authenticated');
  await client.query("SELECT set_config('test.m121_uid',$1,true)", [id(uid)]); return client;
}
function settle(client, visit) {
  return client.query('SELECT public.settle_pago_atomic($1,$2,$3) AS result', [id(10), id(visit), id(visit + 100)])
    .then(r => ({ ok: true, data: r.rows[0].result }), e => ({ ok: false, code: e.code }));
}
async function waitForLock(client) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { rows: [row] } = await admin.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [client.processID]);
    if (row?.wait_event_type === 'Lock') return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw Error('Expected a real bounded PostgreSQL lock wait.');
}
async function payment(visit) {
  const { rows: [row] } = await admin.query('SELECT estado,pagado_ts,updated_at,monto_cents,metodo FROM public.pago WHERE id=$1', [id(visit + 100)]);
  return row;
}
try {
  const { rows: [preflight] } = await admin.query(`SELECT current_database() AS database,host(inet_server_addr()) AS address,
    current_setting('server_version_num')::int AS version,to_regnamespace('folio_settlement_private') IS NOT NULL AS ready,
    EXISTS(SELECT 1 FROM public.organization WHERE id=$1 OR slug='m121-synthetic') AS seeded,
    EXISTS(SELECT 1 FROM folio_close_private.policy WHERE enabled_at IS NOT NULL) AS close_active,
    EXISTS(SELECT 1 FROM folio_settlement_private.policy WHERE enabled_at IS NOT NULL) AS settlement_active`, [id(10)]);
  if (preflight.database !== config.database || preflight.address !== '127.0.0.1' || preflight.version < 160000
    || preflight.version >= 170000 || !preflight.ready || preflight.seeded || preflight.close_active || preflight.settlement_active) {
    throw Error('Use a fresh migrated M121 database before activation and without prior fixtures; no reset is performed.');
  }
  await admin.query('BEGIN');
  await admin.query(await readFile(new URL('../fixtures/M121_payment_settlement.sql', import.meta.url), 'utf8'));
  await admin.query('COMMIT');
  const { rows: [{ clinical }] } = await admin.query('SELECT jsonb_agg(to_jsonb(s) ORDER BY id) AS clinical FROM public.sesion s WHERE organization_id=$1', [id(10)]);
  const { rows: [{ jobs }] } = await admin.query('SELECT jsonb_agg(to_jsonb(j) ORDER BY id) AS jobs FROM public.recordatorio_job j WHERE organization_id=$1', [id(10)]);
  {
    // A legacy statement started before cutover must not keep an old policy
    // snapshot through its pago wait and bypass the newly activated guard.
    await admin.query('BEGIN');
    await admin.query('SELECT id FROM public.pago WHERE id=$1 FOR UPDATE', [id(218)]);
    const old = await actor();
    const pending = old.query("UPDATE public.pago SET estado='PAGADO',pagado_ts=clock_timestamp() WHERE id=$1 RETURNING id", [id(218)])
      .then(r => ({ ok: true, rows: r.rowCount }), e => ({ ok: false, code: e.code }));
    await waitForLock(old);
    await admin.query("SELECT public.enable_payment_settlement_authority('Synthetic verified finance and closed agenda cutover')");
    await admin.query('COMMIT');
    assert.deepEqual(await pending, { ok: false, code: '42501' }); await old.query('ROLLBACK');
    assert.equal((await payment(118)).estado, 'PENDIENTE');
    cases.push({ case: 'legacy_statement_waiting_at_cutover_rejected', pass: true });
  }
  {
    const a = await actor(), b = await actor();
    const first = await settle(a, 100); assert.equal(first.ok, true); assert.equal(first.data.alreadyPaid, false);
    const pending = settle(b, 100); await waitForLock(b); await a.query('COMMIT');
    const second = await pending; assert.equal(second.ok, true); assert.equal(second.data.alreadyPaid, true);
    assert.deepEqual(second.data.pago, first.data.pago); await b.query('COMMIT');
    const retry = await actor();
    const recovered = await settle(retry, 100); assert.equal(recovered.ok, true); assert.equal(recovered.data.alreadyPaid, true);
    assert.deepEqual(recovered.data.pago, first.data.pago); await retry.query('COMMIT');
    cases.push({ case: 'parallel_settlement_and_lost_response_retry_preserve_one_timestamp', pass: true });
  }
  for (const [visit, uid, kind] of [[101, 3, 'professional_reassignment'], [102, 3, 'member_revocation'], [103, 4, 'assistant_scope_removal']]) {
    if (uid === 3) await admin.query('UPDATE public.turno SET profesional_id=$1 WHERE id=$2', [id(31), id(visit)]);
    const before = await payment(visit);
    await admin.query('BEGIN');
    await admin.query('SELECT id FROM public.turno WHERE id=$1 FOR UPDATE', [id(visit)]);
    const worker = await actor(uid);
    const pending = settle(worker, visit); await waitForLock(worker);
    if (kind === 'professional_reassignment') await admin.query('UPDATE public.turno SET profesional_id=$1 WHERE id=$2', [id(11), id(visit)]);
    if (kind === 'member_revocation') await admin.query('UPDATE public.member SET deleted_at=clock_timestamp() WHERE id=$1', [id(31)]);
    if (kind === 'assistant_scope_removal') await admin.query("UPDATE public.member SET alcance='LISTA_PROFESIONALES',profesionales_gestionados=$2 WHERE id=$1", [id(41), [id(31)]]);
    await admin.query('COMMIT');
    assert.deepEqual(await pending, { ok: false, code: '42501' }); await worker.query('ROLLBACK');
    assert.deepEqual(await payment(visit), before);
    if (kind === 'member_revocation') await admin.query('UPDATE public.member SET deleted_at=NULL WHERE id=$1', [id(31)]);
    if (kind === 'assistant_scope_removal') await admin.query("UPDATE public.member SET alcance='TODOS',profesionales_gestionados='{}' WHERE id=$1", [id(41)]);
    cases.push({ case: `${kind}_committed_while_waiting_rejected`, pass: true });
  }
  {
    // Three connections are needed to separate pago holder, RPC and revoker.
    // Once the RPC reaches pago, its authorization sources are already frozen.
    await admin.query('BEGIN');
    await admin.query('SELECT id FROM public.pago WHERE id=$1 FOR UPDATE', [id(204)]);
    const worker = await actor(4), revoker = await connect();
    const pending = settle(worker, 104); await waitForLock(worker);
    const revoke = revoker.query('UPDATE public.member SET deleted_at=clock_timestamp() WHERE id=$1', [id(41)]);
    await waitForLock(revoker);
    await admin.query('COMMIT');
    const result = await pending; assert.equal(result.ok, true); assert.equal(result.data.alreadyPaid, false);
    await waitForLock(revoker); // Still blocked even though the RPC returned.
    await worker.query('COMMIT'); await revoke;
    const retry = await actor(4);
    assert.deepEqual(await settle(retry, 104), { ok: false, code: '42501' }); await retry.query('ROLLBACK');
    cases.push({ case: 'authority_retained_through_pago_wait_and_commit_then_revoked_retry_denied', pass: true });
  }
  const { rows: [evidence] } = await admin.query(`SELECT
    (SELECT count(*)::int FROM public.pago p JOIN public.turno t ON t.id=p.turno_id WHERE t.organization_id=$1) AS payments,
    (SELECT count(*)::int FROM public.pago p JOIN public.turno t ON t.id=p.turno_id WHERE t.organization_id=$1 AND p.estado='PAGADO') AS paid,
    (SELECT count(*)::int FROM folio_settlement_private.authority) AS leaked_authorities,
    (SELECT count(*)::int FROM folio_settlement_private.activation_history) AS activations,
    (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.sesion s WHERE organization_id=$1) AS clinical,
    (SELECT jsonb_agg(to_jsonb(j) ORDER BY id) FROM public.recordatorio_job j WHERE organization_id=$1) AS jobs`, [id(10)]);
  assert.equal(evidence.payments, 21); assert.equal(evidence.paid, 2); assert.equal(evidence.leaked_authorities, 0); assert.equal(evidence.activations, 1);
  assert.deepEqual(evidence.clinical, clinical); assert.deepEqual(evidence.jobs, jobs);
  console.log(JSON.stringify({ passed: cases.length, cases, evidence: { payments: evidence.payments, paid: evidence.paid,
    leakedAuthorities: evidence.leaked_authorities, activations: evidence.activations, clinicalUnchanged: true, jobsUnchanged: true },
  scope: 'Real PostgreSQL16 locks and authenticated SQL with synthetic Auth stubs; no services/providers/production' }, null, 2));
} finally {
  await admin.query('ROLLBACK').catch(() => {});
  await Promise.allSettled(clients.map(client => client.end()));
}
