
export const PRODUCTION_PROJECT_REF='grkpayhxndztlfwxobnt';
export function assertLoopbackHost(host){
 const value=String(host??'localhost').replace(/^\[|\]$/g,'').toLowerCase();
 if(value!== 'localhost' && value!=='127.0.0.1' && value!=='::1')throw isolationError('External network is disabled in automated tests.');
 return value;
}
export function isolationError(message){const error=new Error(message);error.code='FOLIO_TEST_ISOLATION';return error;}
export function assertLocalUrl(value,protocols=['http:','https:']){
 let url;try{url=new URL(String(value));}catch{throw isolationError('A valid explicit local test URL is required.');}
 if(!protocols.includes(url.protocol)||String(value).includes(PRODUCTION_PROJECT_REF)||url.username||url.password)throw isolationError('Hosted or credential-bearing service URLs are not allowed in automated tests.');
 assertLoopbackHost(url.hostname);return url;
}
export function assertLocalDatabase(value){
 const url=new URL(value);if(!['postgres:','postgresql:'].includes(url.protocol)||String(value).includes(PRODUCTION_PROJECT_REF)||url.search||url.hash)throw isolationError('Only a dedicated local test database is allowed.');
 assertLoopbackHost(url.hostname);if(!/^\/(folio_test_[a-z0-9_]+|postgres)$/.test(url.pathname))throw isolationError('Use a named test database or the dedicated local Supabase database.');return url;
}
// IP literals must be loopback too; no DNS suffix or numeric-address shortcuts.
export function isLocalAddress(host){try{assertLoopbackHost(host);return true;}catch{return false;}}
export function safeEnvironment(source,config={mode:'unit'}){
 const preserved=new Set(['PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC','TMP','TEMP','HOME','USERPROFILE','HOMEDRIVE','HOMEPATH','LOCALAPPDATA','APPDATA','PROGRAMFILES','PROGRAMFILES(X86)','SYSTEMDRIVE','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','OS','CI','TZ','TERM','FORCE_COLOR','NO_COLOR','NODE_TEST_CONTEXT','NODE_CHANNEL_FD','NODE_UNIQUE_ID']);
 const env=Object.fromEntries(Object.entries(source).filter(([key])=>preserved.has(key.toUpperCase())));
 const supabase=config.supabaseUrl??'http://127.0.0.1:54321';assertLocalUrl(supabase);
 const app=config.appUrl??'http://127.0.0.1:4410';assertLocalUrl(app);
 if(config.databaseUrl)assertLocalDatabase(config.databaseUrl);
 Object.assign(env,{NODE_ENV:config.mode==='unit'?'test':config.mode==='build'?'production':'development',FOLIO_TEST_ISOLATED:'1',FOLIO_ENC_KEY:Buffer.alloc(32,37).toString('base64'),FOLIO_ENC_HMAC_KEY:Buffer.alloc(32,71).toString('base64'),NEXT_PUBLIC_SUPABASE_URL:supabase,NEXT_PUBLIC_SUPABASE_ANON_KEY:config.anonKey??'synthetic-local-anon-key',SUPABASE_SERVICE_ROLE_KEY:config.serviceKey??'synthetic-local-service-key',NEXT_PUBLIC_APP_URL:app,NEXT_TELEMETRY_DISABLED:'1'});
 if(config.databaseUrl)env.DATABASE_URL=config.databaseUrl;
 return env;
}
