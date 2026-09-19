/** Synthetic PostgreSQL 16 verification, dedicated loopback import database only. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
const url=new URL(process.env.LOCAL_SQL_TEST_URL??'invalid:');
if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost'].includes(url.hostname)||!/^\/folio_test_import_race[a-z0-9_]*$/.test(url.pathname)||url.search||url.hash)throw Error('Dedicated loopback folio_test_import_race* database required');
const config={host:url.hostname,port:Number(url.port||55439),database:url.pathname.slice(1),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),ssl:false,connectionTimeoutMillis:5000,statement_timeout:15000};
const id=n=>`11200000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function connect(actor=false){const c=new pg.Client(config);await c.connect();if(actor){await c.query("SELECT set_config('test.import_uid',$1,false)",[id(1)]);await c.query('SET ROLE authenticated');}return c;}
const observer=await connect();let a,b;
const begin=(c,n,hash)=>c.query('SELECT public.begin_patient_import($1,$2,$3,4) id',[id(10),id(n),hash.repeat(64)]).then(r=>r.rows[0].id);
const row=(c,run,n,hash)=>c.query('SELECT public.import_patient_row($1,$2,$3,$4,$5::jsonb,$6,$7::text[]) receipt',[id(10),run,n,hash.repeat(64),{nombre_cifrado:'\\x01',apellido_cifrado:'\\x02',telefono_cifrado:'\\x03',telefono_hash:'shared-household'},'import',[]]).then(r=>r.rows[0].receipt);
async function wait(pid){for(let i=0;i<100;i++){if((await observer.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0]?.wait_event_type==='Lock')return;await new Promise(r=>setTimeout(r,10));}throw Error('Expected actual database lock wait');}
try{
 const spec=await readFile(new URL('../../tests/sql/M112_patient_import_durability.spec.sql',import.meta.url),'utf8');await observer.query(spec.split("SELECT set_config('test.import_uid'")[0]+'COMMIT;');
 a=await connect(true);b=await connect(true);const pid=(await b.query('SELECT pg_backend_pid() pid')).rows[0].pid;
 await a.query('BEGIN');const run=await begin(a,20,'a');const secondRun=begin(b,21,'a');await wait(pid);await a.query('COMMIT');assert.equal(await secondRun,run);
 console.log('PASS simultaneous same-file imports recover one run.');
 await a.query('BEGIN');const first=await row(a,run,2,'b');const duplicate=row(b,run,2,'b');await wait(pid);await a.query('COMMIT');assert.deepEqual(await duplicate,first);
 console.log('PASS simultaneous same row commits one patient and one identical receipt.');
 await a.query('BEGIN');await row(a,run,3,'c');const recovered=row(b,run,3,'c');await wait(pid);await a.end();a=null;assert.equal((await recovered).status,'imported');
 assert.equal(Number((await observer.query('SELECT count(*) count FROM paciente_identidad WHERE organization_id=$1',[id(10)])).rows[0].count),2);
 console.log('PASS disconnected row transaction rolls back identity and patient; retry succeeds once.');
 a=await connect(true);const other=await begin(a,22,'d');
 await a.query('BEGIN');assert.equal((await row(a,run,4,'e')).status,'imported');const copied=row(b,other,2,'e');await wait(pid);await a.query('COMMIT');assert.equal((await copied).status,'review_previous');
 assert.equal(Number((await observer.query('SELECT count(*) count FROM paciente WHERE organization_id=$1',[id(10)])).rows[0].count),3);
 console.log('PASS identical row in concurrent different files requires review, never creates or adopts another patient.');
}finally{await Promise.allSettled([a?.end(),b?.end(),observer.end()]);}
