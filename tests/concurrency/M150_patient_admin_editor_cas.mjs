// Prepared, not run locally. Same disposable hosted PG16 boundary as M148.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

assert.equal(process.env.FOLIO_M150_SYNTHETIC,'1');
assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');
assert.equal(process.env.RUNNER_OS,'Linux');
assert.equal(process.platform,'linux');
assert.ok(['localhost','127.0.0.1'].includes(process.env.PGHOST));
assert.equal(process.env.PGPORT,'5432');
assert.equal(process.env.PGDATABASE,'folio_test');
assert.equal(process.env.PGUSER,'postgres');
assert.match(process.env.FOLIO_M150_EXPECTED_SHA??'',/^[0-9a-f]{40}$/);
assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),process.env.FOLIO_M150_EXPECTED_SHA);

const clients=[];
async function connect(){
  const client=new pg.Client({connectionTimeoutMillis:5000,statement_timeout:15000,query_timeout:16000});
  await client.connect();clients.push(client);
  const {rows:[db]}=await client.query('SELECT current_database() db,current_user actor');
  assert.deepEqual(db,{db:'folio_test',actor:'postgres'});return client;
}
const admin=await connect(),barrier=await connect(),owner=await connect(),director=await connect(),portal=await connect(),professional=await connect(),service=await connect();
const ids=Object.fromEntries(['org','userOwner','userDirector','userPortal','userProfessional','memberOwner','memberDirector','memberProfessional',
  'account','patient','patientQ','identity','identityB','factorOwner','factorDirector','factorPortal','factorProfessional',
  'sessionOwner','sessionDirector','sessionPortal','sessionProfessional','userEnrollment','memberEnrollment','factorEnrollment','sessionEnrollment','service','witness'].map(key=>[key,randomUUID()]));
const actors={owner:{user:ids.userOwner,actor:ids.memberOwner,role:'OWNER',session:ids.sessionOwner},
  director:{user:ids.userDirector,actor:ids.memberDirector,role:'DIRECTOR',session:ids.sessionDirector},
  portal:{user:ids.userPortal,actor:ids.account,role:'PORTAL',session:ids.sessionPortal},
  professional:{user:ids.userProfessional,actor:ids.memberProfessional,role:'PROFESIONAL',session:ids.sessionProfessional}};
const pid=new Map();
for(const client of [owner,director,portal,professional,barrier])pid.set(client,(await client.query('SELECT pg_backend_pid() pid')).rows[0].pid);
const hex=n=>String.fromCharCode(92)+'x'+n.repeat(64),hash=n=>n.repeat(64);
const contact=()=>({nombre_cifrado:hex('a'),apellido_cifrado:hex('b'),nombre_hash:hash('a'),telefono_cifrado:hex('c'),telefono_hash:hash('c'),email_cifrado:null,email_hash:null,ocupacion_cifrado:null});
const coverage=()=>({cobertura_nombre:'Race-'+randomUUID().slice(0,8),cobertura_plan:null,cobertura_nro_afiliado_cifrado:null});
const portalPatch=()=>({domicilio_ciudad:'City-'+randomUUID().slice(0,8)});
async function configure(client,actor){
  await client.query("SELECT set_config('test.m150_race_uid',$1,false)",[actor.user]);
  await client.query("SELECT set_config('test.m150_race_jwt',$1,false)",[JSON.stringify({aal:'aal2',session_id:actor.session})]);
  await client.query("SELECT set_config('request.jwt.claim.role','authenticated',false)");
  await client.query('SET ROLE authenticated');
}
async function snapshot(patient=ids.patient){
  return (await admin.query(`SELECT p.identidad_id identity,p.identity_link_revision::text link,pi.admin_revision::text revision,
    pi.cobertura_nombre coverage,pi.domicilio_ciudad city FROM public.paciente p
    JOIN public.paciente_identidad pi ON pi.id=p.identidad_id WHERE p.id=$1`,[patient])).rows[0];
}
async function invoke(client,kind,actor,state,patch){
  const name={contact:'patient_admin_contact_cas',coverage:'patient_admin_coverage_cas',portal:'patient_portal_contact_cas'}[kind];
  return (await client.query(`SELECT public.${name}($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) result`,
    [ids.org,ids.patient,state.identity,state.revision,state.link,actor.actor,actor.role,actor.session,JSON.stringify(patch)])).rows[0].result;
}
function observed(promise){return promise.then(value=>({value}),error=>({error}));}
function releaseOnError(client,promise){return promise.then(async result=>{if(result.error)await client.query('ROLLBACK');return result;});}
async function blocked(promise,waiting,blocking,label){
  let finished=false;promise.then(()=>{finished=true;},()=>{finished=true;});
  for(let i=0;i<80;i++){
    assert.equal(finished,false,`${label} completed before barrier`);
    const {rows:[activity]}=await admin.query('SELECT wait_event_type,pg_blocking_pids($1) blockers FROM pg_stat_activity WHERE pid=$1',[pid.get(waiting)]);
    if(activity?.wait_event_type==='Lock'&&activity.blockers?.includes(pid.get(blocking)))return;
    await delay(25);
  }
  assert.fail(`${label} did not reach intended PostgreSQL lock`);
}
async function assertIdentityUnchanged(state){
  const {rows:[row]}=await admin.query('SELECT admin_revision::text revision FROM public.paciente_identidad WHERE id=$1',[state.identity]);
  assert.equal(row?.revision,state.revision);
}
async function restoreLinks(){
  await admin.query('UPDATE public.paciente SET identidad_id=NULL WHERE id=$1',[ids.patientQ]);
  await admin.query('UPDATE public.paciente SET identidad_id=$1,cuenta_id=$2,caja_fuerte_profesional=NULL WHERE id=$3',[ids.identity,ids.account,ids.patient]);
}
async function rejectedWhileWaiting(client,actor,lock,mutation,restore,label){
  const state=await snapshot();await barrier.query('BEGIN');await barrier.query(lock.sql,lock.args);
  const pending=observed(invoke(client,actor.role==='PORTAL'?'portal':'coverage',actor,state,actor.role==='PORTAL'?portalPatch():coverage()));
  await blocked(pending,client,barrier,label);await barrier.query(mutation.sql,mutation.args);await barrier.query('COMMIT');
  const result=await pending;assert.equal(result.error?.code,'42501',label);await assertIdentityUnchanged(state);
  await admin.query(restore.sql,restore.args);
}
async function newIntake(){
  const visit=randomUUID(),invitation=randomUUID(),intakeSession=randomUUID(),receipt=randomUUID(),operation=randomUUID();
  await admin.query(`INSERT INTO public.turno(id,organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents)
    VALUES($1,$2,$3,$4,$5,now()+interval '9 days',30,0)`,[visit,ids.org,ids.patient,ids.service,ids.memberOwner]);
  await admin.query(`INSERT INTO folio_intake_private.invitation
    (id,organization_id,turno_id,paciente_id,identidad_id,identity_link_revision,organization_intake_revision,
     paciente_intake_revision,identidad_intake_revision,profesional_id,issued_by_member_id,turno_inicio,turno_intake_revision,
     token_hash,fingerprint_key_cifrado,expires_at)
    SELECT $1,o.id,t.id,p.id,pi.id,p.identity_link_revision,o.intake_revision,p.intake_revision,pi.intake_revision,
      t.profesional_id,$2,t.inicio,t.intake_revision,$3,decode(repeat('aa',60),'hex'),clock_timestamp()+interval '1 hour'
    FROM public.turno t JOIN public.paciente p ON p.id=t.paciente_id JOIN public.paciente_identidad pi ON pi.id=p.identidad_id
    JOIN public.organization o ON o.id=t.organization_id WHERE t.id=$4`,[invitation,ids.memberOwner,randomUUID().replaceAll('-','').repeat(2),visit]);
  await admin.query(`INSERT INTO folio_intake_private.session(id,invitation_id,token_hash,expires_at)
    VALUES($1,$2,$3,clock_timestamp()+interval '30 minutes')`,[intakeSession,invitation,randomUUID().replaceAll('-','').repeat(2)]);
  await admin.query(`INSERT INTO folio_intake_private.submission
    (id,invitation_id,session_id,operation_id,questionnaire_version,content_fingerprint,answers_cifrado)
    VALUES($1,$2,$3,$4,'admin.v1',$5,decode(repeat('aa',64),'hex'))`,[receipt,invitation,intakeSession,randomUUID(),hash('a')]);
  const state=(await owner.query('SELECT public.patient_intake_incorporation_snapshot($1,$2,$3) result',[ids.org,visit,receipt])).rows[0].result;
  const preparation=(await owner.query('SELECT public.patient_intake_incorporation_prepare($1,$2,$3,$4::text[],$5,$6,$7,$8) result',
    [ids.org,visit,receipt,['email'],state.identityId,state.adminRevision,state.contextHash,operation])).rows[0].result;
  assert.equal(preparation.status,'pending');
  const patch={email_cifrado:Buffer.alloc(32,23).toString('base64'),email_hash:hash('e')};
  const ready=(await service.query('SELECT public.patient_intake_incorporation_materialize($1,$2::jsonb,$3) result',
    [preparation.preparationId,JSON.stringify(patch),hash('a')])).rows[0].result;
  assert.equal(ready.status,'materialized');
  return {operation,apply:()=>owner.query('SELECT public.patient_intake_incorporation_apply($1,$2,$3,$4) result',
    [ids.org,visit,preparation.preparationId,operation]).then(result=>result.rows[0].result)};
}

try{
  await admin.query(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('test.m150_race_uid',true),'')::uuid $$`);
  await admin.query(`CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
    $$ SELECT coalesce(nullif(current_setting('test.m150_race_jwt',true),''),'{}')::jsonb $$`);
  await admin.query('GRANT USAGE ON SCHEMA public,auth TO authenticated');
  await admin.query('GRANT SELECT,UPDATE ON public.paciente_identidad TO authenticated');
  await admin.query('GRANT SELECT ON public.paciente,public.member TO authenticated');
  for(const [name,actor] of Object.entries(actors)){
    await admin.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[actor.user,`m150-${name}-${actor.user}@synthetic.invalid`]);
    await admin.query(`INSERT INTO public.profile(id,email,consent_pii_signed_at,consent_pii_text_version)
      VALUES($1,$2,now(),'v1')`,[actor.user,`m150-${name}-${actor.user}@synthetic.invalid`]);
  }
  await admin.query('INSERT INTO public.organization(id,slug,nombre) VALUES($1,$2,$3)',[ids.org,`m150-${ids.org.slice(0,8)}`,'M150 synthetic']);
  for(const name of ['owner','director','professional']){
    const actor=actors[name];await admin.query(`INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at)
      VALUES($1,$2,$3,$4,true,now())`,[actor.actor,ids.org,actor.user,actor.role]);
  }
  await admin.query('INSERT INTO public.paciente_cuenta(id,auth_user_id,email) VALUES($1,$2,$3)',[ids.account,ids.userPortal,'m150-portal@synthetic.invalid']);
  await admin.query(`INSERT INTO public.paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado)
    VALUES($1,$3,decode(repeat('aa',32),'hex'),decode(repeat('bb',32),'hex'),decode(repeat('cc',32),'hex')),
      ($2,$3,decode(repeat('aa',32),'hex'),decode(repeat('bb',32),'hex'),decode(repeat('cc',32),'hex'))`,[ids.identity,ids.identityB,ids.org]);
  await admin.query(`INSERT INTO public.paciente(id,organization_id,identidad_id,profesional_principal_id,cuenta_id)
    VALUES($1,$3,$4,$6,$7),($2,$3,$5,$6,$7)`,[ids.patient,ids.patientQ,ids.org,ids.identity,ids.identityB,ids.memberOwner,ids.account]);
  await admin.query(`INSERT INTO public.servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents)
    VALUES($1,$2,'M150 synthetic','CONSULTA_INICIAL',30,0)`,[ids.service,ids.org]);
  for(const [name,actor] of Object.entries(actors)){
    const factor=ids['factor'+name[0].toUpperCase()+name.slice(1)];
    await admin.query("INSERT INTO auth.mfa_factors(id,user_id,status) VALUES($1,$2,'verified')",[factor,actor.user]);
    await admin.query("INSERT INTO auth.sessions(id,user_id,aal,factor_id) VALUES($1,$2,'aal2',$3)",[actor.session,actor.user,factor]);
  }
  await admin.query('UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=NULL');
  for(const [client,name] of [[owner,'owner'],[director,'director'],[portal,'portal'],[professional,'professional']])await configure(client,actors[name]);
  await service.query("SELECT set_config('request.jwt.claim.role','service_role',false)");await service.query('SET ROLE service_role');

  // Relink wins while CAS is blocked. I1 must remain byte-for-byte untouched.
  let state=await snapshot();await barrier.query('BEGIN');
  await barrier.query('SELECT 1 FROM public.paciente WHERE id=$1 FOR UPDATE',[ids.patient]);
  const oldTarget=observed(invoke(owner,'coverage',actors.owner,state,coverage()));
  await blocked(oldTarget,owner,barrier,'relink before CAS');
  await barrier.query('UPDATE public.paciente SET identidad_id=NULL WHERE id=$1',[ids.patientQ]);
  await barrier.query('UPDATE public.paciente SET identidad_id=$1 WHERE id=$2',[ids.identityB,ids.patient]);
  await barrier.query('COMMIT');assert.equal((await oldTarget).value?.status,'conflict');await assertIdentityUnchanged(state);
  await restoreLinks();

  // CAS wins and keeps P fixed until commit; the relink waits for that commit.
  state=await snapshot();await owner.query('BEGIN');
  assert.equal((await invoke(owner,'coverage',actors.owner,state,coverage())).status,'applied');
  await barrier.query('BEGIN');const laterLink=observed(barrier.query('UPDATE public.paciente SET identidad_id=$1 WHERE id=$2',[ids.identityB,ids.patient]));
  await blocked(laterLink,barrier,owner,'CAS before relink');await owner.query('COMMIT');
  assert.ok((await laterLink).value);await barrier.query('COMMIT');
  assert.equal((await admin.query('SELECT admin_revision::text r FROM public.paciente_identidad WHERE id=$1',[ids.identity])).rows[0].r,(BigInt(state.revision)+1n).toString());
  await restoreLinks();

  // ABA keeps I1 but not the original link version.
  state=await snapshot();await admin.query('UPDATE public.paciente SET identidad_id=$1 WHERE id=$2',[ids.identityB,ids.patient]);await restoreLinks();
  assert.equal((await invoke(owner,'coverage',actors.owner,state,coverage())).status,'conflict');await assertIdentityUnchanged(state);

  // Portal counterexample respects UNIQUE: P->I2, then Q->I1 (never two I1 links).
  state=await snapshot();await admin.query('UPDATE public.paciente SET identidad_id=$1 WHERE id=$2',[ids.identityB,ids.patient]);
  await admin.query('UPDATE public.paciente SET identidad_id=$1 WHERE id=$2',[ids.identity,ids.patientQ]);
  assert.equal((await invoke(portal,'portal',actors.portal,state,portalPatch())).status,'conflict');await assertIdentityUnchanged(state);await restoreLinks();

  // Different actors, shared frozen versions. Exactly one write increments the revision.
  state=await snapshot();const pair=await Promise.all([invoke(owner,'contact',actors.owner,state,contact()),invoke(portal,'portal',actors.portal,state,portalPatch())]);
  assert.deepEqual(pair.map(result=>result.status).sort(),['applied','conflict']);
  assert.equal((await snapshot()).revision,(BigInt(state.revision)+1n).toString());

  // Intake wins before direct editor; then the reverse order with a fresh preparation.
  let intake=await newIntake();state=await snapshot();await owner.query('BEGIN');assert.equal((await intake.apply()).status,'applied');
  const directAfter=observed(invoke(director,'coverage',actors.director,state,coverage()));await blocked(directAfter,director,owner,'intake before direct editor');
  await owner.query('COMMIT');assert.equal((await directAfter).value?.status,'conflict');
  intake=await newIntake();state=await snapshot();await director.query('BEGIN');assert.equal((await invoke(director,'coverage',actors.director,state,coverage())).status,'applied');
  const intakeAfter=observed(intake.apply());await blocked(intakeAfter,owner,director,'direct editor before intake');await director.query('COMMIT');
  assert.equal((await intakeAfter).value?.status,'conflict');
  assert.equal((await admin.query('SELECT count(*)::int n FROM folio_intake_private.incorporation_provenance WHERE operation_id=$1',[intake.operation])).rows[0].n,0);

  await rejectedWhileWaiting(owner,actors.owner,{sql:'SELECT 1 FROM auth.sessions WHERE id=$1 FOR UPDATE',args:[ids.sessionOwner]},
    {sql:'DELETE FROM auth.sessions WHERE id=$1',args:[ids.sessionOwner]},
    {sql:"INSERT INTO auth.sessions(id,user_id,aal,factor_id) VALUES($1,$2,'aal2',$3)",args:[ids.sessionOwner,ids.userOwner,ids.factorOwner]},'session revoked during wait');
  await rejectedWhileWaiting(owner,actors.owner,{sql:'SELECT 1 FROM public.member WHERE id=$1 FOR UPDATE',args:[ids.memberOwner]},
    {sql:'UPDATE public.member SET deleted_at=now() WHERE id=$1',args:[ids.memberOwner]},
    {sql:'UPDATE public.member SET deleted_at=NULL WHERE id=$1',args:[ids.memberOwner]},'member revoked during wait');
  await rejectedWhileWaiting(owner,actors.owner,{sql:'SELECT 1 FROM auth.mfa_factors WHERE id=$1 FOR UPDATE',args:[ids.factorOwner]},
    {sql:"UPDATE auth.mfa_factors SET status='unverified' WHERE id=$1",args:[ids.factorOwner]},
    {sql:"UPDATE auth.mfa_factors SET status='verified' WHERE id=$1",args:[ids.factorOwner]},'factor revoked during wait');
  await rejectedWhileWaiting(portal,actors.portal,{sql:'SELECT 1 FROM public.paciente_cuenta WHERE id=$1 FOR UPDATE',args:[ids.account]},
    {sql:'UPDATE public.paciente_cuenta SET deleted_at=now() WHERE id=$1',args:[ids.account]},
    {sql:'UPDATE public.paciente_cuenta SET deleted_at=NULL WHERE id=$1',args:[ids.account]},'account revoked during wait');
  await rejectedWhileWaiting(owner,actors.owner,{sql:'SELECT 1 FROM public.paciente WHERE id=$1 FOR UPDATE',args:[ids.patient]},
    {sql:'UPDATE public.paciente SET caja_fuerte_profesional=$1 WHERE id=$2',args:[ids.memberDirector,ids.patient]},
    {sql:'UPDATE public.paciente SET caja_fuerte_profesional=NULL WHERE id=$1',args:[ids.patient]},'vault changed during wait');

  // A supporting professional witness is held before patient/identity locks.
  await admin.query(`INSERT INTO public.turno(id,organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents,estado)
    VALUES($1,$2,$3,$4,$5,now()+interval '20 days',30,0,'CERRADO')`,[ids.witness,ids.org,ids.patient,ids.service,ids.memberProfessional]);
  await rejectedWhileWaiting(professional,actors.professional,{sql:'SELECT 1 FROM public.turno WHERE id=$1 FOR UPDATE',args:[ids.witness]},
    {sql:'DELETE FROM public.turno WHERE id=$1',args:[ids.witness]},
    {sql:'SELECT 1',args:[]},'professional witness removed during wait');

  // First MFA verification can reverse auth.users -> factor via M101's FK insert.
  const enrollment=await connect();pid.set(enrollment,(await enrollment.query('SELECT pg_backend_pid() pid')).rows[0].pid);
  const enrollmentActor={user:ids.userEnrollment,actor:ids.memberEnrollment,role:'OWNER',session:ids.sessionEnrollment};
  await admin.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[ids.userEnrollment,'m150-enrollment@synthetic.invalid']);
  await admin.query(`INSERT INTO public.profile(id,email,consent_pii_signed_at,consent_pii_text_version)
    VALUES($1,$2,now(),'v1')`,[ids.userEnrollment,'m150-enrollment@synthetic.invalid']);
  await admin.query(`INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at)
    VALUES($1,$2,$3,'OWNER',false,now())`,[ids.memberEnrollment,ids.org,ids.userEnrollment]);
  await admin.query("INSERT INTO auth.mfa_factors(id,user_id,status) VALUES($1,$2,'unverified')",[ids.factorEnrollment,ids.userEnrollment]);
  await admin.query("INSERT INTO auth.sessions(id,user_id,aal) VALUES($1,$2,'aal1')",[ids.sessionEnrollment,ids.userEnrollment]);
  await configure(enrollment,enrollmentActor);
  await enrollment.query("SELECT set_config('test.m150_race_jwt',$1,false)",[JSON.stringify({aal:'aal1',session_id:ids.sessionEnrollment})]);
  state=await snapshot();await barrier.query('BEGIN');
  await barrier.query('SELECT 1 FROM auth.mfa_factors WHERE id=$1 FOR UPDATE',[ids.factorEnrollment]);
  await enrollment.query('BEGIN');
  const enrollingCas=releaseOnError(enrollment,observed(invoke(enrollment,'coverage',enrollmentActor,state,coverage())));
  await blocked(enrollingCas,enrollment,barrier,'first factor verification reversed order');
  const verifying=releaseOnError(barrier,observed(barrier.query("UPDATE auth.mfa_factors SET status='verified' WHERE id=$1",[ids.factorEnrollment])));
  const verificationOutcomes=await Promise.all([enrollingCas,verifying]);
  assert.equal(verificationOutcomes.filter(result=>result.error?.code==='40P01').length,1);
  assert.equal(verificationOutcomes.filter(result=>result.value).length,1);
  if(verificationOutcomes[0].error){
    await barrier.query('COMMIT');await assertIdentityUnchanged(state);
    assert.equal((await admin.query('SELECT count(*)::int n FROM folio_mfa_private.protected_account WHERE user_id=$1',[ids.userEnrollment])).rows[0].n,1);
  }else{
    await enrollment.query('COMMIT');assert.equal((await snapshot()).revision,(BigInt(state.revision)+1n).toString());
    assert.equal((await admin.query('SELECT status FROM auth.mfa_factors WHERE id=$1',[ids.factorEnrollment])).rows[0].status,'unverified');
    assert.equal((await admin.query('SELECT count(*)::int n FROM folio_mfa_private.protected_account WHERE user_id=$1',[ids.userEnrollment])).rows[0].n,0);
  }

  // Model M93's real reversed lock order, then execute M93 itself. No trigger/policy change.
  state=await snapshot();await barrier.query('BEGIN');
  await barrier.query('SELECT 1 FROM public.paciente_identidad WHERE id=$1 FOR UPDATE',[ids.identity]);
  await owner.query('BEGIN');const casDeadlock=releaseOnError(owner,observed(invoke(owner,'coverage',actors.owner,state,coverage())));
  await blocked(casDeadlock,owner,barrier,'M93 reversed lock order');
  await configure(barrier,actors.director);
  const pseudoDeadlock=releaseOnError(barrier,observed(barrier.query('SELECT public.pseudonimizar_paciente($1,$2,false) result',[ids.patient,'M150 synthetic deadlock'])));
  const outcomes=await Promise.all([casDeadlock,pseudoDeadlock]);
  assert.equal(outcomes.filter(result=>result.error?.code==='40P01').length,1,'one transaction must be aborted');
  assert.equal(outcomes.filter(result=>result.value).length,1,'one transaction may complete');
  // releaseOnError rolls back the victim immediately, releasing all earlier locks.
  if(outcomes[0].error){await barrier.query('COMMIT');
    assert.equal((await admin.query('SELECT count(*)::int n FROM public.paciente_identidad WHERE id=$1',[ids.identity])).rows[0].n,0);
  }else{await owner.query('COMMIT');
    assert.equal((await snapshot()).identity,ids.identity);assert.equal((await snapshot()).revision,(BigInt(state.revision)+1n).toString());
    assert.equal((await admin.query('SELECT pseudonimizado_en IS NULL intact FROM public.paciente WHERE id=$1',[ids.patient])).rows[0].intact,true);
  }
  process.stdout.write('M150 hosted PG16 races PASS: relink both orders, ABA, portal UNIQUE case, cross-editor/intake CAS, authority waits and M93/first-factor victim rollback\n');
}finally{
  for(const client of clients){try{await client.query('ROLLBACK');}catch{/* failed transaction cleanup */}}
  for(const client of clients){try{await client.end();}catch{/* closed connection */}}
}
