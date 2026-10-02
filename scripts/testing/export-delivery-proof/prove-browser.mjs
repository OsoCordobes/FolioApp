import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from '@playwright/test';
import {guardBrowserContext,LOCAL_BROWSER_ARGS} from '../browser-network.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

const stages=new Set([
 'launch','archive_path','context_setup','picker_setup','archive_navigation','archive_preparation',
 'cookie_dialog','mobile_capture','desktop_capture','save_click','save_confirmation','opfs_read',
 'opfs_assertions','archive_open','archive_copy','tar_entries','tar_document','tar_signature',
 'tar_history','tar_manifest','interruption_setup','interruption_click','interruption_confirmation',
 'interruption_read','interruption_assertions','preserved_file_read','preserved_file_assertions',
 'context_close','unsupported_setup','unsupported_navigation','unsupported_preparation',
 'unsupported_click','unsupported_confirmation','unsupported_close','browser_close',
]);
const assertionCodes=new Set([
 'archive_page_unavailable','archive_mobile_overflow','browser_file_not_50mib',
 'browser_archive_name','browser_archive_magic','browser_archive_not_closed','tar_entries_missing',
 'withdrawn_bytes_in_tar','independent_tar_document_mismatch','independent_tar_signature_mismatch',
 'independent_tar_json_invalid','withdrawn_metadata_missing','interruption_before_partial_write',
 'interrupted_writer_not_aborted','interruption_replaced_prior_file_size',
 'interruption_replaced_prior_file_hash',
]);
const errorKinds=new Set(['Error','TimeoutError','AssertionError','TypeError','SyntaxError']);
const navigationStatuses=new Set([200,400,401,403,404,409,410,422,429,500,502,503,504]);
const safeProperty=(value,key)=>{try{return value?.[key];}catch{return undefined;}};

/** Closed schema: never serialize the error, its message, or browser/session data. */
export function browserFailureDiagnostic(stage,error,navigationStatus){
 const name=safeProperty(error,'name');
 const message=safeProperty(error,'message');
 const firstLine=typeof message==='string'?message.split('\n',1)[0]:undefined;
 return {
  schemaVersion:1,
  stage:stages.has(stage)?stage:'unknown',
  errorKind:errorKinds.has(name)?name:'unknown',
  assertCode:name==='AssertionError'&&safeProperty(error,'code')==='ERR_ASSERTION'&&
   assertionCodes.has(firstLine)?firstLine:null,
  navigationStatus:navigationStatuses.has(navigationStatus)?navigationStatus:null,
 };
}

/** Even a diagnostic write failure must preserve the original thrown value. */
export async function rethrowWithBrowserDiagnostic(error,stage,navigationStatus,writeDiagnostic){
 try{await writeDiagnostic(browserFailureDiagnostic(stage,error,navigationStatus));}
 catch{/* The proof's original failure has priority over diagnostic capture. */}
 throw error;
}

async function writeBrowserDiagnostic(diagnostic){
 const captures=path.join(process.env.RUNNER_TEMP,'folio-b06b3-ui');
 await mkdir(captures,{recursive:true});
 await writeFile(path.join(captures,'browser-failure.json'),`${JSON.stringify(diagnostic)}\n`,'utf8');
}

async function hashOpfsFile(page){
 const {size}=await page.evaluate(async()=>{
  const root=await navigator.storage.getDirectory();
  const handle=await root.getFileHandle('synthetic-delivery.tar');
  return {size:(await handle.getFile()).size};
 });
 const hash=createHash('sha256');
 for(let offset=0;offset<size;offset+=1024*1024){
  const encoded=await page.evaluate(async start=>{
   const root=await navigator.storage.getDirectory();
   const handle=await root.getFileHandle('synthetic-delivery.tar');
   const blob=await handle.getFile();
   const bytes=new Uint8Array(await blob.slice(start,start+1024*1024).arrayBuffer());
   let binary='';
   for(let cursor=0;cursor<bytes.length;cursor+=8192){
    binary+=String.fromCharCode(...bytes.subarray(cursor,cursor+8192));
   }
   return btoa(binary);
  },offset);
  hash.update(Buffer.from(encoded,'base64'));
 }
 return {size,sha256:hash.digest('hex')};
}

/** Uses Chromium's real FileSystemWritableFileStream via an OPFS handle.
 * Only the native picker dialog is substituted; no product route is mocked. */
export async function proveBrowser({app,seed,operationId,cookies}){
 const started=Date.now();
 let browser;
 let stage='launch';
 let navigationStatus;
 let failed=false;
 try{
  browser=await chromium.launch({headless:true,args:LOCAL_BROWSER_ARGS});
  stage='archive_path';
  const archive=path.join(process.env.RUNNER_TEMP,`folio-synthetic-${randomUUID()}.tar`);
  stage='context_setup';
  const context=await browser.newContext({acceptDownloads:false,serviceWorkers:'block'});
  await guardBrowserContext(context);
  await context.addCookies(cookies.map(({name,value})=>({name,value,url:app})));
  const page=await context.newPage();
  stage='picker_setup';
  await page.addInitScript(({patientId,userId,orgId,operationId})=>{
   sessionStorage.setItem(`folio.export-package.v1.${userId}.${orgId}.${patientId}`,operationId);
   window.__folioAbortProof={enabled:false,written:0,aborted:false};
   Object.defineProperty(window,'showSaveFilePicker',{configurable:true,value:async()=>{
    const root=await navigator.storage.getDirectory();
    const handle=await root.getFileHandle('synthetic-delivery.tar',{create:true});
    if(!window.__folioAbortProof.enabled)return handle;
    return {createWritable:async options=>{
     const stream=await handle.createWritable(options);
     return {
      write:async bytes=>{
       if(window.__folioAbortProof.written>=3*1024*1024)throw Error('synthetic_interruption');
       await stream.write(bytes);
       window.__folioAbortProof.written+=bytes.byteLength;
      },
      close:()=>stream.close(),
      abort:async()=>{window.__folioAbortProof.aborted=true;await stream.abort();},
     };
    }};
   }});
  },{patientId:seed.patient,userId:seed.user,orgId:seed.org,operationId});
  stage='archive_navigation';
  const response=await page.goto(`${app}/archivo-clinico`,{waitUntil:'domcontentloaded',timeout:45_000});
  navigationStatus=response?.status();
  assert.equal(response?.status(),200,'archive_page_unavailable');
  stage='archive_preparation';
  await page.getByRole('button',{name:/Preparar o retomar entrega completa/}).first().click();
  await page.getByRole('button',{name:/Guardar historia y archivos/}).waitFor({timeout:45_000});
  stage='cookie_dialog';
  await page.getByRole('button',{name:'Solo esenciales'}).click();
  await page.getByRole('dialog',{name:'Cookies y privacidad'}).waitFor({state:'hidden'});
  stage='mobile_capture';
  const captures=path.join(process.env.RUNNER_TEMP,'folio-b06b3-ui');
  await mkdir(captures,{recursive:true});
  await page.setViewportSize({width:375,height:812});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,
   'archive_mobile_overflow');
  await page.screenshot({path:path.join(captures,'archive-375.png'),fullPage:true});
  stage='desktop_capture';
  await page.setViewportSize({width:1440,height:900});
  await page.screenshot({path:path.join(captures,'archive-1440.png'),fullPage:true});
  stage='save_click';
  await page.getByRole('button',{name:/Guardar historia y archivos/}).click();
  stage='save_confirmation';
  await page.getByRole('status').getByText(/Historia y archivos guardados/).waitFor({timeout:10*60_000});
  stage='opfs_read';
  const file=await page.evaluate(async()=>{
   const root=await navigator.storage.getDirectory();
   const handle=await root.getFileHandle('synthetic-delivery.tar');
   const blob=await handle.getFile();
   const head=new Uint8Array(await blob.slice(0,512).arrayBuffer());
   const tail=new Uint8Array(await blob.slice(-1024).arrayBuffer());
   return {size:blob.size,name:new TextDecoder().decode(head.slice(0,9)),
    ustar:new TextDecoder().decode(head.slice(257,262)),ended:tail.every(byte=>byte===0)};
  });
  stage='opfs_assertions';
  assert.ok(file.size>50*1024*1024,'browser_file_not_50mib');
  assert.equal(file.name,'LEEME.txt','browser_archive_name');
  assert.equal(file.ustar,'ustar','browser_archive_magic');
  assert.equal(file.ended,true,'browser_archive_not_closed');
  stage='archive_open';
  const output=await open(archive,'wx');
  const archiveHash=createHash('sha256');
  try{
   stage='archive_copy';
   for(let offset=0;offset<file.size;offset+=1024*1024){
    const encoded=await page.evaluate(async start=>{
     const root=await navigator.storage.getDirectory();
     const handle=await root.getFileHandle('synthetic-delivery.tar');
     const blob=await handle.getFile();
     const bytes=new Uint8Array(await blob.slice(start,start+1024*1024).arrayBuffer());
     let binary='';
     for(let cursor=0;cursor<bytes.length;cursor+=8192){
      binary+=String.fromCharCode(...bytes.subarray(cursor,cursor+8192));
     }
     return btoa(binary);
    },offset);
    const part=Buffer.from(encoded,'base64');
    archiveHash.update(part);
    await output.write(part,0,part.length,offset);
   }
  }finally{await output.close();}
  const originalDigest=archiveHash.digest('hex');
  stage='tar_entries';
  const names=execFileSync('tar',['-tf',archive],{encoding:'utf8',maxBuffer:1024*1024})
   .trim().split(/\r?\n/);
  assert.ok(names.includes('historia.json')&&names.includes(`documentos/${seed.document}.pdf`)&&
   names.includes('manifiesto.jsonl')&&names.includes('LEEME.txt'),'tar_entries_missing');
  assert.equal(names.some(name=>name.includes(seed.withdrawn)),false,'withdrawn_bytes_in_tar');
  stage='tar_document';
  const extracted=execFileSync('tar',['-xOf',archive,`documentos/${seed.document}.pdf`],
   {maxBuffer:52*1024*1024});
  assert.equal(sha(extracted),sha(seed.file),'independent_tar_document_mismatch');
  stage='tar_signature';
  const signature=execFileSync('tar',['-xOf',archive,`firmas/${seed.consent}-0.bin`],
   {maxBuffer:1024*1024});
  assert.equal(sha(signature),sha(seed.signature),'independent_tar_signature_mismatch');
  stage='tar_history';
  const json=execFileSync('tar',['-xOf',archive,'historia.json'],{maxBuffer:5*1024*1024});
  assert.ok(JSON.parse(json.toString('utf8')).historia_clinica,'independent_tar_json_invalid');
  stage='tar_manifest';
  const manifest=execFileSync('tar',['-xOf',archive,'manifiesto.jsonl'],
   {encoding:'utf8',maxBuffer:1024*1024});
  assert.match(manifest,/"status":"retirado_sin_bytes"/,'withdrawn_metadata_missing');
  stage='interruption_setup';
  await page.evaluate(()=>{window.__folioAbortProof.enabled=true;});
  stage='interruption_click';
  await page.getByRole('button',{name:/Guardar historia y archivos/}).click();
  stage='interruption_confirmation';
  await page.getByRole('status').getByText(/archivo no se confirmó/).waitFor({timeout:10*60_000});
  stage='interruption_read';
  const interrupted=await page.evaluate(()=>window.__folioAbortProof);
  stage='interruption_assertions';
  assert.ok(interrupted.written>=3*1024*1024,'interruption_before_partial_write');
  assert.equal(interrupted.aborted,true,'interrupted_writer_not_aborted');
  stage='preserved_file_read';
  const preserved=await hashOpfsFile(page);
  stage='preserved_file_assertions';
  assert.equal(preserved.size,file.size,'interruption_replaced_prior_file_size');
  assert.equal(preserved.sha256,originalDigest,'interruption_replaced_prior_file_hash');
  stage='context_close';
  await context.close();
  stage='unsupported_setup';
  navigationStatus=undefined;
  const unsupported=await browser.newContext({serviceWorkers:'block'});
  await guardBrowserContext(unsupported);
  await unsupported.addCookies(cookies.map(({name,value})=>({name,value,url:app})));
  const missing=await unsupported.newPage();
  await missing.addInitScript(({patientId,userId,orgId,operationId})=>{
   sessionStorage.setItem(`folio.export-package.v1.${userId}.${orgId}.${patientId}`,operationId);
   Object.defineProperty(window,'showSaveFilePicker',{configurable:true,value:undefined});
  },{patientId:seed.patient,userId:seed.user,orgId:seed.org,operationId});
  stage='unsupported_navigation';
  await missing.goto(`${app}/archivo-clinico`,{waitUntil:'domcontentloaded',timeout:45_000});
  stage='unsupported_preparation';
  await missing.getByRole('button',{name:/Preparar o retomar entrega completa/}).first().click();
  await missing.getByRole('button',{name:/Guardar historia y archivos/}).waitFor({timeout:45_000});
  stage='unsupported_click';
  await missing.getByRole('button',{name:/Guardar historia y archivos/}).click();
  stage='unsupported_confirmation';
  await missing.getByRole('status').getByText(/no ofrece guardado seguro/).waitFor({timeout:15_000});
  stage='unsupported_close';
  await unsupported.close();
  console.log('b06b3_browser_opfs_writable_abort_preserved_and_unsupported_verified');
  return {archiveBytes:file.size,archiveSha256:originalDigest,
   elapsedSeconds:Math.ceil((Date.now()-started)/1000)};
 }catch(error){
  failed=true;
  await rethrowWithBrowserDiagnostic(error,stage,navigationStatus,writeBrowserDiagnostic);
 }finally{
  if(browser){
   try{await browser.close();}
   catch(error){
    if(!failed)await rethrowWithBrowserDiagnostic(error,'browser_close',navigationStatus,writeBrowserDiagnostic);
   }
  }
 }
}
