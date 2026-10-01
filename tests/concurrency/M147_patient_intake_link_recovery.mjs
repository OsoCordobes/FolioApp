// Real row/authorization races only on the disposable GitHub-hosted postgres:16 service.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

assert.equal(process.env.FOLIO_M147_SYNTHETIC,'1','Synthetic-only opt-in required');
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
const ids=Object.fromEntries(['user1','user2','org','member1','member2','identity','identityB',
 'patient','service','turno','factor1','factor2','session1','session2'].map(key=>[key,randomUUID()]));
const token=()=>randomBytes(32).toString('hex');
const hash=secret=>createHash('sha256').update(Buffer.from(secret,'hex')).digest('hex');
const staff1Pid=(await staff1.query('SELECT pg_backend_pid() pid')).rows[0].pid;
async function configureStaff(client,user,session){
 await client.query("SELECT set_config('test.m147_race_uid',$1,false)",[user]);
 await client.query("SELECT set_config('test.m147_race_jwt',$1,false)",
  [JSON.stringify({aal:'aal2',session_id:session})]);
 await client.query("SELECT set_config('request.jwt.claim.role','authenticated',false)");
 await client.query('SET ROLE authenticated');
}
async function state(client){
 return (await client.query('SELECT public.patient_intake_link_state($1,$2) result',[ids.org,ids.turno])).rows[0].result;
}
async function issue(client,expected,operation,raw){
 return (await client.query(`SELECT public.patient_intake_issue_v2($1,$2,$3,$4,$5,$6,decode(repeat('aa',60),'hex')) result`,
  [ids.org,ids.turno,operation,expected.generation,expected.contextHash,hash(raw)])).rows[0].result;
}
async function revoke(client,expected,operation){
 return (await client.query('SELECT public.patient_intake_revoke_v2($1,$2,$3,$4,$5) result',
  [ids.org,ids.turno,operation,expected.generation,expected.contextHash])).rows[0].result;
}
async function blocked(promise,label){
 let finished=false;promise.then(()=>{finished=true;},()=>{finished=true;});
 for(let i=0;i<40;i++){
  assert.equal(finished,false,`${label} finished before lock observed`);
  const {rows:[activity]}=await admin.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[staff1Pid]);
  if(activity?.wait_event_type==='Lock')return;
  await delay(50);
 }
 assert.fail(`${label} never waited on PostgreSQL lock`);
}

try{
 await admin.query(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('test.m147_race_uid',true),'')::uuid $$`);
 await admin.query(`CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
  $$ SELECT coalesce(nullif(current_setting('test.m147_race_jwt',true),''),'{}')::jsonb $$`);
 for(const [user,member,role] of [[ids.user1,ids.member1,'OWNER'],[ids.user2,ids.member2,'DIRECTOR']]){
  await admin.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[user,`m147-${user}@synthetic.invalid`]);
  await admin.query(`INSERT INTO public.profile(id,email,consent_pii_signed_at,consent_pii_text_version)
   VALUES($1,$2,now(),'v1')`,[user,`m147-${user}@synthetic.invalid`]);
  if(role==='OWNER')await admin.query('INSERT INTO public.organization(id,slug,nombre) VALUES($1,$2,$3)',
   [ids.org,`m147-race-${ids.org.slice(0,8)}`,'M147 synthetic race']);
  await admin.query(`INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at)
   VALUES($1,$2,$3,$4,true,now())`,[member,ids.org,user,role]);
 }
 await admin.query(`INSERT INTO public.paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado)
  VALUES($1,$3,decode('01','hex'),decode('02','hex'),decode('03','hex')),
   ($2,$3,decode('04','hex'),decode('05','hex'),decode('06','hex'))`,[ids.identity,ids.identityB,ids.org]);
 await admin.query(`INSERT INTO public.paciente(id,organization_id,identidad_id,profesional_principal_id)
  VALUES($1,$2,$3,$4)`,[ids.patient,ids.org,ids.identity,ids.member1]);
 await admin.query(`INSERT INTO public.servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents)
  VALUES($1,$2,'M147 synthetic','CONSULTA_INICIAL',30,0)`,[ids.service,ids.org]);
 await admin.query(`INSERT INTO public.turno(id,organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents)
  VALUES($1,$2,$3,$4,$5,now()+interval '3 days',30,0)`,[ids.turno,ids.org,ids.patient,ids.service,ids.member1]);
 for(const [user,factor,session] of [[ids.user1,ids.factor1,ids.session1],[ids.user2,ids.factor2,ids.session2]]){
  await admin.query("INSERT INTO auth.mfa_factors(id,user_id,status) VALUES($1,$2,'verified')",[factor,user]);
  await admin.query("INSERT INTO auth.sessions(id,user_id,aal,factor_id) VALUES($1,$2,'aal2',$3)",[session,user,factor]);
 }
 await configureStaff(staff1,ids.user1,ids.session1);
 await configureStaff(staff2,ids.user2,ids.session2);

 // The old HTTP issue waits on actor 1's Auth row. Actor 2 fences an empty
 // state and issues a new link before the old request is allowed to proceed.
 const oldState=await state(staff1);assert.equal(oldState.generation,'0');
 await admin.query('BEGIN');
 await admin.query('UPDATE auth.sessions SET not_after=NULL WHERE id=$1',[ids.session1]);
 const oldIssue=issue(staff1,oldState,randomUUID(),token());
 await blocked(oldIssue,'old issue before empty revoke');
 const emptyFence=await revoke(staff2,await state(staff2),randomUUID());
 assert.deepEqual([emptyFence.status,emptyFence.generation,emptyFence.revoked],['revoked','1',false]);
 const newer=await issue(staff2,await state(staff2),randomUUID(),token());
 assert.equal(newer.status,'issued');assert.equal(newer.generation,'2');
 await admin.query('COMMIT');
 await assert.rejects(oldIssue,error=>error.code==='40001');
 assert.equal((await state(staff2)).invitationId,newer.invitationId);

 // A revoke requested against generation 2 cannot later revoke a replacement.
 const oldRevokeState=await state(staff1);
 await admin.query('BEGIN');
 await admin.query('UPDATE auth.sessions SET not_after=NULL WHERE id=$1',[ids.session1]);
 const oldRevoke=revoke(staff1,oldRevokeState,randomUUID());
 await blocked(oldRevoke,'old revoke before new issue');
 const replacement=await issue(staff2,await state(staff2),randomUUID(),token());
 assert.equal(replacement.generation,'3');
 await admin.query('COMMIT');
 await assert.rejects(oldRevoke,error=>error.code==='40001');
 assert.equal((await state(staff2)).invitationId,replacement.invitationId);

 // Two different operations observed the same generation: exactly one wins.
 const sameCas=await state(staff1);
 const contenders=await Promise.allSettled([
  issue(staff1,sameCas,randomUUID(),token()),
  issue(staff2,sameCas,randomUUID(),token()),
 ]);
 assert.equal(contenders.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(contenders.filter(x=>x.status==='rejected'&&x.reason?.code==='40001').length,1);

 // Auth-session revocation commits before a waiting issue: authorization fails.
 const beforeRevocation=await state(staff1);
 await admin.query('BEGIN');
 await admin.query("UPDATE auth.sessions SET not_after=now()-interval '1 hour' WHERE id=$1",[ids.session1]);
 const unauthorized=issue(staff1,beforeRevocation,randomUUID(),token());
 await blocked(unauthorized,'issue after session revocation');
 await admin.query('COMMIT');
 await assert.rejects(unauthorized,error=>error.code==='42501');
 await admin.query('UPDATE auth.sessions SET not_after=NULL WHERE id=$1',[ids.session1]);

 // A->B->A changes M142's monotonic link revision; old context stays stale.
 const beforeAba=await state(staff1);
 await admin.query('UPDATE public.paciente SET identidad_id=$1 WHERE id=$2',[ids.identityB,ids.patient]);
 await admin.query('UPDATE public.paciente SET identidad_id=$1 WHERE id=$2',[ids.identity,ids.patient]);
 await assert.rejects(issue(staff1,beforeAba,randomUUID(),token()),error=>error.code==='40001');
 assert.notEqual((await state(staff1)).contextHash,beforeAba.contextHash);

 process.stdout.write('M147 real races PASS: delayed issue/revoke, same CAS, session revocation and link ABA\n');
}finally{
 for(const client of clients){
  try{await client.query('ROLLBACK');}catch{/* idle or failed transaction */}
  await client.end();
 }
}
