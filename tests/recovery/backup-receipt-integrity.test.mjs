import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {validateReceipt} from '../../scripts/backup/retention.mjs';

async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'folio-receipt-review-'));
 t.after(async()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('folio-receipt-review-'));await rm(root,{recursive:true,force:true});});
 const directory=path.join(root,'backup_review');await mkdir(directory);
 const files=[];
 for(const file of ['artifact_0.sealed','artifact_1.sealed','artifact_2.sealed','manifest.sealed']){const bytes=Buffer.from(`synthetic ciphertext ${file}`);await writeFile(path.join(directory,file),bytes);files.push({file,sha256:createHash('sha256').update(bytes).digest('hex')});}
 const receipt={version:1,id:'backup_review',complete:true,startedAt:'2026-09-08T00:00:00Z',completedAt:'2026-09-08T01:00:00Z',files};
 const save=async(value)=>writeFile(path.join(directory,'receipt.json'),JSON.stringify(value));await save(receipt);
 return {directory,receipt,save};
}

test('receipt rejects duplicate entries instead of counting a missing database as a valid recovery point',async(t)=>{
 const f=await fixture(t);await f.save({...f.receipt,files:[f.receipt.files[3],f.receipt.files[3],f.receipt.files[3]]});
 await assert.rejects(validateReceipt(f.directory),/backup_receipt_invalid|backup_integrity_failed/);
});
test('receipt rejects omitted manifest, missing essential archive and mismatched directory identity',async(t)=>{
 const f=await fixture(t);
 for(const value of [{...f.receipt,files:f.receipt.files.slice(0,3)},{...f.receipt,files:f.receipt.files.filter(x=>x.file!=='artifact_1.sealed')},{...f.receipt,id:'backup_someone_else'}]){await f.save(value);await assert.rejects(validateReceipt(f.directory),/backup_receipt_invalid|backup_integrity_failed/);}
});
test('receipt rejects invalid completion dates before retention sorting and accepts the complete file inventory',async(t)=>{
 const f=await fixture(t);assert.equal((await validateReceipt(f.directory)).id,'backup_review');
 for(const completedAt of [undefined,'bad-date','2026-09-07T00:00:00Z']){await f.save({...f.receipt,completedAt});await assert.rejects(validateReceipt(f.directory),/backup_receipt_invalid/);}
});
