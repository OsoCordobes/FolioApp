// Real races only on the disposable GitHub-hosted postgres:16 service.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

assert.equal(process.env.FOLIO_M144_SYNTHETIC, '1', 'Synthetic-only opt-in required');
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Hosted GitHub Actions required');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'GitHub-hosted runner required');
assert.equal(process.env.RUNNER_OS, 'Linux', 'Linux runner required');
assert.equal(process.platform, 'linux', 'Linux process required');
assert.ok(['localhost', '127.0.0.1'].includes(process.env.PGHOST), 'Loopback PostgreSQL required');
assert.equal(process.env.PGPORT, '5432', 'Hosted service port required');
assert.equal(process.env.PGDATABASE, 'folio_test', 'Disposable folio_test required');
assert.equal(process.env.PGUSER, 'postgres', 'Synthetic postgres user required');

const clients = [];
async function connect() {
  const client = new pg.Client({ connectionTimeoutMillis: 5000, statement_timeout: 15000, query_timeout: 16000 });
  await client.connect();
  clients.push(client);
  const { rows: [identity] } = await client.query('SELECT current_database() db,current_user actor');
  assert.equal(identity.db, 'folio_test');
  assert.equal(identity.actor, 'postgres');
  return client;
}
const admin = await connect();
const staff = await connect();
const patient = await connect();
const ids = Object.fromEntries(['user','org','member','identity','patient','service','turno','factor','authSession',
  'professionalUser','professionalMember','professionalFactor','professionalSession','professionalTurno','historicalTurno']
  .map(key => [key, randomUUID()]));
const hash = secret => createHash('sha256').update(Buffer.from(secret,'hex')).digest('hex');
const patientPid = (await patient.query('SELECT pg_backend_pid() pid')).rows[0].pid;
const staffPid = (await staff.query('SELECT pg_backend_pid() pid')).rows[0].pid;

async function beginStaff(user=ids.user,session=ids.authSession) {
  await staff.query('BEGIN');
  await staff.query("SELECT set_config('test.m144_race_uid',$1,true)",[user]);
  await staff.query("SELECT set_config('test.m144_race_jwt',$1,true)",
    [JSON.stringify({aal:'aal2',session_id:session})]);
  await staff.query("SELECT set_config('request.jwt.claim.role','authenticated',true)");
  await staff.query('SET LOCAL ROLE authenticated');
}
async function beginPatient() {
  await patient.query('BEGIN');
  await patient.query("SELECT set_config('request.jwt.claim.role','service_role',true)");
  await patient.query('SET LOCAL ROLE service_role');
}
async function blocked(promise,label,waiterPid=patientPid) {
  let finished=false;
  promise.then(()=>{finished=true;},()=>{finished=true;});
  for(let i=0;i<40;i++) {
    assert.equal(finished,false,`${label} finished before a lock was observed`);
    const {rows:[state]}=await admin.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[waiterPid]);
    if(state?.wait_event_type==='Lock') return;
    await delay(50);
  }
  assert.fail(`${label} never waited on PostgreSQL lock`);
}
const submit = (secret,operation) => patient.query(
  `SELECT public.patient_intake_submit($1,$2,'admin.v1',$3,decode(repeat('bb',64),'hex')) result`,
  [hash(secret),operation,'a'.repeat(64)]);

try {
  await admin.query(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('test.m144_race_uid',true),'')::uuid $$`);
  await admin.query(`CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
    $$ SELECT coalesce(nullif(current_setting('test.m144_race_jwt',true),''),'{}')::jsonb $$`);
  await admin.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[ids.user,`m144-${ids.user}@synthetic.invalid`]);
  await admin.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',
    [ids.professionalUser,`m144-${ids.professionalUser}@synthetic.invalid`]);
  await admin.query(`INSERT INTO public.profile(id,email,consent_pii_signed_at,consent_pii_text_version)
    VALUES($1,$2,now(),'v1')`,[ids.user,`m144-${ids.user}@synthetic.invalid`]);
  await admin.query(`INSERT INTO public.profile(id,email,consent_pii_signed_at,consent_pii_text_version)
    VALUES($1,$2,now(),'v1')`,
    [ids.professionalUser,`m144-${ids.professionalUser}@synthetic.invalid`]);
  await admin.query(`INSERT INTO public.organization(id,slug,nombre) VALUES($1,$2,'M144 synthetic race')`,
    [ids.org,`m144-race-${ids.org.slice(0,8)}`]);
  await admin.query(`INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at)
    VALUES($1,$2,$3,'OWNER',true,now())`,[ids.member,ids.org,ids.user]);
  await admin.query(`INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at)
    VALUES($1,$2,$3,'PROFESIONAL',true,now())`,
    [ids.professionalMember,ids.org,ids.professionalUser]);
  await admin.query(`INSERT INTO public.paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado)
    VALUES($1,$2,decode('01','hex'),decode('02','hex'),decode('03','hex'))`,[ids.identity,ids.org]);
  await admin.query(`INSERT INTO public.paciente(id,organization_id,identidad_id,profesional_principal_id)
    VALUES($1,$2,$3,$4)`,[ids.patient,ids.org,ids.identity,ids.member]);
  await admin.query(`INSERT INTO public.servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents)
    VALUES($1,$2,'M144 synthetic','CONSULTA_INICIAL',30,0)`,[ids.service,ids.org]);
  await admin.query(`INSERT INTO public.turno(id,organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents)
    VALUES($1,$2,$3,$4,$5,now()+interval '4 days',30,0)`,[ids.turno,ids.org,ids.patient,ids.service,ids.member]);
  await admin.query(`INSERT INTO public.turno(id,organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents,estado)
    VALUES($1,$2,$3,$4,$5,now()+interval '2 days',30,0,'EN_SALA')`,
    [ids.historicalTurno,ids.org,ids.patient,ids.service,ids.professionalMember]);
  await admin.query(`INSERT INTO public.turno(id,organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents)
    VALUES($1,$2,$3,$4,$5,now()+interval '7 days',30,0)`,
    [ids.professionalTurno,ids.org,ids.patient,ids.service,ids.professionalMember]);
  await admin.query('INSERT INTO auth.mfa_factors(id,user_id,status) VALUES($1,$2,\'verified\')',[ids.factor,ids.user]);
  await admin.query('INSERT INTO auth.mfa_factors(id,user_id,status) VALUES($1,$2,\'verified\')',
    [ids.professionalFactor,ids.professionalUser]);
  await admin.query(`INSERT INTO auth.sessions(id,user_id,aal,factor_id) VALUES($1,$2,'aal2',$3)`,
    [ids.authSession,ids.user,ids.factor]);
  await admin.query(`INSERT INTO auth.sessions(id,user_id,aal,factor_id) VALUES($1,$2,'aal2',$3)`,
    [ids.professionalSession,ids.professionalUser,ids.professionalFactor]);

  // Professional scope supplied only by a historical visit must be retained
  // until commit; cancelling that visit first removes the authorization.
  await admin.query('BEGIN');
  await admin.query("UPDATE public.turno SET estado='CANCELADO' WHERE id=$1",[ids.historicalTurno]);
  await beginStaff(ids.professionalUser,ids.professionalSession);
  const historicalWait=staff.query(`SELECT public.patient_intake_issue($1,$2,decode(repeat('aa',60),'hex'))`,
    [ids.org,ids.professionalTurno]);
  await blocked(historicalWait,'issue after historical scope cancellation',staffPid);
  await admin.query('COMMIT');
  await assert.rejects(historicalWait,error=>error.code==='42501');
  await staff.query('ROLLBACK');

  // Authentication rows are locked until the staff RPC commits. A factor
  // revocation that commits first must be observed after the wait.
  await admin.query('BEGIN');
  await admin.query("UPDATE auth.mfa_factors SET status='unverified' WHERE id=$1",[ids.factor]);
  await beginStaff();
  const factorWait=staff.query(`SELECT public.patient_intake_issue($1,$2,decode(repeat('aa',60),'hex'))`,
    [ids.org,ids.turno]);
  await blocked(factorWait,'issue after factor revocation',staffPid);
  await admin.query('COMMIT');
  await assert.rejects(factorWait,error=>error.code==='42501');
  await staff.query('ROLLBACK');
  await admin.query("UPDATE auth.mfa_factors SET status='verified' WHERE id=$1",[ids.factor]);

  await admin.query('BEGIN');
  await admin.query("UPDATE auth.sessions SET not_after=now()-interval '1 hour' WHERE id=$1",[ids.authSession]);
  await beginStaff();
  const sessionWait=staff.query(`SELECT public.patient_intake_issue($1,$2,decode(repeat('aa',60),'hex'))`,
    [ids.org,ids.turno]);
  await blocked(sessionWait,'issue after Auth session revocation',staffPid);
  await admin.query('COMMIT');
  await assert.rejects(sessionWait,error=>error.code==='42501');
  await staff.query('ROLLBACK');
  await admin.query('UPDATE auth.sessions SET not_after=NULL WHERE id=$1',[ids.authSession]);

  await admin.query('BEGIN');
  await admin.query('UPDATE public.member SET deleted_at=now() WHERE id=$1',[ids.member]);
  await beginStaff();
  const memberWait=staff.query(`SELECT public.patient_intake_issue($1,$2,decode(repeat('aa',60),'hex'))`,
    [ids.org,ids.turno]);
  await blocked(memberWait,'issue after membership revocation',staffPid);
  await admin.query('COMMIT');
  await assert.rejects(memberWait,error=>error.code==='42501');
  await staff.query('ROLLBACK');
  await admin.query('UPDATE public.member SET deleted_at=NULL WHERE id=$1',[ids.member]);

  async function issueAndExchange() {
    await beginStaff();
    const issued=(await staff.query(`SELECT public.patient_intake_issue($1,$2,decode(repeat('aa',60),'hex')) result`,
      [ids.org,ids.turno])).rows[0].result;
    await staff.query('COMMIT');
    await beginPatient();
    const exchanged=(await patient.query('SELECT public.patient_intake_exchange($1) result',
      [hash(issued.token)])).rows[0].result;
    await patient.query('COMMIT');
    return exchanged.session;
  }

  // Revoke commits while submit is waiting on the same visit/invitation.
  const oldSession=await issueAndExchange();
  await beginStaff();
  const revoked=(await staff.query('SELECT public.patient_intake_revoke($1,$2) result',
    [ids.org,ids.turno])).rows[0].result;
  assert.equal(revoked.revoked,true);
  await beginPatient();
  const afterRevoke=submit(oldSession,randomUUID());
  await blocked(afterRevoke,'submit after revoke');
  await staff.query('COMMIT');
  await assert.rejects(afterRevoke,error=>error.code==='42501');
  await patient.query('ROLLBACK');

  // M119's actual reschedule writes the original as REAGENDADO. The waiting
  // submit must reject, and the replacement does not inherit an invitation.
  const newSession=await issueAndExchange();
  await beginStaff();
  const moved=(await staff.query(`SELECT public.reschedule_turno_atomic($1,$2,$3,now()+interval '6 days',NULL) result`,
    [ids.org,randomUUID(),ids.turno])).rows[0].result;
  assert.ok(moved.nuevoTurnoId);
  await beginPatient();
  const afterMove=submit(newSession,randomUUID());
  await blocked(afterMove,'submit after real reschedule');
  await staff.query('COMMIT');
  await assert.rejects(afterMove,error=>error.code==='55000');
  await patient.query('ROLLBACK');
  const persisted=await admin.query(`SELECT count(*)::int n FROM folio_intake_private.submission s
    JOIN folio_intake_private.invitation i ON i.id=s.invitation_id WHERE i.turno_id=$1`,[ids.turno]);
  assert.equal(persisted.rows[0].n,0);
  const replacement=await admin.query(`SELECT count(*)::int n FROM folio_intake_private.invitation WHERE turno_id=$1`,
    [moved.nuevoTurnoId]);
  assert.equal(replacement.rows[0].n,0);
  process.stdout.write('M144 real races PASS: revoked session and M119 reschedule both reject waiting submission\n');
} finally {
  for(const client of clients) {
    try { await client.query('ROLLBACK'); } catch { /* idle or failed transaction */ }
    await client.end();
  }
}
