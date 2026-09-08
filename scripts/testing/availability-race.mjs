/** Two real PostgreSQL connections; synthetic dedicated loopback database only. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
const url=new URL(process.env.LOCAL_SQL_TEST_URL??'invalid:');
if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost'].includes(url.hostname)||!/^\/folio_test_availability_race[a-z0-9_]*$/.test(url.pathname)||url.search||url.hash)throw Error('Dedicated loopback folio_test_availability_race* required');
const config={host:url.hostname,port:Number(url.port||55439),database:url.pathname.slice(1),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),ssl:false,connectionTimeoutMillis:5000,statement_timeout:15000};
const id=n=>`11300000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function connect(actor=false){const c=new pg.Client(config);await c.connect();if(actor){await c.query("SELECT set_config('test.availability_uid',$1,false)",[id(1)]);await c.query('SET ROLE authenticated');}return c;}
const observer=await connect();let a,b;
const snapshot=c=>c.query('SELECT public.read_availability_snapshot($1,$2) snapshot',[id(10),id(11)]).then(r=>r.rows[0].snapshot);
const save=(c,revision,n,hour)=>c.query('SELECT public.save_availability_revision($1,$2,$3,$4,$5,$6::jsonb) receipt',[id(10),id(11),revision,id(n),String(n).padStart(64,'0'),JSON.stringify([{dia_semana:1,hora_inicio:hour,hora_fin:'18:00'}])]).then(r=>r.rows[0].receipt);
async function wait(pid){for(let i=0;i<100;i++){if((await observer.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0]?.wait_event_type==='Lock')return;await new Promise(r=>setTimeout(r,10));}throw Error('Expected actual database lock wait');}
try{
 const spec=await readFile(new URL('../../tests/sql/M113_availability_revision.spec.sql',import.meta.url),'utf8');await observer.query(spec.split("SELECT set_config('test.availability_uid'")[0]+'COMMIT;');
 a=await connect(true);b=await connect(true);const pid=(await b.query('SELECT pg_backend_pid() pid')).rows[0].pid;
 let before=await snapshot(a);await a.query('BEGIN');const first=await save(a,before.revision,20,'09:00');const stale=save(b,before.revision,21,'10:00').then(()=>null,e=>e.code);await wait(pid);await a.query('COMMIT');assert.equal(await stale,'40001');assert.equal((await snapshot(b)).franjas[0].hora_inicio,'09:00');
 console.log('PASS same-base concurrent schedules serialize: one commits and the stale one conflicts, no merged week.');
 assert.deepEqual(await save(b,before.revision,20,'09:00'),first);
 before=await snapshot(a);await a.query('BEGIN');await save(a,before.revision,22,'11:00');const recovery=save(b,before.revision,23,'12:00');await wait(pid);await a.end();a=null;const recovered=await recovery;assert.equal((await snapshot(b)).franjas[0].hora_inicio,'12:00');
 console.log('PASS disconnect rolls back full replacement and revision; waiting command can commit.');
 assert.deepEqual(await save(b,0,20,'09:00'),first);assert.equal((await snapshot(b)).revision,recovered.revision);
 console.log('PASS old receipt replay after newer save never restores the old week.');
 a=await connect(true);before=await snapshot(a);await a.query('BEGIN');await a.query('SELECT public.reemplazar_disponibilidad($1,$2,$3::jsonb)',[id(10),id(11),JSON.stringify([{dia_semana:2,hora_inicio:'08:00',hora_fin:'09:00'}])]);const blocked=save(b,before.revision,24,'14:00').then(()=>null,e=>e.code);await wait(pid);await a.query('COMMIT');assert.equal(await blocked,'40001');
 assert.equal((await snapshot(b)).franjas[0].dia_semana,2);assert.equal(Number((await observer.query('SELECT value FROM folio_agenda_private.revision WHERE organization_id=$1',[id(10)])).rows[0].value)>0,true);
 console.log('PASS legacy changes invalidate new editors; M111 agenda marker remains active.');
 // The setup initializer locks organization state and uses the same agenda CAS.
 await observer.query('UPDATE organization SET onboarding_completed=false,onboarding_step_max=4 WHERE id=$1',[id(10)]);
 const setup=(c,rev,n,hour)=>c.query('SELECT public.save_onboarding_availability($1,$2,$3,$4,$5,$6::jsonb) receipt',[id(10),id(11),rev,id(n),String(n).padStart(64,'0'),JSON.stringify([{dia_semana:1,hora_inicio:hour,hora_fin:'18:00'}])]).then(r=>r.rows[0].receipt);
 before=await snapshot(a);await a.query('BEGIN');const seeded=await setup(a,before.revision,30,'10:00');const seedDuplicate=setup(b,before.revision,30,'10:00');await wait(pid);await a.query('COMMIT');assert.deepEqual(await seedDuplicate,seeded);
 assert.equal((await observer.query('SELECT onboarding_step_max FROM organization WHERE id=$1',[id(10)])).rows[0].onboarding_step_max,5);
 before=await snapshot(a);await a.query('BEGIN');await setup(a,before.revision,31,'11:00');const competing=setup(b,before.revision,32,'12:00').then(()=>null,e=>e.code);await wait(pid);await a.query('COMMIT');assert.equal(await competing,'40001');
 console.log('PASS concurrent setup same attempt seeds once; distinct stale setup conflicts.');
 await observer.query('BEGIN');await observer.query('UPDATE organization SET onboarding_completed=true WHERE id=$1',[id(10)]);const afterFinalization=setup(b,before.revision,33,'13:00').then(()=>null,e=>e.code);await wait(pid);await observer.query('COMMIT');assert.equal(await afterFinalization,'42501');
 console.log('PASS a setup request waiting on finalization rechecks completed state and cannot rewrite the agenda.');
 // Even a known, committed receipt must recheck a revocation committed while waiting.
 await observer.query('BEGIN');await observer.query('UPDATE member SET deleted_at=now() WHERE id=$1',[id(11)]);
 const afterRevocation=save(b,0,20,'09:00').then(()=>null,e=>e.code);await wait(pid);await observer.query('COMMIT');assert.equal(await afterRevocation,'42501');
 console.log('PASS receipt replay waiting on membership revocation denies access after the revocation commits.');
}finally{await Promise.allSettled([a?.end(),b?.end(),observer.end()]);}

