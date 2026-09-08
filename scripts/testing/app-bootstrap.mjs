import {installIsolation} from './install-isolation.mjs';
import {safeEnvironment} from './isolation-policy.mjs';
import {testAppConfig} from './app-config.mjs';
installIsolation();
const source=process.env.FOLIO_TEST_APP_CONFIG?JSON.parse(process.env.FOLIO_TEST_APP_CONFIG):null;
// Next's dev server handshakes through an IPC worker. Keep only its boolean
// runtime selectors in actual children; clearing NEXT_PRIVATE_WORKER makes the
// child exit before reporting readiness. Never preserve arbitrary NEXT_* envs.
const workerEnv={};
if(source&&typeof process.send==='function')for(const key of ['NEXT_PRIVATE_WORKER','TURBOPACK'])if(process.env[key]==='1')workerEnv[key]='1';
const config=source?{...testAppConfig({E2E_BASE_URL:source.appUrl,FOLIO_TEST_SUPABASE_URL:source.realSupabase?source.supabaseUrl:undefined,FOLIO_TEST_SUPABASE_ANON_KEY:source.anonKey,FOLIO_TEST_SUPABASE_SERVICE_KEY:source.serviceKey,FOLIO_TEST_DATABASE_URL:source.databaseUrl,FOLIO_TEST_LOGIN_EMAIL:source.email,FOLIO_TEST_LOGIN_PASSWORD:source.password,FOLIO_TEST_BOOKING_SLUG:source.bookingSlug,FOLIO_TEST_PROTOTYPE_ROOT:source.prototypeRoot}),mode:source.mode==='build'?'build':'app'}:testAppConfig(process.env);
// Revalidate encoded child configuration rather than trusting an inherited flag.
const clean=safeEnvironment(process.env,config);
for(const key of Object.keys(process.env))delete process.env[key];
Object.assign(process.env,clean,workerEnv,{FOLIO_TEST_APP_CONFIG:JSON.stringify(config),NODE_OPTIONS:`--import=${import.meta.url}`,E2E_BASE_URL:config.appUrl,FOLIO_TEST_REAL_SUPABASE:config.realSupabase?'1':'0'});
if(config.realSupabase){if(config.email)process.env.E2E_LOGIN_EMAIL=config.email;if(config.password)process.env.E2E_LOGIN_PASSWORD=config.password;if(config.bookingSlug)process.env.E2E_BOOKING_SLUG=config.bookingSlug;}
if(config.prototypeRoot)process.env.FOLIO_TEST_PROTOTYPE_ROOT=config.prototypeRoot;
