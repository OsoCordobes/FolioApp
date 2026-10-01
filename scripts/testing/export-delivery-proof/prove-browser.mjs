import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from '@playwright/test';
import {guardBrowserContext,LOCAL_BROWSER_ARGS} from '../browser-network.mjs';
import {attachBrowserFailure,browserAssertion} from './browser-diagnostics.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

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
 let phase='launch',browser=null,failure=null;
 const archive=path.join(process.env.RUNNER_TEMP,`folio-synthetic-${randomUUID()}.tar`);
 try{
  browser=await chromium.launch({headless:true,args:LOCAL_BROWSER_ARGS});
  phase='context';
  const context=await browser.newContext({acceptDownloads:false,serviceWorkers:'block'});
  await guardBrowserContext(context);
  await context.addCookies(cookies.map(({name,value})=>({name,value,url:app})));
  const page=await context.newPage();
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
  phase='goto';
  const response=await page.goto(`${app}/archivo-clinico`,{waitUntil:'domcontentloaded',timeout:45_000});
  browserAssertion(response?.status()===200,'archive_page_unavailable');
  phase='prepare';
  await page.getByRole('button',{name:/Preparar o retomar entrega completa/}).first().click();
  phase='save_ready';
  await page.getByRole('button',{name:/Guardar historia y archivos/}).waitFor({timeout:45_000});
  phase='cookies';
  await page.getByRole('button',{name:'Solo esenciales'}).click();
  await page.getByRole('dialog',{name:'Cookies y privacidad'}).waitFor({state:'hidden'});
  const captures=path.join(process.env.RUNNER_TEMP,'folio-b06b3-ui');
  await mkdir(captures,{recursive:true});
  await page.setViewportSize({width:375,height:812});
  phase='mobile_width';
  browserAssertion(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),
   'archive_mobile_overflow');
  phase='mobile_capture';
  await page.screenshot({path:path.join(captures,'archive-375.png'),fullPage:true});
  phase='desktop_capture';
  await page.setViewportSize({width:1440,height:900});
  await page.screenshot({path:path.join(captures,'archive-1440.png'),fullPage:true});
  phase='save';
  await page.getByRole('button',{name:/Guardar historia y archivos/}).click();
  phase='complete_file';
  await page.getByRole('status').getByText(/Historia y archivos guardados/).waitFor({timeout:10*60_000});
  const file=await page.evaluate(async()=>{
   const root=await navigator.storage.getDirectory();
   const handle=await root.getFileHandle('synthetic-delivery.tar');
   const blob=await handle.getFile();
   const head=new Uint8Array(await blob.slice(0,512).arrayBuffer());
   const tail=new Uint8Array(await blob.slice(-1024).arrayBuffer());
   return {size:blob.size,name:new TextDecoder().decode(head.slice(0,9)),
    ustar:new TextDecoder().decode(head.slice(257,262)),ended:tail.every(byte=>byte===0)};
  });
  browserAssertion(file.size>50*1024*1024,'browser_file_not_50mib');
  browserAssertion(file.name==='LEEME.txt','browser_archive_name');
  browserAssertion(file.ustar==='ustar','browser_archive_magic');
  browserAssertion(file.ended===true,'browser_archive_not_closed');
  phase='archive_open';
  const output=await open(archive,'wx');
  const archiveHash=createHash('sha256');
  try{
   phase='archive_copy';
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
  phase='archive_list';
  const names=execFileSync('tar',['-tf',archive],{encoding:'utf8',maxBuffer:1024*1024})
   .trim().split(/\r?\n/);
  browserAssertion(names.includes('historia.json')&&names.includes(`documentos/${seed.document}.pdf`)&&
   names.includes('manifiesto.jsonl')&&names.includes('LEEME.txt'),'tar_entries_missing');
  browserAssertion(!names.some(name=>name.includes(seed.withdrawn)),'withdrawn_bytes_in_tar');
  phase='document_extract';
  const extracted=execFileSync('tar',['-xOf',archive,`documentos/${seed.document}.pdf`],
   {maxBuffer:52*1024*1024});
  browserAssertion(sha(extracted)===sha(seed.file),'independent_tar_document_mismatch');
  phase='signature_extract';
  const signature=execFileSync('tar',['-xOf',archive,`firmas/${seed.consent}-0.bin`],
   {maxBuffer:1024*1024});
  browserAssertion(sha(signature)===sha(seed.signature),'independent_tar_signature_mismatch');
  phase='json_extract';
  const json=execFileSync('tar',['-xOf',archive,'historia.json'],{maxBuffer:5*1024*1024});
  browserAssertion(Boolean(JSON.parse(json.toString('utf8')).historia_clinica),'independent_tar_json_invalid');
  phase='manifest_extract';
  const manifest=execFileSync('tar',['-xOf',archive,'manifiesto.jsonl'],
   {encoding:'utf8',maxBuffer:1024*1024});
  browserAssertion(/"status":"retirado_sin_bytes"/.test(manifest),'withdrawn_metadata_missing');
  phase='interrupt_enable';
  await page.evaluate(()=>{window.__folioAbortProof.enabled=true;});
  phase='interrupt_save';
  await page.getByRole('button',{name:/Guardar historia y archivos/}).click();
  phase='interrupt_ready';
  await page.getByRole('status').getByText(/archivo no se confirmó/).waitFor({timeout:10*60_000});
  phase='interrupt_state';
  const interrupted=await page.evaluate(()=>window.__folioAbortProof);
  browserAssertion(interrupted.written>=3*1024*1024,'interruption_before_partial_write');
  browserAssertion(interrupted.aborted===true,'interrupted_writer_not_aborted');
  phase='preserve_hash';
  const preserved=await hashOpfsFile(page);
  browserAssertion(preserved.size===file.size,'interruption_replaced_prior_file_size');
  browserAssertion(preserved.sha256===originalDigest,'interruption_replaced_prior_file_hash');
  phase='context_close';
  await context.close();
  phase='unsupported_context';
  const unsupported=await browser.newContext({serviceWorkers:'block'});
  await guardBrowserContext(unsupported);
  await unsupported.addCookies(cookies.map(({name,value})=>({name,value,url:app})));
  const missing=await unsupported.newPage();
  await missing.addInitScript(({patientId,userId,orgId,operationId})=>{
   sessionStorage.setItem(`folio.export-package.v1.${userId}.${orgId}.${patientId}`,operationId);
   Object.defineProperty(window,'showSaveFilePicker',{configurable:true,value:undefined});
  },{patientId:seed.patient,userId:seed.user,orgId:seed.org,operationId});
  phase='unsupported_goto';
  await missing.goto(`${app}/archivo-clinico`,{waitUntil:'domcontentloaded',timeout:45_000});
  phase='unsupported_prepare';
  await missing.getByRole('button',{name:/Preparar o retomar entrega completa/}).first().click();
  phase='unsupported_save_ready';
  await missing.getByRole('button',{name:/Guardar historia y archivos/}).waitFor({timeout:45_000});
  phase='unsupported_save';
  await missing.getByRole('button',{name:/Guardar historia y archivos/}).click();
  phase='unsupported_ready';
  await missing.getByRole('status').getByText(/no ofrece guardado seguro/).waitFor({timeout:15_000});
  phase='unsupported_close';
  await unsupported.close();
  phase='complete';
  console.log('b06b3_browser_opfs_writable_abort_preserved_and_unsupported_verified');
  return {archiveBytes:file.size,archiveSha256:originalDigest,
   elapsedSeconds:Math.ceil((Date.now()-started)/1000)};
 }catch(error){failure=error;throw attachBrowserFailure(error,phase);}
 finally{
  try{await browser?.close();}
  catch(error){if(!failure)throw attachBrowserFailure(error,'cleanup');}
 }
}
