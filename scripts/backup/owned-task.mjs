import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateOwnedRoot, ownedStatus, ownedFailure, verifyExistingOwned, validateOwnedCheckpointId } from './owned-workflow.mjs';
try {
  const [mode, requestedRoot, confirmation, ...extra] = process.argv.slice(2);
  if (!['Status','CatchUp','VerifyExisting'].includes(mode) || extra.length ||
      (mode === 'Status' ? confirmation !== undefined : mode === 'CatchUp' ? confirmation !== '--capture-owner-production-read-only' : !confirmation)) throw Error('owned_path_invalid');
  const root = await validateOwnedRoot(requestedRoot);
  if (mode === 'Status') console.log(JSON.stringify(await ownedStatus(root)));
  else if(mode==='VerifyExisting') {
    const checkpointId=validateOwnedCheckpointId(confirmation);
    const passphrase=process.env.FOLIO_RECOVERY_PASSPHRASE;
    delete process.env.FOLIO_RECOVERY_PASSPHRASE;
    const file=path.join(root,'recipient-private.encrypted.pem'),state=await lstat(file);
    if(!state.isFile()||state.isSymbolicLink()||state.size>65536)throw Error('owned_path_invalid');
    const privateKey=await readFile(file,'utf8');
    console.log(JSON.stringify(await verifyExistingOwned({root,checkpointId,privateKey,passphrase})));
  } else {
    const {captureOwned} = await import('./capture-owned.mjs');
    console.log(JSON.stringify(await captureOwned(root,{catchUp:true})));
  }
} catch (error) {
  const failure = ownedFailure(error);
  console.error(JSON.stringify({status:failure.status}));
  process.exitCode = failure.exitCode;
} finally { delete process.env.FOLIO_RECOVERY_PASSPHRASE; }
