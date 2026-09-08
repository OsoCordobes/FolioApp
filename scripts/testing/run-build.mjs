import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {safeEnvironment} from './isolation-policy.mjs';
const require=createRequire(import.meta.url),config={mode:'build',appUrl:'http://127.0.0.1:4410',supabaseUrl:'http://127.0.0.1:54321'};
const env={...safeEnvironment(process.env,config),FOLIO_TEST_APP_CONFIG:JSON.stringify(config),NODE_OPTIONS:`--import=${new URL('./app-bootstrap.mjs',import.meta.url).href}`};
const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'build','--turbopack'],{stdio:'inherit',env});
child.on('error',()=>{process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});
