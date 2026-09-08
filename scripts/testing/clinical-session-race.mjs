/** Run only against a dedicated clone named folio_test_c2_race*. Leaves synthetic
 * fixtures for inspection. No env files, remote connections, deletion or daemons. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
const url=new URL(process.env.LOCAL_SQL_TEST_URL??'invalid:');
if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)
 ||!/^\/folio_test_c2_race[a-z0-9_]*$/.test(url.pathname)||url.search||url.hash)throw Error('Dedicated loopback folio_test_c2_race* database required.');
const config={host:url.hostname.replace(/^\[|\]$/g,''),port:Number(url.port||55439),database:url.pathname.slice(1),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),ssl:false,connectionTimeoutMillis:5000,statement_timeout:15000};
async function connection(actor=false){const c=new pg.Client(config);await c.connect();if(actor){await c.query("SELECT set_config('test.c2_uid','10600000-0000-4000-8000-000000000010',false)");await c.query('SET ROLE authenticated');}return c;}
const observer=await connection();let a,b;
const ids={org:'10600000-0000-4000-8000-000000000001',turno:'10600000-0000-4000-8000-000000000013',patient:'10600000-0000-4000-8000-000000000003'};
const operation=n=>`10600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const contextSql=`SELECT jsonb_build_object('profesional_id',t.profesional_id,'inicio',t.inicio,'member_especialidad',m.especialidad,'organization_especialidad',o.especialidad,'identity_id',p.identidad_id,'fecha_nacimiento',pi.fecha_nacimiento,'identity_deleted_at',pi.deleted_at) context FROM turno t JOIN organization o ON o.id=t.organization_id LEFT JOIN member m ON m.id=t.profesional_id JOIN paciente p ON p.id=t.paciente_id LEFT JOIN paciente_identidad pi ON pi.id=p.identidad_id WHERE t.id=$1`;
const rpc=async(c,revision,n,intent='SAVE',data={soap_s_cifrado:'\\x01'})=>{
 const {rows:[context]}=await c.query(contextSql,[ids.turno]);
 return c.query('SELECT public.save_clinical_session($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb) AS receipt',[ids.org,ids.turno,ids.patient,operation(n),revision,intent,n.toString(16).padStart(64,'0'),data===null?null:JSON.stringify(data),JSON.stringify(context.context)]).then(r=>r.rows[0].receipt);
};
async function expectWaiting(pid){for(let i=0;i<50;i++){const {rows}=await observer.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid]);if(rows[0]?.wait_event_type==='Lock')return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Second client did not wait on the database lock.');}
try{
 const {rows:[server]}=await observer.query("SELECT current_setting('server_version_num')::int version,host(inet_server_addr()) address");assert.ok(server.version>=160000&&server.version<170000);assert.ok(['127.0.0.1','::1'].includes(server.address));
 const {rows:[existing]}=await observer.query('SELECT count(*)::int total FROM organization WHERE id=$1',[ids.org]);assert.equal(existing.total,0,'Fixture already exists; create another dedicated clone.');
 const spec=await readFile(new URL('../../tests/sql/M106_session_atomic_revision.spec.sql',import.meta.url),'utf8');
 await observer.query(spec.split('-- FIXTURES END')[0]+'\nCOMMIT;');
 await observer.query("SELECT public.enable_session_atomic_writes('Synthetic two-client operation race verification')");
 a=await connection(true);b=await connection(true);const {rows:[backend]}=await b.query('SELECT pg_backend_pid() pid');

 await a.query('BEGIN');assert.equal((await rpc(a,0,101)).revision,1);
 const competing=rpc(b,0,102).then(value=>({value}),error=>({error}));await expectWaiting(backend.pid);await a.query('COMMIT');
 const firstRace=await competing;assert.equal(firstRace.error?.code,'40001');
 console.log('PASS two clients creating revision 0: one commit, one conflict.');

 await a.query('BEGIN');assert.equal((await rpc(a,1,103,'SAVE',{soap_s_cifrado:'\\x03'})).revision,2);
 const afterDisconnect=rpc(b,1,104,'SAVE',{soap_s_cifrado:'\\x04'});await expectWaiting(backend.pid);await a.end();a=null;
 assert.equal((await afterDisconnect).revision,2);
 const {rows:[retained]}=await observer.query("SELECT encode(soap_s_cifrado,'hex') value,revision FROM sesion WHERE turno_id=$1",[ids.turno]);assert.equal(retained.value,'04');assert.equal(Number(retained.revision),2);
 console.log('PASS interrupted transaction rolls back; waiting writer saves against the unchanged revision.');

 a=await connection(true);await a.query('BEGIN');const closed=await rpc(a,2,105,'CLOSE',{soap_s_cifrado:'\\x05'});assert.equal(closed.closed,true);
 const lateSave=rpc(b,2,106,'AUTOSAVE',{soap_s_cifrado:'\\x06'}).then(value=>({value}),error=>({error}));await expectWaiting(backend.pid);await a.query('COMMIT');assert.equal((await lateSave).error?.code,'40001');
 const recovered=await rpc(b,2,105,'CLOSE',null);assert.deepEqual(recovered,closed);
 const {rows:[final]}=await observer.query("SELECT s.revision,encode(s.soap_s_cifrado,'hex') value,s.locked_at IS NOT NULL locked,t.estado FROM sesion s JOIN turno t ON t.id=s.turno_id WHERE t.id=$1",[ids.turno]);
 assert.equal(Number(final.revision),3);assert.equal(final.value,'05');assert.equal(final.locked,true);assert.equal(final.estado,'CERRADO');
 console.log('PASS close vs autosave: original and close commit together; late autosave conflicts and lost response recovers same receipt.');
 console.log('PASS clinical concurrency with two actual PostgreSQL clients; Auth remains synthetic.');
}finally{await Promise.allSettled([a?.end(),b?.end(),observer.end()]);}
