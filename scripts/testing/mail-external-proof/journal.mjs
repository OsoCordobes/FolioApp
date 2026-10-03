import {writeFile,rename,open} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {sanitizedReceipt} from './contract.mjs';
async function syncDirectory(filename){
 // External execution is Linux only. Windows offline tests exercise file flush/rename.
 if(process.platform!=='linux')return;
 const directory=await open(path.dirname(filename),'r');try{await directory.sync();}finally{await directory.close();}
}
export async function openJournal(filename,receipt){
 await writeFile(filename,JSON.stringify(sanitizedReceipt(receipt)),{flag:'wx',mode:0o600,flush:true});await syncDirectory(filename);
 return async()=>{const next=filename+'.'+randomUUID();await writeFile(next,JSON.stringify(sanitizedReceipt(receipt)),{flag:'wx',mode:0o600,flush:true});await rename(next,filename);await syncDirectory(filename);};
}
