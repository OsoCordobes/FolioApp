// Only the automated recovery tests use this preload. Manual custody/capture
// scripts retain their separate, explicitly approved operating contract.
import {installIsolation} from './install-isolation.mjs';
import {safeEnvironment,assertLocalDatabase} from './isolation-policy.mjs';
installIsolation();
const local=process.env.FOLIO_RUN_LOCAL_BACKUP_REHEARSAL==='1';
const database=process.env.FOLIO_BACKUP_TEST_ADMIN_URL;
if(local){if(!database)throw Error('Dedicated local backup fixture URL required.');assertLocalDatabase(database);}
const clean=safeEnvironment(process.env,{mode:'unit'});
for(const key of Object.keys(process.env))delete process.env[key];
Object.assign(process.env,clean,{NODE_OPTIONS:`--import=${import.meta.url}`});
if(local)Object.assign(process.env,{FOLIO_RUN_LOCAL_BACKUP_REHEARSAL:'1',FOLIO_BACKUP_TEST_ADMIN_URL:database});
