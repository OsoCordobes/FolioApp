/** Real PostgreSQL 16 connections, synthetic Auth stubs; never loads .env files.
 * Requires a newly created, fully migrated loopback folio_test_launch_m120_ DB.
 * Commits only this test's synthetic fixtures and retains evidence for inspection.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const value = process.env.LOCAL_SQL_TEST_URL;
if (!value) throw Error('Set explicit LOCAL_SQL_TEST_URL for a new isolated M120 database.');
const url = new URL(value);
if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || url.port !== '55439'
  || !/^\/folio_test_launch_m120_[a-z0-9_]+$/.test(url.pathname) || url.search || url.hash
  || value.includes('grkpayhxndztlfwxobnt')) throw Error('Only the dedicated loopback M120 synthetic database is allowed.');
const config = { host: '127.0.0.1', port: 55439, database: url.pathname.slice(1), user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password), ssl: false, connectionTimeoutMillis: 5000, statement_timeout: 15000,
  application_name: 'folio-m120-synthetic-concurrency' };
const clients = [];
const results = [];
const id = n => '12000000-0000-4000-8000-' + String(n).padStart(12, '0');
const paid = amount => ({ montoCents: amount, metodo: 'EFECTIVO', pagado: true });
async function connect() {
  const client = new pg.Client(config);
  await client.connect();
  clients.push(client);
  // The synthetic login is local only. Platform migration guards need postgres.
  await client.query('SET SESSION AUTHORIZATION postgres');
  return client;
}
const admin = await connect();
async function actor(uid = 1) {
  const client = await connect();
  await client.query('BEGIN; SET LOCAL ROLE authenticated');
  await client.query("SELECT set_config('test.m120_uid',$1,true)", [id(uid)]);
  return client;
}
function request(client, action, operation, visit, decision = null) {
  const query = action === 'CLOSE'
    ? 'SELECT public.close_turno_atomic($1,$2,$3,NULL,$4) AS result'
    : 'SELECT public.resolve_turno_close($1,$2,$3,$4) AS result';
  return client.query(query, [id(10), id(operation), id(visit), decision])
    .then(r => ({ ok: true, data: r.rows[0].result }), error => ({ ok: false, code: error.code }));
}
async function waiting(client) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { rows: [row] } = await admin.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [client.processID]);
    if (row?.wait_event_type === 'Lock') return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw Error('Competing PostgreSQL connection did not reach a real lock wait.');
}
async function snapshot(visit) {
  const { rows: [row] } = await admin.query(`SELECT t.estado,t.duracion_real_min,s.revision::int,s.locked_at,
    (SELECT count(*)::int FROM public.pago WHERE turno_id=t.id) AS payments,
    (SELECT monto_cents FROM public.pago WHERE turno_id=t.id) AS amount,
    (SELECT count(*)::int FROM public.transicion WHERE turno_id=t.id AND to_estado='CERRADO') AS closes,
    (SELECT count(*)::int FROM public.recordatorio_job WHERE turno_id=t.id AND tipo='POST_VISITA') AS jobs
    FROM public.turno t JOIN public.sesion s ON s.turno_id=t.id WHERE t.id=$1`, [id(visit)]);
  return row;
}
try {
  const { rows: [preflight] } = await admin.query(`SELECT current_database() AS database,host(inet_server_addr()) AS address,
    current_setting('server_version_num')::int AS version,to_regnamespace('folio_close_private') IS NOT NULL AS ready,
    EXISTS(SELECT 1 FROM public.organization WHERE id=$1 OR slug='m120-synthetic') AS seeded`, [id(10)]);
  if (preflight.database !== config.database || preflight.address !== '127.0.0.1' || preflight.version < 160000
    || preflight.version >= 170000 || !preflight.ready || preflight.seeded) throw Error('Expected migrated PostgreSQL16 with no prior M120 fixtures. Use a fresh database; no reset is performed.');
  await admin.query('BEGIN');
  await admin.query(await readFile(new URL('../fixtures/M120_turno_close.sql', import.meta.url), 'utf8'));
  await admin.query("SELECT public.enable_turno_atomic_close('Synthetic concurrency test compatible callers and recovery')");
  await admin.query('COMMIT');

  {
    const a = await actor(), b = await actor();
    const first = await request(a, 'CLOSE', 400, 100, paid(1000));
    assert.equal(first.ok, true);
    const pending = request(b, 'CLOSE', 400, 100, paid(1000));
    await waiting(b); await a.query('COMMIT');
    const second = await pending;
    assert.deepEqual(second, first); await b.query('COMMIT');
    const state = await snapshot(100);
    assert.equal(state.payments, 1); assert.equal(state.closes, 1); assert.equal(state.jobs, 1); assert.equal(state.revision, 2);
    results.push({ case: 'identical_concurrent_operation_recovers_exact_receipt', pass: true });
  }
  {
    const a = await actor(), b = await actor();
    assert.equal((await request(a, 'CLOSE', 401, 101, paid(1100))).ok, true);
    const pending = request(b, 'CLOSE', 402, 101, paid(2200));
    await waiting(b); await a.query('COMMIT');
    assert.deepEqual(await pending, { ok: false, code: '55000' }); await b.query('ROLLBACK');
    const state = await snapshot(101);
    assert.equal(state.amount, 1100); assert.equal(state.payments, 1); assert.equal(state.closes, 1); assert.equal(state.jobs, 1);
    results.push({ case: 'different_close_intents_preserve_first_payment', pass: true });
  }
  {
    const a = await actor(), b = await actor(4);
    assert.equal((await request(a, 'CLOSE', 403, 102)).ok, true);
    const pending = request(b, 'RESOLVE', 404, 102, paid(1200));
    await waiting(b); await a.query('COMMIT');
    const before = await snapshot(102);
    const second = await pending;
    assert.equal(second.ok, true); await b.query('COMMIT');
    const after = await snapshot(102);
    assert.equal(after.amount, 1200); assert.equal(after.closes, 1); assert.equal(after.jobs, 1);
    assert.equal(after.revision, before.revision); assert.deepEqual(after.locked_at, before.locked_at);
    results.push({ case: 'administrative_resolution_waits_for_close_without_clinical_rewrite', pass: true });
  }
  {
    const a = await actor(), b = await actor(4);
    assert.equal((await request(a, 'CLOSE', 405, 103, paid(1300))).ok, true);
    const pending = request(b, 'RESOLVE', 406, 103, paid(2300));
    await waiting(b); await a.query('COMMIT');
    assert.deepEqual(await pending, { ok: false, code: '40001' }); await b.query('ROLLBACK');
    assert.equal((await snapshot(103)).amount, 1300);
    results.push({ case: 'resolution_cannot_override_competing_close_decision', pass: true });
  }
  {
    const a = await actor(), b = await actor();
    assert.equal((await request(a, 'CLOSE', 407, 104, paid(1400))).ok, true);
    const pending = request(b, 'CLOSE', 407, 104, paid(2400));
    await waiting(b); await a.query('COMMIT');
    assert.deepEqual(await pending, { ok: false, code: '40001' }); await b.query('ROLLBACK');
    results.push({ case: 'same_operation_different_request_conflicts_after_wait', pass: true });
  }
  // Revocation/reassignment wins while the caller waits for the turno. The
  // subsequent authorization must observe the committed source, not old scope.
  {
    await admin.query('BEGIN');
    await admin.query('SELECT id FROM public.turno WHERE id=$1 FOR UPDATE', [id(105)]);
    const b = await actor(4);
    const pending = request(b, 'CLOSE', 408, 105, paid(1500));
    await waiting(b);
    await admin.query('UPDATE public.member SET deleted_at=clock_timestamp() WHERE id=$1', [id(41)]);
    await admin.query('COMMIT');
    assert.deepEqual(await pending, { ok: false, code: '42501' }); await b.query('ROLLBACK');
    assert.equal((await snapshot(105)).estado, 'ATENDIENDO');
    await admin.query('UPDATE public.member SET deleted_at=NULL WHERE id=$1', [id(41)]);
    results.push({ case: 'membership_revoked_while_waiting_rejected_before_effects', pass: true });
  }
  {
    await admin.query('UPDATE public.turno SET profesional_id=$1 WHERE id=$2', [id(31), id(106)]);
    await admin.query('BEGIN');
    await admin.query('SELECT id FROM public.turno WHERE id=$1 FOR UPDATE', [id(106)]);
    const b = await actor(3);
    const pending = request(b, 'CLOSE', 409, 106, paid(1600));
    await waiting(b);
    await admin.query('UPDATE public.turno SET profesional_id=$1 WHERE id=$2', [id(11), id(106)]);
    await admin.query('COMMIT');
    assert.deepEqual(await pending, { ok: false, code: '42501' }); await b.query('ROLLBACK');
    assert.equal((await snapshot(106)).estado, 'ATENDIENDO');
    results.push({ case: 'professional_assignment_changed_while_waiting_rejected', pass: true });
  }
  // Freeze actor sources through commit: a revocation cannot slip between a
  // successful current-permission check and this operation's durable receipt.
  {
    const a = await actor(4), revoker = await connect();
    assert.equal((await request(a, 'CLOSE', 410, 107)).ok, true);
    const revoke = revoker.query('UPDATE public.member SET deleted_at=clock_timestamp() WHERE id=$1', [id(41)]);
    await waiting(revoker); await a.query('COMMIT'); await revoke;
    const b = await actor(4);
    assert.deepEqual(await request(b, 'CLOSE', 410, 107), { ok: false, code: '42501' }); await b.query('ROLLBACK');
    results.push({ case: 'permission_sources_frozen_until_commit_and_receipt_rechecks_revocation', pass: true });
  }
  const { rows: [evidence] } = await admin.query(`SELECT
    (SELECT count(*)::int FROM folio_close_private.receipt WHERE organization_id=$1) AS receipts,
    (SELECT count(*)::int FROM folio_close_private.authority) AS leaked_authorities,
    (SELECT count(*)::int FROM folio_close_private.close_record WHERE organization_id=$1) AS markers,
    (SELECT count(*)::int FROM public.recordatorio_job WHERE organization_id=$1 AND tipo='POST_VISITA') AS jobs,
    (SELECT count(*)::int FROM public.pago p JOIN public.turno t ON t.id=p.turno_id WHERE t.organization_id=$1) AS payments`, [id(10)]);
  assert.deepEqual(evidence, { receipts: 7, leaked_authorities: 0, markers: 6, jobs: 6, payments: 5 });
  console.log(JSON.stringify({ passed: results.length, results, evidence,
    scope: 'Real PostgreSQL16 locks/transactions; synthetic Auth stubs; no external providers or hosted Auth/Storage' }, null, 2));
} finally {
  await admin.query('ROLLBACK').catch(() => {});
  await Promise.allSettled(clients.map(client => client.end()));
}
