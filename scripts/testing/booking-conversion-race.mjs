/** Synthetic concurrency verification; dedicated local PostgreSQL 16 only. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
const url=new URL(process.env.LOCAL_SQL_TEST_URL??'invalid:');
if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost'].includes(url.hostname)||!/^\/folio_test_booking_race[a-z0-9_]*$/.test(url.pathname)||url.search||url.hash)throw Error('Dedicated loopback folio_test_booking_race* database required.');
const config={host:url.hostname,port:Number(url.port||55439),database:url.pathname.slice(1),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),ssl:false,connectionTimeoutMillis:5000,statement_timeout:15000};
async function connect(role){const c=new pg.Client(config);await c.connect();if(role){await c.query("SELECT set_config('test.booking_uid','11000000-0000-4000-8000-000000000001',false)");await c.query(`SET ROLE ${role}`);}return c;}
const ids=n=>`11000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const identity={nombre_cifrado:'\\x01',apellido_cifrado:'\\x02',telefono_cifrado:'\\x03',telefono_hash:'shared-household'};
const observer=await connect();let a,b;
async function wait(c){const pid=(await c.query('SELECT pg_backend_pid() pid')).rows[0].pid;return async()=>{for(let i=0;i<100;i++){if((await observer.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0]?.wait_event_type==='Lock')return;await new Promise(r=>setTimeout(r,10));}throw Error('Expected actual database lock wait');};}
const convert=(c,n)=>c.query("SELECT public.promote_pedido_atomic($1,$2,$3,$4,now()+make_interval(days=>$5),NULL,$6::jsonb) receipt",[ids(10),ids(n),ids(11),ids(20),n-29,identity]).then(r=>r.rows[0].receipt);
const submit=(c,n,day=6)=>c.query("SELECT public.submit_public_booking('m110-synthetic',$1,$2,$3,$4,((now() AT TIME ZONE 'America/Argentina/Cordoba')::date+make_interval(days=>$5,hours=>9)) AT TIME ZONE 'America/Argentina/Cordoba',$6::jsonb,$7::jsonb) receipt",[ids(n),'a'.repeat(64),ids(11),ids(20),day,{nombre_cifrado:'\\x01',telefono_cifrado:'\\x02',consent_version:'synthetic-v1'},identity]).then(r=>r.rows[0].receipt);
try{
 const spec=await readFile(new URL('../../tests/sql/M110_booking_atomic.spec.sql',import.meta.url),'utf8');await observer.query(spec.split("SELECT set_config('test.booking_uid'")[0]+'COMMIT;');
 a=await connect('authenticated');b=await connect('authenticated');let waiting=await wait(b);
 await a.query('BEGIN');const first=await convert(a,30);const pending=convert(b,30);await waiting();await a.query('COMMIT');const retry=await pending;assert.equal(first.turnoId,retry.turnoId);assert.equal(first.pacienteId,retry.pacienteId);
 assert.equal(Number((await observer.query('SELECT count(*) count FROM turno WHERE organization_id=$1',[ids(10)])).rows[0].count),1);
 console.log('PASS simultaneous conversion: one patient/turn and same receipt.');
 await a.query('BEGIN');await convert(a,31);const afterDisconnect=convert(b,31);await waiting();await a.end();a=null;await afterDisconnect;
 assert.equal(Number((await observer.query('SELECT count(*) count FROM paciente WHERE organization_id=$1',[ids(10)])).rows[0].count),2);
 console.log('PASS disconnect rolls back every intermediate row; retry commits once.');
 await b.end();b=await connect('service_role');a=await connect('service_role');waiting=await wait(b);
 await a.query('BEGIN');const publicFirst=await submit(a,90);const duplicate=submit(b,90);await waiting();await a.query('COMMIT');assert.deepEqual(await duplicate,publicFirst);
 console.log('PASS simultaneous public submissions with same operation return one receipt.');
 await a.query('BEGIN');await submit(a,91,7);const conflict=submit(b,92,7).then(value=>({value}),error=>({error}));await waiting();await a.query('COMMIT');assert.equal((await conflict).error?.code,'23P01');
 assert.equal(Number((await observer.query('SELECT count(*) count FROM folio_booking_private.submission WHERE organization_id=$1',[ids(10)])).rows[0].count),2);
 assert.equal(Number((await observer.query('SELECT count(*) count FROM paciente WHERE organization_id=$1',[ids(10)])).rows[0].count),4);
 assert.equal(Number((await observer.query('SELECT count(*) count FROM recordatorio_job WHERE organization_id=$1',[ids(10)])).rows[0].count),8);
 console.log('PASS different public operations race for slot: loser leaves no request, receipt or patient.');
}finally{await Promise.allSettled([a?.end(),b?.end(),observer.end()]);}
