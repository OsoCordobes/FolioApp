// Real M148 races only on the disposable GitHub-hosted PostgreSQL 16 service.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

assert.equal(process.env.FOLIO_M148_SYNTHETIC,'1','Synthetic-only opt-in required');
assert.equal(process.env.GITHUB_ACTIONS,'true','Hosted GitHub Actions required');
assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted','GitHub-hosted runner required');
assert.equal(process.env.RUNNER_OS,'Linux','Linux runner required');
assert.equal(process.platform,'linux','Linux process required');
assert.ok(['localhost','127.0.0.1'].includes(process.env.PGHOST),'Loopback PostgreSQL required');
assert.equal(process.env.PGPORT,'5432','Hosted service port required');
assert.equal(process.env.PGDATABASE,'folio_test','Disposable folio_test required');
assert.equal(process.env.PGUSER,'postgres','Synthetic postgres user required');

const clients=[];
async function connect(){
 const client=new pg.Client({connectionTimeoutMillis:5000,statement_timeout:15000,query_timeout:16000});
 await client.connect();clients.push(client);
 const {rows:[identity]}=await client.query('SELECT current_database() db,current_user actor');
 assert.equal(identity.db,'folio_test');assert.equal(identity.actor,'postgres');
 return client;
}
const admin=await connect(),staff1=await connect(),staff2=await connect();
const service=await connect(),barrier=await connect(),winner=await connect();
const ids=Object.fromEntries([
 'user1','user2','org','member1','member2','identity','identityB','patient','patientB','service',
 'turno1','turno2','turno3','factor1','factor2','session1','session2',
 'invitation1','invitation2','invitation3','intakeSession1','intakeSession2','intakeSession3',
 'receipt1','receipt2','receipt3',
].map(key=>[key,randomUUID()]));
const pids=new Map();
for(const [name,client] of [['staff1',staff1],['staff2',staff2]]){
 pids.set(name,(await client.query('SELECT pg_backend_pid() pid')).rows[0].pid);
}
const encrypted=byte=>Buffer.alloc(32,byte).toString('base64');
const fingerprint=n=>String(n).repeat(64);

async function configureStaff(client,user=ids.user1,session=ids.session1){
 await client.query("SELECT set_config('test.m148_race_uid',$1,false)",[user]);
 await client.query("SELECT set_config('test.m148_race_jwt',$1,false)",
  [JSON.stringify({aal:'aal2',session_id:session})]);
 await client.query("SELECT set_config('request.jwt.claim.role','authenticated',false)");
 await client.query('SET ROLE authenticated');
}
async function configureService(){
 await service.query("SELECT set_config('request.jwt.claim.role','service_role',false)");
 await service.query('SET ROLE service_role');
}
async function blocked(promise,pid,label){
 let finished=false;promise.then(()=>{finished=true;},()=>{finished=true;});
 for(let i=0;i<60;i++){
  assert.equal(finished,false,`${label} finished before a PostgreSQL lock was observed`);
  const {rows:[activity]}=await admin.query(
   'SELECT wait_event_type,pg_blocking_pids(pid) blockers FROM pg_stat_activity WHERE pid=$1',[pid]);
  if(activity?.wait_event_type==='Lock'&&activity.blockers?.length>0)return;
  await delay(50);
 }
 assert.fail(`${label} never waited on the intended PostgreSQL barrier`);
}
async function snapshot(client,turno,receipt){
 return (await client.query('SELECT public.patient_intake_incorporation_snapshot($1,$2,$3) result',
  [ids.org,turno,receipt])).rows[0].result;
}
async function prepare(client,{turno,receipt,keys,operation,expectedIdentity=ids.identity,state}){
 const current=state??await snapshot(client,turno,receipt);
 return (await client.query(`SELECT public.patient_intake_incorporation_prepare(
   $1,$2,$3,$4::text[],$5,$6,$7,$8) result`,
  [ids.org,turno,receipt,keys,expectedIdentity,current.adminRevision,current.contextHash,operation])).rows[0].result;
}
async function materialize(prepared,patch,sourceFingerprint){
 return (await service.query(
  'SELECT public.patient_intake_incorporation_materialize($1,$2::jsonb,$3) result',
  [prepared.preparationId,JSON.stringify(patch),sourceFingerprint])).rows[0].result;
}
async function apply(client,prepared,turno,operation){
 return (await client.query('SELECT public.patient_intake_incorporation_apply($1,$2,$3,$4) result',
  [ids.org,turno,prepared.preparationId,operation])).rows[0].result;
}
async function cancel(client,turno,operation){
 return (await client.query('SELECT public.patient_intake_incorporation_cancel($1,$2,$3) result',
  [ids.org,turno,operation])).rows[0].result;
}
function assertNoSource(result,label){
 assert.equal(Object.hasOwn(result,'sourceCipherBase64'),false,`${label} exposed sourceCipherBase64`);
 assert.equal(Object.hasOwn(result,'current'),false,`${label} exposed current`);
}
async function assertUnconsumed(operation,expectedRevision,label){
 const {rows:[stored]}=await admin.query(`SELECT io.status,pi.admin_revision,
  (SELECT count(*)::int FROM folio_intake_private.incorporation_provenance ip
    WHERE ip.operation_id=io.operation_id) provenance
  FROM folio_intake_private.incorporation_operation io
  JOIN public.paciente_identidad pi ON pi.id=$2 WHERE io.operation_id=$1`,
 [operation,ids.identity]);
 assert.equal(stored.status,'materialized',`${label} consumed the operation`);
 assert.equal(Number(stored.admin_revision),expectedRevision,`${label} changed identity`);
 assert.equal(stored.provenance,0,`${label} created provenance`);
}

try{
 await admin.query(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('test.m148_race_uid',true),'')::uuid $$`);
 await admin.query(`CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
  $$ SELECT coalesce(nullif(current_setting('test.m148_race_jwt',true),''),'{}')::jsonb $$`);
 for(const [user,member,role] of [[ids.user1,ids.member1,'OWNER'],[ids.user2,ids.member2,'DIRECTOR']]){
  await admin.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[user,`m148-${user}@synthetic.invalid`]);
  await admin.query(`INSERT INTO public.profile(id,email,consent_pii_signed_at,consent_pii_text_version)
   VALUES($1,$2,now(),'v1')`,[user,`m148-${user}@synthetic.invalid`]);
  if(role==='OWNER')await admin.query('INSERT INTO public.organization(id,slug,nombre) VALUES($1,$2,$3)',
   [ids.org,`m148-race-${ids.org.slice(0,8)}`,'M148 synthetic race']);
  await admin.query(`INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at)
   VALUES($1,$2,$3,$4,true,now())`,[member,ids.org,user,role]);
 }
 await admin.query(`INSERT INTO public.paciente_identidad
  (id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado)
  VALUES($1,$3,decode('01','hex'),decode('02','hex'),decode('03','hex')),
   ($2,$3,decode('04','hex'),decode('05','hex'),decode('06','hex'))`,
  [ids.identity,ids.identityB,ids.org]);
 await admin.query(`INSERT INTO public.paciente(id,organization_id,identidad_id,profesional_principal_id)
  VALUES($1,$3,$4,$5),($2,$3,$6,$5)`,
  [ids.patient,ids.patientB,ids.org,ids.identity,ids.member1,ids.identityB]);
 await admin.query(`INSERT INTO public.servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents)
  VALUES($1,$2,'M148 synthetic','CONSULTA_INICIAL',30,0)`,[ids.service,ids.org]);
 await admin.query(`INSERT INTO public.turno
  (id,organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents)
  VALUES($1,$4,$5,$6,$7,now()+interval '3 days',30,0),
   ($2,$4,$5,$6,$8,now()+interval '4 days',30,0),
   ($3,$4,$5,$6,$7,now()+interval '5 days',30,0)`,
  [ids.turno1,ids.turno2,ids.turno3,ids.org,ids.patient,ids.service,ids.member1,ids.member2]);
 for(const [user,factor,session] of [[ids.user1,ids.factor1,ids.session1],[ids.user2,ids.factor2,ids.session2]]){
  await admin.query("INSERT INTO auth.mfa_factors(id,user_id,status) VALUES($1,$2,'verified')",[factor,user]);
  await admin.query("INSERT INTO auth.sessions(id,user_id,aal,factor_id) VALUES($1,$2,'aal2',$3)",
   [session,user,factor]);
 }
 await admin.query(`INSERT INTO folio_intake_private.invitation
  (id,organization_id,turno_id,paciente_id,identidad_id,identity_link_revision,
   organization_intake_revision,paciente_intake_revision,identidad_intake_revision,
   profesional_id,issued_by_member_id,turno_inicio,turno_intake_revision,
   token_hash,fingerprint_key_cifrado,expires_at)
  SELECT v.invitation_id,o.id,t.id,p.id,pi.id,p.identity_link_revision,
   o.intake_revision,p.intake_revision,pi.intake_revision,t.profesional_id,$1,
   t.inicio,t.intake_revision,v.token_hash,decode(repeat('aa',60),'hex'),clock_timestamp()+interval '1 hour'
  FROM (VALUES($2::uuid,$3::uuid,repeat('1',64)),($4::uuid,$5::uuid,repeat('2',64)),
   ($6::uuid,$7::uuid,repeat('3',64)))
   v(invitation_id,turno_id,token_hash)
  JOIN public.turno t ON t.id=v.turno_id JOIN public.paciente p ON p.id=t.paciente_id
  JOIN public.paciente_identidad pi ON pi.id=p.identidad_id
  JOIN public.organization o ON o.id=t.organization_id`,
  [ids.member1,ids.invitation1,ids.turno1,ids.invitation2,ids.turno2,ids.invitation3,ids.turno3]);
 await admin.query(`INSERT INTO folio_intake_private.session(id,invitation_id,token_hash,expires_at)
  VALUES($1,$2,repeat('a',64),clock_timestamp()+interval '30 minutes'),
   ($3,$4,repeat('b',64),clock_timestamp()+interval '30 minutes'),
   ($5,$6,repeat('c',64),clock_timestamp()+interval '30 minutes')`,
  [ids.intakeSession1,ids.invitation1,ids.intakeSession2,ids.invitation2,
   ids.intakeSession3,ids.invitation3]);
 await admin.query(`INSERT INTO folio_intake_private.submission
  (id,invitation_id,session_id,operation_id,questionnaire_version,content_fingerprint,answers_cifrado)
  VALUES($1,$2,$3,$4,'admin.v1',$5,decode(repeat('aa',64),'hex')),
   ($6,$7,$8,$9,'admin.v1',$10,decode(repeat('bb',64),'hex')),
   ($11,$12,$13,$14,'admin.v1',$15,decode(repeat('cc',64),'hex'))`,
  [ids.receipt1,ids.invitation1,ids.intakeSession1,randomUUID(),fingerprint('a'),
   ids.receipt2,ids.invitation2,ids.intakeSession2,randomUUID(),fingerprint('b'),
   ids.receipt3,ids.invitation3,ids.intakeSession3,randomUUID(),fingerprint('c')]);
 await configureStaff(staff1);await configureStaff(staff2);await configureService();

 // A committed response may be lost. The same operation then converges on one
 // applied receipt, one revision increment and one provenance event.
 const doubleOperation=randomUUID();
 const doublePrepared=await prepare(staff1,{turno:ids.turno1,receipt:ids.receipt1,
  keys:['email'],operation:doubleOperation});
 assert.equal(doublePrepared.status,'pending');
 await materialize(doublePrepared,{email_cifrado:encrypted(0x11),email_hash:fingerprint('1')},fingerprint('a'));
 const doubleBefore=Number((await admin.query(
  'SELECT admin_revision FROM public.paciente_identidad WHERE id=$1',[ids.identity])).rows[0].admin_revision);
 await staff1.query('BEGIN');
 await apply(staff1,doublePrepared,ids.turno1,doubleOperation); // deliberately discard the first response
 await staff2.query('BEGIN');
 const replayApply=apply(staff2,doublePrepared,ids.turno1,doubleOperation);
 await blocked(replayApply,pids.get('staff2'),'duplicate apply');
 await staff1.query('COMMIT');
 const replayApplied=await replayApply;await staff2.query('COMMIT');
 assert.equal(replayApplied.status,'applied');assertNoSource(replayApplied,'duplicate apply');
 const reconciled=(await staff1.query(
  'SELECT public.patient_intake_incorporation_status($1,$2,$3) result',
  [ids.org,ids.turno1,doubleOperation])).rows[0].result;
 assert.equal(reconciled.status,'applied');assertNoSource(reconciled,'lost-response status');
 const {rows:[doubleStored]}=await admin.query(`SELECT pi.admin_revision,
  (SELECT count(*)::int FROM folio_intake_private.incorporation_provenance WHERE operation_id=$2) provenance
  FROM public.paciente_identidad pi WHERE pi.id=$1`,[ids.identity,doubleOperation]);
 assert.equal(Number(doubleStored.admin_revision),doubleBefore+1);assert.equal(doubleStored.provenance,1);

 // Apply wins while cancel is waiting. Cancel must return the same terminal
 // result and cannot erase provenance or apply twice.
 const cancelOperation=randomUUID();
 const cancelPrepared=await prepare(staff1,{turno:ids.turno1,receipt:ids.receipt1,
  keys:['telefono'],operation:cancelOperation});
 await materialize(cancelPrepared,{telefono_cifrado:encrypted(0x22),telefono_hash:fingerprint('2')},fingerprint('a'));
 await staff1.query('BEGIN');
 const appliedBeforeCancel=await apply(staff1,cancelPrepared,ids.turno1,cancelOperation);
 await staff2.query('BEGIN');
 const waitingCancel=cancel(staff2,ids.turno1,cancelOperation);
 await blocked(waitingCancel,pids.get('staff2'),'cancel after concurrent apply');
 await staff1.query('COMMIT');
 const cancelResult=await waitingCancel;await staff2.query('COMMIT');
 assert.equal(appliedBeforeCancel.status,'applied');assert.equal(cancelResult.status,'applied');
 assertNoSource(cancelResult,'apply/cancel terminal');

 // The reverse order is terminal too: cancel commits first and a waiting apply
 // observes cancelled without updating identity or creating provenance.
 const cancelWinsOperation=randomUUID();
 const cancelWinsPrepared=await prepare(staff1,{turno:ids.turno1,receipt:ids.receipt1,
  keys:['apellido'],operation:cancelWinsOperation});
 await materialize(cancelWinsPrepared,
  {apellido_cifrado:encrypted(0x23),nombre_hash:fingerprint('5')},fingerprint('a'));
 await staff1.query('BEGIN');
 const cancelledBeforeApply=await cancel(staff1,ids.turno1,cancelWinsOperation);
 await staff2.query('BEGIN');
 const waitingApply=apply(staff2,cancelWinsPrepared,ids.turno1,cancelWinsOperation);
 await blocked(waitingApply,pids.get('staff2'),'apply after concurrent cancel');
 await staff1.query('COMMIT');
 const cancelledApply=await waitingApply;await staff2.query('COMMIT');
 assert.equal(cancelledBeforeApply.status,'cancelled');assert.equal(cancelledApply.status,'cancelled');
 assertNoSource(cancelledApply,'cancel/apply terminal');
 const {rows:[cancelWinsStored]}=await admin.query(
  'SELECT count(*)::int provenance FROM folio_intake_private.incorporation_provenance WHERE operation_id=$1',
  [cancelWinsOperation]);
 assert.equal(cancelWinsStored.provenance,0);

 // A tombstone committed by cancel wins over a prepare already waiting on the
 // same operation scope; the late prepare receives no source or current value.
 const tombstoneOperation=randomUUID();
 const tombstoneState=await snapshot(staff1,ids.turno1,ids.receipt1);
 await staff1.query('BEGIN');
 const tombstone=await cancel(staff1,ids.turno1,tombstoneOperation);
 await staff2.query('BEGIN');
 const latePrepare=prepare(staff2,{turno:ids.turno1,receipt:ids.receipt1,
  keys:['cobertura.nombre'],operation:tombstoneOperation,state:tombstoneState});
 await blocked(latePrepare,pids.get('staff2'),'prepare behind cancel tombstone');
 await staff1.query('COMMIT');
 const lateResult=await latePrepare;await staff2.query('COMMIT');
 assert.equal(tombstone.status,'cancelled');assert.equal(lateResult.status,'cancelled');
 assertNoSource(lateResult,'late prepare after cancel');

 // Session revocation commits while apply waits on the Auth row. The write is
 // rejected before patient or operation state can become terminal.
 const revokedOperation=randomUUID();
 const revokedPrepared=await prepare(staff1,{turno:ids.turno1,receipt:ids.receipt1,
  keys:['cobertura.nombre'],operation:revokedOperation});
 await materialize(revokedPrepared,{cobertura_nombre:'M148 synthetic coverage'},fingerprint('a'));
 const revokedRevision=Number((await admin.query(
  'SELECT admin_revision FROM public.paciente_identidad WHERE id=$1',[ids.identity])).rows[0].admin_revision);
 await admin.query('BEGIN');
 await admin.query("UPDATE auth.sessions SET not_after=now()-interval '1 hour' WHERE id=$1",[ids.session1]);
 const revokedApply=apply(staff1,revokedPrepared,ids.turno1,revokedOperation);
 await blocked(revokedApply,pids.get('staff1'),'apply after session revocation');
 await admin.query('COMMIT');
 await assert.rejects(revokedApply,error=>error.code==='42501');
 await admin.query('UPDATE auth.sessions SET not_after=NULL WHERE id=$1',[ids.session1]);
 await assertUnconsumed(revokedOperation,revokedRevision,'session revocation');

 // Factor revocation commits while apply is waiting on the factor row.
 const factorOperation=randomUUID();
 const factorPrepared=await prepare(staff1,{turno:ids.turno1,receipt:ids.receipt1,
  keys:['email'],operation:factorOperation});
 await materialize(factorPrepared,
  {email_cifrado:encrypted(0x41),email_hash:fingerprint('7')},fingerprint('a'));
 const factorRevision=Number((await admin.query(
  'SELECT admin_revision FROM public.paciente_identidad WHERE id=$1',[ids.identity])).rows[0].admin_revision);
 await admin.query('BEGIN');
 await admin.query("UPDATE auth.mfa_factors SET status='unverified' WHERE id=$1",[ids.factor1]);
 const factorApply=apply(staff1,factorPrepared,ids.turno1,factorOperation);
 await blocked(factorApply,pids.get('staff1'),'apply after factor revocation');
 await admin.query('COMMIT');
 await assert.rejects(factorApply,error=>error.code==='42501');
 await admin.query("UPDATE auth.mfa_factors SET status='verified' WHERE id=$1",[ids.factor1]);
 await assertUnconsumed(factorOperation,factorRevision,'factor revocation');

 // Membership revocation commits while apply is waiting on the actor row.
 const memberOperation=randomUUID();
 const memberPrepared=await prepare(staff1,{turno:ids.turno1,receipt:ids.receipt1,
  keys:['telefono'],operation:memberOperation});
 await materialize(memberPrepared,
  {telefono_cifrado:encrypted(0x42),telefono_hash:fingerprint('8')},fingerprint('a'));
 const memberRevision=Number((await admin.query(
  'SELECT admin_revision FROM public.paciente_identidad WHERE id=$1',[ids.identity])).rows[0].admin_revision);
 await admin.query('BEGIN');
 await admin.query('UPDATE public.member SET deleted_at=clock_timestamp() WHERE id=$1',[ids.member1]);
 const memberApply=apply(staff1,memberPrepared,ids.turno1,memberOperation);
 await blocked(memberApply,pids.get('staff1'),'apply after member revocation');
 await admin.query('COMMIT');
 await assert.rejects(memberApply,error=>error.code==='42501');
 await admin.query('UPDATE public.member SET deleted_at=NULL WHERE id=$1',[ids.member1]);
 await assertUnconsumed(memberOperation,memberRevision,'member revocation');

 // A visit revocation commits while apply waits on the locked visit row. The
 // dedicated third visit avoids weakening later race fixtures by restoring it.
 const visitOperation=randomUUID();
 const visitPrepared=await prepare(staff1,{turno:ids.turno3,receipt:ids.receipt3,
  keys:['cobertura.nombre'],operation:visitOperation});
 await materialize(visitPrepared,{cobertura_nombre:'M148 revoked visit'},fingerprint('c'));
 const visitRevision=Number((await admin.query(
  'SELECT admin_revision FROM public.paciente_identidad WHERE id=$1',[ids.identity])).rows[0].admin_revision);
 await admin.query('BEGIN');
 await admin.query('UPDATE public.turno SET deleted_at=clock_timestamp() WHERE id=$1',[ids.turno3]);
 const visitApply=apply(staff1,visitPrepared,ids.turno3,visitOperation);
 await blocked(visitApply,pids.get('staff1'),'apply after visit revocation');
 await admin.query('COMMIT');
 await assert.rejects(visitApply,error=>error.code==='55000');
 await assertUnconsumed(visitOperation,visitRevision,'visit revocation');

 // Different professionals give the two visits distinct advisory keys. Both
 // operations target the same patient and identity, so one waits on that row;
 // it then closes as conflict instead of deadlocking or overwriting the winner.
 const patientOperation1=randomUUID(),patientOperation2=randomUUID();
 const patientPrepared1=await prepare(staff1,{turno:ids.turno1,receipt:ids.receipt1,
  keys:['nombre'],operation:patientOperation1});
 const patientPrepared2=await prepare(staff2,{turno:ids.turno2,receipt:ids.receipt2,
  keys:['apellido'],operation:patientOperation2});
 await materialize(patientPrepared1,
  {nombre_cifrado:encrypted(0x31),nombre_hash:fingerprint('3')},fingerprint('a'));
 await materialize(patientPrepared2,
  {apellido_cifrado:encrypted(0x32),nombre_hash:fingerprint('4')},fingerprint('b'));
 await staff1.query('BEGIN');
 const patientWinner=await apply(staff1,patientPrepared1,ids.turno1,patientOperation1);
 await staff2.query('BEGIN');
 const patientWaiter=apply(staff2,patientPrepared2,ids.turno2,patientOperation2);
 await blocked(patientWaiter,pids.get('staff2'),'second visit for the same patient');
 await staff1.query('COMMIT');
 const patientLoser=await patientWaiter;await staff2.query('COMMIT');
 assert.equal(patientWinner.status,'applied');assert.equal(patientLoser.status,'conflict');
 assertNoSource(patientLoser,'same-patient CAS loser');

 // Defense in depth: normal prepare paths hold the booking advisory lock and
 // SHARE locks on the visit context, so a real reassignment cannot commit in
 // this interval. This synthetic, gated trigger pauses only the losing INSERT
 // to exercise the post-ON-CONFLICT readback against a divergent rival row.
 const defensiveOperation=randomUUID(),pauseKey=148202609;
 await admin.query(`CREATE FUNCTION folio_intake_private.m148_test_pause_insert() RETURNS trigger
  LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
   IF current_setting('test.m148_pause_operation',true)=NEW.operation_id::text THEN
    PERFORM pg_advisory_xact_lock(${pauseKey});
   END IF;
   RETURN NEW;
  END $$`);
 await admin.query(`CREATE TRIGGER m148_test_pause_insert BEFORE INSERT
  ON folio_intake_private.incorporation_operation FOR EACH ROW
  EXECUTE FUNCTION folio_intake_private.m148_test_pause_insert()`);
 await barrier.query('SELECT pg_advisory_lock($1)',[pauseKey]);
 const defensiveState=await snapshot(staff1,ids.turno1,ids.receipt1);
 await staff1.query("SELECT set_config('test.m148_pause_operation',$1,false)",[defensiveOperation]);
 const defensivePrepare=prepare(staff1,{turno:ids.turno1,receipt:ids.receipt1,
  keys:['nombre'],operation:defensiveOperation,expectedIdentity:ids.identityB,state:defensiveState});
 await blocked(defensivePrepare,pids.get('staff1'),'post-ON-CONFLICT defensive readback');
 await winner.query(`INSERT INTO folio_intake_private.incorporation_operation
  (organization_id,operation_id,preparation_id,actor_member_id,actor_session_id,turno_id,
   paciente_id,identidad_id,receipt_id,questionnaire_version,selected_keys,
   expected_admin_revision,expected_context_hash,source_fingerprint,source_cipher,snapshot,status,expires_at)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'admin.v1',ARRAY['nombre'],$10,$11,$12,
   decode(repeat('cc',64),'hex'),'{}'::jsonb,'pending',clock_timestamp()+interval '15 minutes')`,
  [ids.org,defensiveOperation,randomUUID(),ids.member1,ids.session1,ids.turno1,
   ids.patientB,ids.identityB,ids.receipt1,defensiveState.adminRevision,
   defensiveState.contextHash,fingerprint('a')]);
 await barrier.query('SELECT pg_advisory_unlock($1)',[pauseKey]);
 const defensiveResult=await defensivePrepare;
 assert.equal(defensiveResult.status,'conflict');assert.equal(defensiveResult.reason,'context_changed');
 assertNoSource(defensiveResult,'post-ON-CONFLICT conflict');
 await staff1.query("SELECT set_config('test.m148_pause_operation','',false)");
 const defensiveReplay=await prepare(staff1,{turno:ids.turno1,receipt:ids.receipt1,
  keys:['nombre'],operation:defensiveOperation,expectedIdentity:ids.identityB,state:defensiveState});
 assert.equal(defensiveReplay.status,'conflict');assertNoSource(defensiveReplay,'durable defensive replay');
 const {rows:[defensiveStored]}=await admin.query(`SELECT status,terminal_reason,
  source_cipher=decode(repeat('cc',64),'hex') source_preserved
  FROM folio_intake_private.incorporation_operation WHERE operation_id=$1`,[defensiveOperation]);
 assert.deepEqual([defensiveStored.status,defensiveStored.terminal_reason,defensiveStored.source_preserved],
  ['conflict','context_changed',true]);
 await admin.query('DROP TRIGGER m148_test_pause_insert ON folio_intake_private.incorporation_operation');
 await admin.query('DROP FUNCTION folio_intake_private.m148_test_pause_insert()');

 process.stdout.write('M148 real races PASS: replay, apply/cancel, tombstone, session/factor/member/visit revocation, same-patient CAS and guarded conflict readback\n');
}finally{
 try{await barrier.query('SELECT pg_advisory_unlock_all()');}catch{/* cleanup only */}
 for(const client of clients){
  try{await client.query('ROLLBACK');}catch{/* idle or failed transaction */}
  try{await client.query('SELECT pg_advisory_unlock_all()');}catch{/* cleanup only */}
 }
 try{await admin.query('DROP TRIGGER IF EXISTS m148_test_pause_insert ON folio_intake_private.incorporation_operation');}
 catch{/* cleanup only */}
 try{await admin.query('DROP FUNCTION IF EXISTS folio_intake_private.m148_test_pause_insert()');}
 catch{/* cleanup only */}
 for(const client of clients)await client.end();
}
