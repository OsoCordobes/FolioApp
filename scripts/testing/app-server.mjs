// The app bootstrap removes inherited credentials and blocks .env* before Next loads.
import './app-bootstrap.mjs';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const url=new URL(process.env.E2E_BASE_URL);
const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','--turbopack','--hostname','127.0.0.1','--port',url.port],{stdio:'inherit',env:process.env});
child.on('error',()=>{process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
