/** Local PostgreSQL only. No env files; all fixtures are synthetic and retained. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

const url=new URL(process.env.LOCAL_SQL_TEST_URL ?? '');
if(!['postgres:','postgresql:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)
 ||!/^\/folio_test_[a-z0-9_]+$/.test(url.pathname)||url.search||url.hash)throw Error('Use a loopback folio_test_ database.');
const config={host:url.hostname.replace(/^\[|\]$/g,''),port:Number(url.port||5432),user:decodeURIComponent(url.username),
 password:decodeURIComponent(url.password),database:url.pathname.slice(1),ssl:false,connectionTimeoutMillis:5000,statement_timeout:10000};
const clients=[new pg.Client(config),new pg.Client(config),new pg.Client(config)];
await Promise.all(clients.map(c=>c.connect()));
const [a,b,observer]=clients;
const org=randomUUID(),profile=randomUUID(),member=randomUUID();
const marker=async()=>BigInt((await observer.query('SELECT value FROM folio_agenda_private.revision WHERE organization_id=$1',[org])).rows[0].value);
const insert=client=>client.query("INSERT INTO servicio(organization_id,nombre,tipo_canonico,duracion_min,precio_cents) VALUES($1,$2,'CONSULTA_INICIAL',30,100)",[org,`Synthetic ${randomUUID()}`]);
try{
 await observer.query("INSERT INTO auth.users(id,email) VALUES($1,$2)",[profile,`${profile}@spec.invalid`]);
 await observer.query("INSERT INTO profile(id,email,consent_pii_signed_at,consent_pii_text_version) VALUES($1,$2,now(),'test')",[profile,`${profile}@spec.invalid`]);
 await observer.query('INSERT INTO organization(id,slug,nombre,is_internal_account) VALUES($1,$2,$3,true)',[org,`m111-${org}`,'Synthetic concurrency']);
 await observer.query("INSERT INTO member(id,organization_id,profile_id,role,accepted_at) VALUES($1,$2,$3,'OWNER',now())",[member,org,profile]);
 const initial=await marker();
 await a.query('BEGIN');await b.query('BEGIN');
 await insert(a);
 assert.equal(await marker(),initial,'uncommitted changes cannot advance public marker');
 const pending=insert(b);
 // Observe a real DB lock wait, rather than treating an arbitrary sleep as proof.
 let blocked=false;
 for(let attempt=0;attempt<100;attempt++){
  const {rows}=await observer.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[b.processID]);
  if(rows[0]?.wait_event_type==='Lock'){blocked=true;break;}
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 assert.equal(blocked,true,'second writer must serialize the same organization counter');
 await a.query('COMMIT');await pending;await b.query('COMMIT');
 assert.equal(await marker(),initial+2n,'both committed writes advance exactly once without lost increments');
 await a.query('BEGIN');await insert(a);await a.query('ROLLBACK');
 assert.equal(await marker(),initial+2n,'rollback does not advance marker');
 const started=performance.now();
 await a.query('BEGIN');
 for(let i=0;i<100;i++)await insert(a);
 await a.query('COMMIT');
 const writeMs=performance.now()-started;
 assert.equal(await marker(),initial+102n);
 // Match the SQL specs: replace the vanilla Auth stub transactionally and
 // restore it on disconnect/rollback. This never calls a real Auth service.
 await observer.query('BEGIN');
 await observer.query("CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.m111_uid',true),'')::uuid $$");
 await observer.query("SELECT set_config('test.m111_uid',$1,true)",[profile]);
 const uid=(await observer.query('SELECT auth.uid() uid')).rows[0].uid;
 assert.equal(uid,profile,'local Auth fixture must resolve the synthetic user');
 await observer.query('SET LOCAL ROLE authenticated');
 const readStarted=performance.now();
 for(let i=0;i<100;i++)assert.equal((await observer.query("SELECT split_part(public.read_agenda_revision($1),':',1) value",[org])).rows[0].value,(initial+102n).toString());
 console.log(JSON.stringify({ok:true,checks:['uncommitted-hidden','two-writer-lock','no-lost-increment','rollback','100-writes','100-authenticated-reads'],write100Ms:Math.round(writeMs),read100Ms:Math.round(performance.now()-readStarted),fixtureOrganization:org}));
}finally{
 await Promise.allSettled(clients.map(async c=>{await c.query('ROLLBACK');await c.end();}));
}
