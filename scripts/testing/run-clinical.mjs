// This command never starts Docker, Supabase, applies migrations, or reads .env.
import {spawn} from 'node:child_process';
import {testAppConfig} from './app-config.mjs';
import {clinicalConfig} from './clinical-config.mjs';
const env={...process.env,E2E_BASE_URL:process.env.E2E_BASE_URL??'http://localhost:4420',FOLIO_TEST_CLINICAL:'1'};
const config=testAppConfig(env);
clinicalConfig({...env,FOLIO_TEST_ISOLATED:'1',FOLIO_TEST_APP_CONFIG:JSON.stringify(config)}); // Full profile preflight before launching the browser/app runner.
const child=spawn(process.execPath,['scripts/testing/run-browser.mjs','--project=e2e','tests/e2e/clinical-path.spec.ts',...process.argv.slice(2)],{stdio:'inherit',env});
child.on('error',()=>{process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});
