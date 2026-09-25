// GitHub-hosted, disposable B03 integration job. Never invoke on a local machine.
import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {Client} from 'pg';
import {assertFreshReceptionDatabase,assertReceptionPolicies,receptionCiEnvironment,summarizeReceptionReport} from './reception-ci-contract.mjs';

const PROJECT_ID='folio-local-clinical';
const CLI_VERSION='2.99.0';
const expectedVersions=readdirSync('supabase/migrations').filter(name=>/^\d{14}_.+\.sql$/.test(name)).map(name=>name.slice(0,14)).sort();
const cliEnv=Object.fromEntries(['PATH','HOME','LANG','TMPDIR','CI'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
let stage='runner_guard',owned=false;

function command(program,args,env=cliEnv,timeout=900_000) {
 const result=spawnSync(program,args,{encoding:'utf8',env,timeout,maxBuffer:16*1024*1024});
 return {ok:!result.error&&result.status===0,output:result.stdout??'',exitCode:Number.isInteger(result.status)?result.status:null};
}

async function prepareDatabase(databaseUrl,sha) {
 const db=new Client({connectionString:databaseUrl,connectionTimeoutMillis:8000,statement_timeout:30000,application_name:'folio-reception-ci'});
 await db.connect();
 try {
  const {rows:[row]}=await db.query(`SELECT current_setting('server_version_num')::int AS version,
    to_regclass('auth.schema_migrations') IS NOT NULL AND to_regclass('auth.mfa_challenges') IS NOT NULL AS real_auth,
    to_regclass('storage.migrations') IS NOT NULL AS real_storage,
    NOT EXISTS(SELECT 1 FROM unnest($1::text[]) v WHERE NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations m WHERE m.version=v)) AS migrations_ready,
    (SELECT count(*) FROM public.organization WHERE NOT is_synthetic OR slug NOT LIKE 'folio-test-clinical-%') AS unsafe_organizations,
    (SELECT count(*) FROM auth.users WHERE coalesce(email,'') !~ '^folio-clinical-[a-z0-9-]+@example[.]test$') AS unsafe_auth_users,
    (SELECT count(*) FROM public.organization) AS organizations,
    (SELECT count(*) FROM auth.users) AS auth_users`,[expectedVersions]);
  const {rows:versions}=await db.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version');
  assertFreshReceptionDatabase(row,expectedVersions,versions.map(item=>item.version));
  if(Number(row.organizations)!==0||Number(row.auth_users)!==0)throw Error('not_fresh');
  stage='policy_activation';
  await db.query('BEGIN');
  try {
   const reason='Synthetic B03 reception CI: reviewed local-only clinical fixture';
   await db.query('SELECT public.mfa_enable_preparation($1)',[reason]);
   await db.query('SELECT public.mfa_set_staff_enforcement(now(),$1)',[reason]);
   await db.query('SELECT public.enable_clinical_attachments($1,$2,$3)',[reason,sha,'B03-RECEPTION-CI']);
   await db.query('SELECT public.enable_instrument_population_policy($1)',[reason]);
   await db.query('SELECT public.enable_session_atomic_writes($1)',[reason]);
   await db.query('SELECT public.enable_availability_revision($1)',[reason]);
   await db.query('SELECT public.consent_enable_reviewed_signatures($1)',[reason]);
   await db.query('SELECT public.enable_turno_atomic_close($1)',[reason]);
   await db.query('SELECT public.enable_payment_settlement_authority($1)',[reason]);
   await db.query('COMMIT');
  } catch(error) {await db.query('ROLLBACK');throw error;}
  const {rows:[policy]}=await db.query(`SELECT
    (SELECT application_ready FROM folio_mfa_private.policy WHERE singleton) AS mfa_ready,
    (SELECT staff_enforce_after IS NOT NULL AND staff_enforce_after<=now() FROM folio_mfa_private.policy WHERE singleton) AS mfa_enforced,
    (SELECT enabled FROM folio_attachments_private.policy WHERE singleton) AS attachments,
    (SELECT enabled_at IS NOT NULL FROM folio_instrument_private.population_policy WHERE singleton) AS population,
    (SELECT enabled_at IS NOT NULL FROM folio_session_private.policy WHERE singleton) AS sessions,
    (SELECT enabled_at IS NOT NULL FROM folio_availability_private.policy WHERE singleton) AS availability,
    (SELECT enforced FROM folio_consent_private.policy WHERE singleton) AS representatives,
    (SELECT enabled_at IS NOT NULL FROM folio_close_private.policy WHERE singleton) AS atomic_close,
    (SELECT enabled_at IS NOT NULL FROM folio_settlement_private.policy WHERE singleton) AS payment_settlement`);
  assertReceptionPolicies(policy);
 } finally {await db.end();}
}

async function main() {
 if(process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||process.env.GITHUB_EVENT_NAME!=='pull_request'
  ||process.platform!=='linux'||process.env.CI!=='true')throw Error('runner_guard');
 stage='cli_version';
 const version=command('supabase',['--version']);
 if(!version.ok||version.output.trim().split(/\r?\n/)[0]!==CLI_VERSION)throw Error('cli_version');
 stage='fresh_project';
 if(command('supabase',['status','--output','json']).ok)throw Error('project_already_running');
 stage='supabase_start';owned=true;
 const started=command('supabase',['start','--exclude','realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor','--yes'],cliEnv,1_200_000);
 if(!started.ok)throw Error('supabase_start');
 stage='supabase_status';
 const statusResult=command('supabase',['status','--output','json']);
 if(!statusResult.ok)throw Error('supabase_status');
 const status=JSON.parse(statusResult.output);
 const env=receptionCiEnvironment(status,{
  PATH:process.env.PATH,HOME:process.env.HOME,CI:'true',
  GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',GITHUB_EVENT_NAME:'pull_request',
 });
 stage='database_preflight';
 const sha=command('git',['rev-parse','HEAD']);
 if(!sha.ok||!(/^[a-f0-9]{40}$/).test(sha.output.trim()))throw Error('commit_sha');
 await prepareDatabase(env.FOLIO_TEST_DATABASE_URL,sha.output.trim());
 stage='browser';
 const browser=command(process.execPath,['scripts/testing/run-reception.mjs','--reporter=json'],env,900_000);
 let report;
 try {report=JSON.parse(browser.output);}catch{throw Error('browser_report_invalid');}
 const summary=summarizeReceptionReport(report);
 for(const item of summary.cases)console.log(`B03 role=${item.role} status=${item.status} source=${item.source}${item.line===null?'':` line=${item.line}`}`);
 if(!browser.ok||!summary.passed||summary.executed!==2)throw Error('browser_failed');
 console.log(`B03 reception PASS: roles=2 migrations=${expectedVersions.length} controls=9`);
}

try {await main();}
catch {console.error(`B03 reception FAIL: stage=${stage}`);process.exitCode=1;}
finally {
 if(owned) {
  stage='teardown';
  const stopped=command('supabase',['stop','--project-id',PROJECT_ID,'--no-backup'],cliEnv,120_000);
  if(!stopped.ok){console.error('B03 reception FAIL: stage=teardown');process.exitCode=1;}
 }
}
