// This command never starts Docker, Supabase, applies migrations, or reads .env.
import {spawn} from 'node:child_process';
import {testAppConfig} from './app-config.mjs';
const env={...process.env,FOLIO_TEST_CLINICAL:'1'};
testAppConfig(env); // Fail before launching a browser/app if local setup is absent.
const child=spawn(process.execPath,['scripts/testing/run-browser.mjs','--project=e2e','tests/e2e/clinical-path.spec.ts',...process.argv.slice(2)],{stdio:'inherit',env});
child.on('error',()=>{process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});
