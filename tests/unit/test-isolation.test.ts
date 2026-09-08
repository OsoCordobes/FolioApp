import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn,spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const bootstrap=pathToFileURL(resolve('scripts/testing/unit-bootstrap.mjs')).href;
function probe(source:string){const result=spawnSync(process.execPath,['--import',bootstrap,'--input-type=module','-e',source],{encoding:'utf8',timeout:15000,env:{...process.env,RESEND_API_KEY:'inherited-must-disappear',NEXT_PUBLIC_SUPABASE_URL:'https://grkpayhxndztlfwxobnt.supabase.co',FOLIO_ENC_KEY:'real-looking-inherited-value'}});assert.equal(result.status,0,result.stderr);return result.stdout;}
test('bootstrap removes inherited provider credentials and replaces crypto/Supabase with synthetic local values',()=>{probe(`import assert from 'node:assert/strict';assert.equal(process.env.RESEND_API_KEY,undefined);assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,'http://127.0.0.1:54321');assert.equal(Buffer.from(process.env.FOLIO_ENC_KEY,'base64').length,32);assert.notEqual(process.env.FOLIO_ENC_KEY,'real-looking-inherited-value');`);});
test('actual filesystem imports cannot read environment files or load dotenv',()=>{probe(`import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {readFile} from 'node:fs/promises';import dotenv from 'dotenv';assert.throws(()=>readFileSync('.env.local'),e=>e.testIsolation===true);await assert.rejects(()=>readFile('.env.production'),e=>e.testIsolation===true);assert.equal(dotenv.config({path:'.env.local',quiet:true}).error.testIsolation,true);`);});
test('actual fetch, HTTP, raw TCP and TLS imports reject external hosts before network I/O',()=>{probe(`import assert from 'node:assert/strict';import https from 'node:https';import net from 'node:net';import tls from 'node:tls';assert.throws(()=>fetch('https://api.resend.com/emails'),/disabled/);assert.throws(()=>https.request('https://api.mercadopago.com'),/disabled/);assert.throws(()=>net.connect({host:'grkpayhxndztlfwxobnt.supabase.co',port:5432}),/disabled/);assert.throws(()=>tls.connect({host:'oauth2.googleapis.com',port:443}),/disabled/);`);});
test('an actual provider SDK invocation is blocked, while a loopback synthetic fixture works',()=>{probe(`import assert from 'node:assert/strict';import http from 'node:http';import {Resend} from 'resend';const result=await new Resend('synthetic').emails.send({from:'test@invalid.test',to:'test@invalid.test',subject:'synthetic',html:'synthetic'});assert.ok(result.error);const server=http.createServer((req,res)=>res.end('synthetic'));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{const response=await fetch('http://127.0.0.1:'+server.address().port);assert.equal(await response.text(),'synthetic');}finally{server.close();}`);});


test('invoked app configuration rejects hosted targets, ordinary dev ports, production JWTs and unsafe database names',()=>{probe(`import assert from 'node:assert/strict';import {testAppConfig} from './scripts/testing/app-config.mjs';for(const value of ['https://foliosalud.com','https://127.0.0.1:4410','http://localhost:3010','http://127.0.0.1:4410/path'])assert.throws(()=>testAppConfig({E2E_BASE_URL:value}));assert.throws(()=>testAppConfig({FOLIO_TEST_SUPABASE_URL:'https://grkpayhxndztlfwxobnt.supabase.co'}));const jwt='header.'+Buffer.from(JSON.stringify({iss:'supabase',role:'service_role',ref:'grkpayhxndztlfwxobnt'})).toString('base64url')+'.signature';assert.throws(()=>testAppConfig({FOLIO_TEST_SUPABASE_URL:'http://127.0.0.1:54321',FOLIO_TEST_SUPABASE_ANON_KEY:jwt,FOLIO_TEST_SUPABASE_SERVICE_KEY:jwt}));assert.throws(()=>testAppConfig({FOLIO_TEST_DATABASE_URL:'postgres://test:test@127.0.0.1:5432/real_database'}));assert.equal(testAppConfig({}).appUrl,'http://127.0.0.1:4410');`);});

test('a local HTTP redirect cannot escape the server-side network guard',()=>{probe(`import assert from 'node:assert/strict';import http from 'node:http';const server=http.createServer((req,res)=>{res.writeHead(302,{Location:'https://api.resend.com/'});res.end();});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{await assert.rejects(()=>fetch('http://127.0.0.1:'+server.address().port));}finally{server.close();}`);});

test('Next environment loading respects the installed file guard before app imports',()=>{probe(`import assert from 'node:assert/strict';import {createRequire} from 'node:module';const require=createRequire(import.meta.url);const nextRequire=createRequire(require.resolve('next/package.json'));const {loadEnvConfig}=nextRequire('@next/env');const result=loadEnvConfig(process.cwd(),false,console,true);assert.deepEqual(result.loadedEnvFiles,[]);assert.equal(process.env.RESEND_API_KEY,undefined);`);});

test('actual browser and cleanup entrypoints reject hosted configuration before starting a server or DB connection',()=>{
 for(const [entry,env,args] of [
  ['scripts/testing/run-browser.mjs',{E2E_BASE_URL:'https://foliosalud.com'},['--list']],
  ['scripts/testing/run-browser.mjs',{E2E_BASE_URL:'http://127.0.0.1:3010'},['--list']],
  ['scripts/testing/run-browser.mjs',{FOLIO_TEST_SUPABASE_URL:'https://grkpayhxndztlfwxobnt.supabase.co'},['--list']],
  ['scripts/cleanup-e2e.mjs',{FOLIO_TEST_DATABASE_URL:'postgres://synthetic:synthetic@grkpayhxndztlfwxobnt.supabase.co/postgres'},[]],
 ] as const){
  const result=spawnSync(process.execPath,[entry,...args],{encoding:'utf8',timeout:15000,env:{...process.env,NODE_OPTIONS:'',...env}});
  assert.notEqual(result.status,0);assert.match(result.stderr,/FOLIO_TEST_ISOLATION/);
 }
});

test('app child bootstrap revalidates encoded configuration and removes inherited secrets',()=>{
 const appBootstrap=pathToFileURL(resolve('scripts/testing/app-bootstrap.mjs')).href;
 const run=(config:unknown,source:string)=>spawnSync(process.execPath,['--import',appBootstrap,'--input-type=module','-e',source],{encoding:'utf8',timeout:15000,env:{...process.env,NODE_OPTIONS:'',FOLIO_TEST_APP_CONFIG:JSON.stringify(config),RESEND_API_KEY:'must-disappear'}});
 const good=run({mode:'app',appUrl:'http://127.0.0.1:4410'},`import assert from 'node:assert/strict';assert.equal(process.env.RESEND_API_KEY,undefined);assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL,'http://127.0.0.1:54321');assert.equal(process.env.FOLIO_TEST_REAL_SUPABASE,'0');assert.throws(()=>fetch('https://api.resend.com'),/disabled/);`);
 assert.equal(good.status,0,good.stderr);
 const bad=run({mode:'app',appUrl:'https://foliosalud.com'},'throw Error("must not execute")');
 assert.notEqual(bad.status,0);assert.match(bad.stderr,/FOLIO_TEST_ISOLATION/);assert.doesNotMatch(bad.stderr,/Error: must not execute/);
});

test('actual IPC child retains only Next readiness selectors and still strips provider secrets',async()=>{
 const appBootstrap=pathToFileURL(resolve('scripts/testing/app-bootstrap.mjs')).href;
 const result=await new Promise<unknown>((resolveProbe,reject)=>{
  const child=spawn(process.execPath,['--import',appBootstrap,'--input-type=module','-e',`process.send({worker:process.env.NEXT_PRIVATE_WORKER,turbo:process.env.TURBOPACK,secret:process.env.RESEND_API_KEY,other:process.env.NEXT_PRIVATE_SECRET});process.disconnect();`],{stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,NODE_OPTIONS:'',FOLIO_TEST_APP_CONFIG:JSON.stringify({mode:'app',appUrl:'http://127.0.0.1:4410'}),NEXT_PRIVATE_WORKER:'1',TURBOPACK:'1',NEXT_PRIVATE_SECRET:'must-disappear',RESEND_API_KEY:'must-disappear'}});
  let received:unknown;child.on('message',value=>{received=value;});child.on('error',reject);child.on('exit',code=>code===0?resolveProbe(received):reject(Error(`IPC probe exited ${code}`)));
 });
 assert.deepEqual(result,{worker:'1',turbo:'1'});
});
