/** PostgreSQL 16 + synthetic Auth stubs. No Docker, schema replay or providers.
 * Requires an already migrated, empty loopback folio_test_m119_<suffix> database.
 * Commits synthetic fixtures in that disposable database and leaves evidence.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const value=process.env.LOCAL_SQL_TEST_URL;
if(!value)throw Error('Set an explicit isolated LOCAL_SQL_TEST_URL. No environment file is loaded.');
const url=new URL(value);
if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.port!=='55439'
  ||!/^\/folio_test_m119_[a-z0-9_]+$/.test(url.pathname)||url.search||url.hash||value.includes('grkpayhxndztlfwxobnt'))throw Error('Only the existing PostgreSQL 16 loopback M119 test environment is allowed.');
const config={host:'127.0.0.1',port:55439,database:url.pathname.slice(1),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),ssl:false,connectionTimeoutMillis:5000,statement_timeout:15000,application_name:'folio-m119-synthetic-concurrency'};
const clients=[];
async function connect(){const client=new pg.Client(config);await client.connect();clients.push(client);return client;}
const admin=await connect();
const id=n=>'11900000-0000-4000-8000-'+String(n).padStart(12,'0');
const results=[];
async function actor(){const client=await connect();await client.query('BEGIN');await client.query('SET LOCAL ROLE authenticated');await client.query("SELECT set_config('test.reschedule_uid',$1,true)",[id(1)]);return client;}
function move(client,operation,original,start){return client.query('SELECT public.reschedule_turno_atomic($1,$2,$3,$4,30) AS result',[id(10),id(operation),id(original),start])
  .then(r=>({ok:true,data:r.rows[0].result}),error=>({ok:false,code:error.code}));}
async function waiting(client){
 const deadline=Date.now()+5000;
 while(Date.now()<deadline){
  const{rows:[row]}=await admin.query('SELECT wait_event FROM pg_stat_activity WHERE pid=$1',[client.processID]);
  if(row?.wait_event==='advisory')return;
  await new Promise(resolve=>setTimeout(resolve,25));
 }
 throw Error('Expected a real competing connection to wait on the advisory lock.');
}
async function state(original){const{rows:[row]}=await admin.query('SELECT estado FROM public.turno WHERE id=$1',[id(original)]);return row.estado;}
try {
 const{rows:[preflight]}=await admin.query(`SELECT current_database() AS database,host(inet_server_addr()) AS address,
  current_setting('server_version_num')::int AS version,to_regnamespace('folio_reschedule_private') IS NOT NULL AS ready,
  (SELECT count(*)::int FROM public.organization) AS organizations,(SELECT count(*)::int FROM auth.users) AS users`);
 if(preflight.database!==config.database||preflight.address!=='127.0.0.1'||preflight.version<160000||preflight.version>=170000||!preflight.ready||preflight.organizations!==0||preflight.users!==0)throw Error('Expected an empty, migrated, disposable M119 database with no users or organizations.');
 const seed=(await readFile(new URL('../sql/M119_reschedule_turno_atomic.spec.sql',import.meta.url),'utf8')).split('-- M119 CONCURRENCY SEED END');
 assert.equal(seed.length,2,'Explicit synthetic fixture delimiter missing');
 await admin.query(seed[0]);await admin.query('COMMIT');

 // Same operation: second connection really waits, then recovers the receipt.
 {
  const a=await actor(),b=await actor();
  const first=await move(a,400,100,'2026-11-10T12:00:00Z');assert.equal(first.ok,true);
  const pending=move(b,400,100,'2026-11-10T12:00:00Z');await waiting(b);await a.query('COMMIT');
  const second=await pending;assert.equal(second.ok,true);assert.equal(second.data.reused,true);assert.equal(second.data.nuevoTurnoId,first.data.nuevoTurnoId);await b.query('COMMIT');
  results.push({case:'simultaneous_same_operation',pass:true});
 }
 // Different intents for the same old appointment cannot both replace it.
 {
  const a=await actor(),b=await actor();
  assert.equal((await move(a,401,101,'2026-11-11T12:00:00Z')).ok,true);
  const pending=move(b,402,101,'2026-11-11T14:00:00Z');await waiting(b);await a.query('COMMIT');
  const second=await pending;assert.deepEqual(second,{ok:false,code:'55000'});await b.query('ROLLBACK');
  results.push({case:'competing_operations_same_original',pass:true});
 }
 // Different originals competing for one destination: loser keeps its visit.
 {
  const a=await actor(),b=await actor();
  assert.equal((await move(a,403,102,'2026-11-12T12:00:00Z')).ok,true);
  const pending=move(b,404,103,'2026-11-12T12:00:00Z');await waiting(b);await a.query('COMMIT');
  assert.deepEqual(await pending,{ok:false,code:'23P01'});await b.query('ROLLBACK');assert.equal(await state(103),'AGENDADO');
  results.push({case:'competing_originals_same_destination',pass:true});
 }
 // A legacy writer that ignores the agenda lock wins AFTER our slot precheck.
 // Pause BEFORE changing the original, after the slot precheck. Pausing after
 // UPDATE would artificially deadlock the competitor on M111's revision row.
 // The SQL spec separately injects failure after all writes and Google intents.
 await admin.query(`CREATE FUNCTION public.m119_test_pause_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.estado='REAGENDADO' AND current_setting('test.m119_pause',true)='true' THEN PERFORM pg_advisory_xact_lock(119,119);END IF;RETURN NEW;END $$;
  CREATE TRIGGER m119_test_pause BEFORE UPDATE OF estado ON public.turno FOR EACH ROW EXECUTE FUNCTION public.m119_test_pause_change();`);
 await admin.query('SELECT pg_advisory_lock(119,119)');
 const a=await actor();await a.query("SELECT set_config('test.m119_pause','true',true)");
 const pending=move(a,405,104,'2026-11-13T12:00:00Z');await waiting(a);
 const legacy=await connect();
 await legacy.query(`INSERT INTO public.turno(organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents,origen,estado)
 VALUES($1,$2,$3,$4,'2026-11-13T12:00:00Z',30,12345,'MANUAL','AGENDADO')`,[id(10),id(14),id(12),id(11)]);
 await admin.query('SELECT pg_advisory_unlock(119,119)');
 assert.deepEqual(await pending,{ok:false,code:'23P01'});await a.query('ROLLBACK');assert.equal(await state(104),'AGENDADO');
 await admin.query('DROP TRIGGER m119_test_pause ON public.turno;DROP FUNCTION public.m119_test_pause_change()');
 const{rows:[evidence]}=await admin.query(`SELECT
  (SELECT count(*)::int FROM folio_reschedule_private.receipt) AS receipts,
  (SELECT count(*)::int FROM public.turno WHERE organization_id=$1) AS visits,
  (SELECT desired_version::int FROM public.google_outbound_job WHERE turno_id=$2) AS original_google_version,
  (SELECT delivery_state FROM public.recordatorio_job WHERE turno_id=$2) AS original_reminder`,[id(10),id(104)]);
 assert.deepEqual(evidence,{receipts:3,visits:10,original_google_version:1,original_reminder:'pending'});
 results.push({case:'legacy_writer_wins_after_precheck_entire_change_rolls_back',pass:true});
 console.log(JSON.stringify({passed:results.length,results,evidence,scope:'local PostgreSQL transactions; Auth stubs; no hosted services or providers'},null,2));
} finally {
 await admin.query('SELECT pg_advisory_unlock_all()').catch(()=>{});
 await Promise.allSettled(clients.map(client=>client.end()));
}
