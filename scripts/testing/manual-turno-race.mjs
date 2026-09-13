/** Real transaction races on dedicated synthetic PostgreSQL 16; no providers. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
const url=new URL(process.env.LOCAL_SQL_TEST_URL??'invalid:');
if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost'].includes(url.hostname)
 ||!/^\/folio_test_manual_(m117|race)_[a-z0-9_]+$/.test(url.pathname)||url.search||url.hash)throw Error('Dedicated loopback folio_test_manual_m117_* or folio_test_manual_race_* required.');
const config={host:url.hostname,port:Number(url.port||55439),database:url.pathname.slice(1),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),ssl:false,connectionTimeoutMillis:5000,statement_timeout:15000};
const id=n=>`11700000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const identity={nombre_cifrado:'\\x01',apellido_cifrado:'\\x02',telefono_cifrado:'\\x03',nombre_hash:'a'.repeat(64),telefono_hash:'b'.repeat(64)};
async function connect(staff=false){const c=new pg.Client(config);await c.connect();if(staff){await c.query("SELECT set_config('test.manual_uid',$1,false)",[id(1)]);await c.query('SET ROLE authenticated');}return c;}
const observer=await connect();let a,b;
const create=(c,operation,hour)=>c.query('SELECT public.create_manual_turno_atomic($1,$2,$3,NULL,$4,$5,$6,$7,30,\'WALK_IN\') receipt',[id(10),id(operation),'c'.repeat(64),identity,id(11),id(12),`2026-10-12T${hour}:00:00Z`]).then(r=>r.rows[0].receipt);
async function waiter(c){const pid=(await c.query('SELECT pg_backend_pid() pid')).rows[0].pid;return async()=>{for(let n=0;n<150;n++){if((await observer.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0]?.wait_event_type==='Lock')return;await new Promise(r=>setTimeout(r,10));}throw Error('Expected actual transaction lock wait');};}
async function counts(expected){for(const table of ['paciente_identidad','paciente','turno','folio_manual_visit_private.receipt'])assert.equal(Number((await observer.query(`SELECT count(*) n FROM ${table} WHERE organization_id=$1`,[id(10)])).rows[0].n),expected,table);assert.equal(Number((await observer.query('SELECT count(*) n FROM recordatorio_job WHERE organization_id=$1',[id(10)])).rows[0].n),expected*2);}
try {
 const state=(await observer.query("SELECT current_setting('server_version_num')::int version,host(inet_server_addr()) address")).rows[0];
 assert.ok(state.version>=160000&&state.version<170000);assert.ok(['127.0.0.1','::1'].includes(state.address));
 assert.equal(Number((await observer.query('SELECT count(*) n FROM organization WHERE id=$1',[id(10)])).rows[0].n),0,'Fixture already present; use a new dedicated database.');
 const spec=await readFile(new URL('../../tests/sql/M117_manual_turno_atomic.spec.sql',import.meta.url),'utf8');
 await observer.query(spec.split("SELECT set_config('test.manual_uid'")[0]+'COMMIT;');
 a=await connect(true);b=await connect(true);let waiting=await waiter(b);
 await a.query('BEGIN');const first=await create(a,200,'12');const repeated=create(b,200,'12');await waiting();await a.query('COMMIT');const replay=await repeated;
 assert.equal(first.turnoId,replay.turnoId);assert.equal(first.pacienteId,replay.pacienteId);await counts(1);
 console.log('PASS simultaneous identical operations: same visit, patient, receipt and two reminders.');
 await a.query('BEGIN');await create(a,201,'13');const conflict=create(b,202,'13').then(value=>({value}),error=>({error}));await waiting();await a.query('COMMIT');assert.equal((await conflict).error?.code,'23P01');await counts(2);
 console.log('PASS competing operations: losing transaction leaves no identity, patient, visit, reminder or receipt.');
 await a.query('BEGIN');const abandoned=await create(a,203,'14');const recovered=create(b,203,'14');await waiting();await a.end();a=null;const recovery=await recovered;assert.notEqual(recovery.turnoId,abandoned.turnoId);await counts(3);
 console.log('PASS disconnected transaction rolls back; waiting retry commits once.');
 // Simulate loss after COMMIT: ignore the acknowledgement and repeat operation.
 const committed=await create(b,204,'15');const afterLostReply=await create(b,204,'15');assert.equal(committed.turnoId,afterLostReply.turnoId);await counts(4);
 console.log('PASS lost committed reply: recovery returns original visit with no repeated effects.');
} finally {await Promise.allSettled([a?.end(),b?.end(),observer.end()]);}
