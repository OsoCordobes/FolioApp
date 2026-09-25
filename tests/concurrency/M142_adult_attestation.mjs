// Run only on the hosted, disposable postgres:16 folio_test service after all
// migrations. Two independent connections exercise real row-lock races.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

assert.equal(process.env.FOLIO_M142_SYNTHETIC, '1', 'Synthetic-only opt-in required');
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Hosted GitHub Actions required');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'GitHub-hosted runner required');
assert.equal(process.env.RUNNER_OS, 'Linux', 'Linux runner required');
assert.equal(process.platform, 'linux', 'Linux process required');
assert.ok(['localhost', '127.0.0.1'].includes(process.env.PGHOST), 'Loopback PostgreSQL required');
assert.equal(process.env.PGPORT, '5432', 'Expected hosted service port required');
assert.equal(process.env.PGDATABASE, 'folio_test', 'Only disposable folio_test is allowed');
assert.equal(process.env.PGUSER, 'postgres', 'Synthetic postgres user required');
const { Client } = pg;
const clients = [];
async function connect() {
  const client = new Client({
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
    query_timeout: 16000,
  });
  await client.connect();
  clients.push(client);
  const { rows: [identity] } = await client.query('SELECT current_database() AS db,current_user AS actor');
  assert.equal(identity.db, 'folio_test');
  assert.equal(identity.actor, 'postgres');
  return client;
}
const admin = await connect();
const actor = await connect();
const opponent = await connect();
const actorPid = (await actor.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
const opponentPid = (await opponent.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
const ids = Object.fromEntries(['user', 'org', 'member', 'patient', 'identity', 'factor', 'session']
  .map(key => [key, randomUUID()]));
const slug = `m142-race-${ids.org.slice(0, 8)}`;
const email = `m142-${ids.user}@synthetic.invalid`;

async function beginActor() {
  await actor.query('BEGIN');
  await actor.query("SELECT set_config('test.m142_race_uid',$1,true)", [ids.user]);
  await actor.query("SELECT set_config('test.m142_race_jwt',$1,true)",
    [JSON.stringify({ aal: 'aal2', session_id: ids.session })]);
  await actor.query("SELECT set_config('request.jwt.claim.role','authenticated',true)");
  await actor.query('SET LOCAL ROLE authenticated');
}
async function assertBlocked(promise, label, waiterPid) {
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    assert.equal(settled, false, `${label} finished before observing a lock`);
    const { rows: [state] } = await admin.query(
      'SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [waiterPid],
    );
    if (state?.wait_event_type === 'Lock') return;
    await delay(50);
  }
  assert.fail(`${label} never waited on a PostgreSQL row lock`);
}
async function attest(revision, expectedDob, newDob, reason = null) {
  return actor.query(
    `SELECT public.attest_adult_dob($1,$2,$3,$4,0,$5,$6,'DOCUMENTO_EXHIBIDO',$7) AS result`,
    [ids.org, ids.patient, ids.identity, revision, expectedDob, newDob, reason],
  );
}

try {
  // This override is confined to the disposable hosted test database. It
  // mimics the authenticated JWT GUCs supplied by Supabase in production.
  await admin.query(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.m142_race_uid',true),'')::uuid $$`);
  await admin.query(`CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('test.m142_race_jwt',true),''),'{}')::jsonb $$`);
  await admin.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [ids.user, email]);
  await admin.query(`INSERT INTO public.profile(id,email,consent_pii_signed_at,consent_pii_text_version)
    VALUES($1,$2,now(),'v1')`, [ids.user, email]);
  await admin.query(`INSERT INTO public.organization(id,slug,nombre) VALUES($1,$2,'M142 synthetic race')`,
    [ids.org, slug]);
  await admin.query(`INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at)
    VALUES($1,$2,$3,'OWNER',true,now())`, [ids.member, ids.org, ids.user]);
  await admin.query(`INSERT INTO public.paciente_identidad
    (id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado)
    VALUES($1,$2,decode('01','hex'),decode('02','hex'),decode('03','hex'))`, [ids.identity, ids.org]);
  await admin.query(`INSERT INTO public.paciente(id,organization_id,identidad_id,profesional_principal_id)
    VALUES($1,$2,$3,$4)`, [ids.patient, ids.org, ids.identity, ids.member]);
  await admin.query(`INSERT INTO auth.mfa_factors(id,user_id,status) VALUES($1,$2,'verified')`,
    [ids.factor, ids.user]);
  await admin.query(`INSERT INTO auth.sessions(id,user_id,aal,factor_id) VALUES($1,$2,'aal2',$3)`,
    [ids.session, ids.user, ids.factor]);

  // Attestation commits first; direct DOB correction then invalidates it.
  await beginActor();
  const first = (await attest(0, null, '1990-01-01', 'ERROR_CARGA')).rows[0].result;
  assert.equal(first.status, 'attested');
  await opponent.query('BEGIN');
  const waitingDob = opponent.query(`UPDATE public.paciente_identidad SET fecha_nacimiento='1991-01-01'
    WHERE id=$1 RETURNING dob_revision`, [ids.identity]);
  await assertBlocked(waitingDob, 'DOB correction after attestation', opponentPid);
  await actor.query('COMMIT');
  assert.equal((await waitingDob).rows[0].dob_revision, '2');
  await opponent.query('COMMIT');
  const current = await admin.query(`SELECT count(*)::int AS n FROM folio_adult_private.attestation a
    JOIN public.paciente_identidad pi ON pi.id=a.identidad_id
    WHERE a.paciente_id=$1 AND a.dob_revision=pi.dob_revision`, [ids.patient]);
  assert.equal(current.rows[0].n, 0, 'Correction left a stale attestation current');

  // DOB correction commits first; an attestation holding old CAS inputs waits
  // and then receives the new revision without writing an event.
  await opponent.query('BEGIN');
  await opponent.query(`UPDATE public.paciente_identidad SET fecha_nacimiento='1992-01-01'
    WHERE id=$1`, [ids.identity]);
  await beginActor();
  const waitingAttest = attest(2, '1991-01-01', '1991-01-01');
  await assertBlocked(waitingAttest, 'Attestation after DOB correction', actorPid);
  await opponent.query('COMMIT');
  const conflict = (await waitingAttest).rows[0].result;
  assert.equal(conflict.status, 'conflict');
  assert.equal(conflict.dobRevision, 3);
  await actor.query('COMMIT');

  // Revocation owns the member row first. The RPC must wait and reject after
  // that row becomes deleted; a stale membership read cannot authorize it.
  await opponent.query('BEGIN');
  await opponent.query('UPDATE public.member SET deleted_at=now() WHERE id=$1', [ids.member]);
  await beginActor();
  const waitingRevocation = attest(3, '1992-01-01', '1992-01-01');
  await assertBlocked(waitingRevocation, 'Attestation after staff revocation', actorPid);
  await opponent.query('COMMIT');
  await assert.rejects(waitingRevocation, error => error.code === '42501');
  await actor.query('ROLLBACK');
  const events = await admin.query('SELECT count(*)::int AS n FROM folio_adult_private.attestation WHERE paciente_id=$1',
    [ids.patient]);
  assert.equal(events.rows[0].n, 1);
  process.stdout.write('M142 real races PASS: DOB after attest, DOB before attest, member revocation before attest\n');
} finally {
  for (const client of [actor, opponent, admin]) {
    try { await client.query('ROLLBACK'); } catch { /* connection may already be idle */ }
    await client.end();
  }
}
