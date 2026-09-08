import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireBackupLock } from './lock.mjs';
import { resolveOutsideRepository } from './paths.mjs';
import { rotateBackups, validateReceipt, writeAtomicJson } from './retention.mjs';
import { verifyBackup } from './restore.mjs';
import { fileDigest } from './envelope.mjs';

export const OWNER_ROOT = 'C:\\Users\\amiun\\folio-recovery\\initial-20260908-182017';
export const CATCH_UP_HOURS = 20;
const repository = fileURLToPath(new URL('../../', import.meta.url));
const idPattern = /^backup_[a-zA-Z0-9_-]+$/;
const fixedFlags = { platformConfigurationComplete: false, restorationProven: false, ownerCustodyPending: true };
export async function validateOwnedRoot(root, expected = OWNER_ROOT) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || root.startsWith('\\\\') || root.includes('"')) throw Error('owned_path_invalid');
  const equal = (a,b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (!equal(path.resolve(root),path.resolve(expected))) throw Error('owned_path_invalid');
  const resolved = await resolveOutsideRepository(root,repository);
  if (!equal(resolved,await realpath(expected))) throw Error('owned_path_invalid');
  // Reject junctions/reparse aliases before using this root for retention.
  for (let current = path.resolve(root);;) {
    const state = await lstat(current);
    if (state.isSymbolicLink() || !state.isDirectory()) throw Error('owned_path_invalid');
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
  const destination = path.join(resolved,'database-checkpoints');
  const state = await lstat(destination);
  if (!state.isDirectory() || state.isSymbolicLink()) throw Error('owned_path_invalid');
  return resolved;
}
async function metadata(file) {
  const state = await lstat(file);
  if (!state.isFile() || state.isSymbolicLink() || state.size > 65536) throw Error('owned_metadata_invalid');
  return JSON.parse(await readFile(file,'utf8'));
}
/** A saved AEAD result applies only to the exact receipt and ciphertext inventory
 * checked then. Legacy summaries remain on disk but cannot certify today's bytes. */
export async function recordedOwnedReceipt(directory) {
  const receipt = await validateReceipt(directory);
  const summary = await metadata(path.join(path.dirname(directory),`${receipt.id}-verification.json`));
  if (summary.id !== receipt.id || summary.authenticated !== true || summary.complete !== true ||
      summary.verificationVersion !== 2 || !/^[a-f0-9]{64}$/.test(summary.receiptSha256 ?? '') ||
      summary.receiptSha256 !== await fileDigest(path.join(directory,'receipt.json')) ||
      summary.completedAt !== new Date(receipt.completedAt).toISOString()) throw Error('owned_metadata_invalid');
  return {receipt,summary};
}
export function validateOwnedCheckpointId(checkpointId) {
  if (typeof checkpointId !== 'string' || !/^backup_[0-9]{8}T[0-9]{9}Z_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(checkpointId)) throw Error('owned_path_invalid');
  return checkpointId;
}
/** Local verification only: no source, restore, retention, last-success update,
 * plaintext file or provider. expectedRoot/verify are synthetic test seams;
 * the executable never accepts overrides for either. */
export async function verifyExistingOwned({root,checkpointId,privateKey,passphrase,expectedRoot=OWNER_ROOT,verify=verifyBackup}) {
  validateOwnedCheckpointId(checkpointId);
  root=await validateOwnedRoot(root,expectedRoot);
  const destination=path.join(root,'database-checkpoints'),directory=path.join(destination,checkpointId);
  if(path.dirname(directory)!==destination)throw Error('owned_path_invalid');
  const ownerLease=await acquireBackupLock(root);
  try {
    const destinationLease=await acquireBackupLock(destination);
    try {
      // validateReceipt rejects symlinks and authenticates its complete file inventory.
      const receipt=await validateReceipt(directory);
      const receiptSha256=await fileDigest(path.join(directory,'receipt.json'));
      const note=path.join(destination,`${checkpointId}-verification.json`);
      let previous=null;
      try { previous=await metadata(note); } catch(error) { if(error.code!=='ENOENT')throw error; }
      if(previous && previous.id!==checkpointId)throw Error('owned_metadata_invalid');
      const manifest=await verify(directory,privateKey,{passphrase});
      if(receiptSha256!==await fileDigest(path.join(directory,'receipt.json')) || manifest.id!==checkpointId ||
         Date.parse(manifest.startedAt)!==Date.parse(receipt.startedAt) || Date.parse(manifest.completedAt)!==Date.parse(receipt.completedAt))throw Error('owned_metadata_invalid');
      // Recheck bytes after the complete AEAD pass, before publishing its evidence.
      await validateReceipt(directory);
      if(receiptSha256!==await fileDigest(path.join(directory,'receipt.json')))throw Error('owned_metadata_invalid');
      const completedAt=new Date(manifest.completedAt).toISOString();
      const summary={id:checkpointId,complete:true,authenticated:true,verificationVersion:2,receiptSha256,completedAt,
        checkedAt:new Date().toISOString(),verificationOnly:true,retentionApplied:false,retentionPending:previous?.retentionPending===true,
        ...fixedFlags,productionWrites:0,artifacts:manifest.artifacts.map(a=>({kind:a.kind,bytes:a.bytes}))};
      // The existing summary is replaced only after every artifact passed. The
      // receipt, immutable package and capture date remain byte-for-byte unchanged.
      await writeAtomicJson(note,summary);
      return {...await ownedStatus(root),action:'verified_existing',verifiedBackup:{id:checkpointId,completedAt}};
    } finally { await destinationLease.release(); }
  } finally { await ownerLease.release(); }
}
/** Read-only: no DPAPI, private key, recovered environment or network. A saved
 * AEAD verification is historical evidence, not a fresh decryption assertion. */
export async function ownedStatus(root, now = new Date()) {
  const destination = path.join(root,'database-checkpoints');
  let last = null, incomplete = false;
  for (const name of await readdir(destination)) {
    if (name.startsWith('.incomplete_')) incomplete = true;
    if (!name.endsWith('-verification.json')) continue;
    const id = name.slice(0,-'-verification.json'.length);
    if (!idPattern.test(id)) continue;
    try {
      try { await lstat(path.join(destination,id)); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; } // Retention preserves historical verification notes.
      const {receipt,summary} = await recordedOwnedReceipt(path.join(destination,id));
      if (summary.retentionPending === true) incomplete = true;
      if (!last || Date.parse(receipt.completedAt) > Date.parse(last.completedAt)) last = { id, completedAt: new Date(receipt.completedAt).toISOString() };
    } catch { incomplete = true; }
  }
  try {
    const index = await metadata(path.join(destination,'last-success.json'));
    if (index.id !== last?.id) incomplete = true;
  } catch { incomplete = true; }
  const elapsed = last ? now.getTime()-Date.parse(last.completedAt) : null;
  const clockInvalid = !Number.isFinite(now.getTime()) || (elapsed !== null && elapsed < 0);
  return { status: clockInvalid ? 'clock_invalid' : !last ? 'no_verified_checkpoint' : incomplete ? 'verification_attention' : 'verified_checkpoint_recorded',
    lastBackup: last, ageHours: elapsed === null || clockInvalid ? null : elapsed/3600000,
    catchUpDue: !clockInvalid && (elapsed === null || elapsed >= CATCH_UP_HOURS*3600000), ...fixedFlags };
}
/** The owner-root lease covers the decision, capture and post-AEAD retention.
 * createBackup also takes its existing destination lease. No timer evicts either. */
export async function runOwnedWorkflow({root, catchUp = false, now = () => new Date(), capture, status = ownedStatus}) {
  const lock = await acquireBackupLock(root);
  try {
    const before = await status(root,now());
    if (before.status === 'clock_invalid') throw Error('owned_clock_invalid');
    if (catchUp && !before.catchUpDue) return { ...before, action: 'not_due' };
    await capture();
    return { ...await status(root,now()), action: 'captured' };
  } finally { await lock.release(); }
}
/** Must be called only after createBackup({rotate:false}). The destination lease
 * prevents another publisher/retention run during authentication and rotation. */
export async function authenticateAndRetain({destination,result,privateKey,passphrase,verify = verifyBackup,rotate = (root) => rotateBackups(root,{eligible:async directory=>{await recordedOwnedReceipt(directory);return true;}})}) {
  if (!idPattern.test(result.id)) throw Error('owned_metadata_invalid');
  const lock = await acquireBackupLock(destination);
  try {
    const directory = path.join(destination,result.id);
    const receipt = await validateReceipt(directory);
    const receiptSha256 = await fileDigest(path.join(directory,'receipt.json'));
    const manifest = await verify(directory,privateKey,{passphrase});
    if (receiptSha256 !== await fileDigest(path.join(directory,'receipt.json')) ||
        Date.parse(manifest.startedAt) !== Date.parse(receipt.startedAt) ||
        Date.parse(manifest.completedAt) !== Date.parse(receipt.completedAt)) throw Error('owned_metadata_invalid');
    const summary = {...result, verificationVersion:2,receiptSha256,completedAt:new Date(manifest.completedAt).toISOString(),authenticated:true, ...fixedFlags, productionWrites:0, retentionPending:true, checkedAt:new Date().toISOString(),
      artifacts:manifest.artifacts.map(a=>({kind:a.kind,bytes:a.bytes}))};
    await writeFile(path.join(destination,`${result.id}-verification.json`),JSON.stringify(summary,null,2),{flag:'wx',mode:0o600});
    // Never run retention before the new package has passed complete AEAD verification.
    let retention;
    try { retention = await rotate(destination); }
    catch { throw Error('owned_retention_failed'); }
    const completed = {...summary,retentionPending:false,retention};
    await writeAtomicJson(path.join(destination,`${result.id}-verification.json`),completed);
    return completed;
  } finally { await lock.release(); }
}

export function ownedFailure(error) {
  if (/already_running|legacy_capture_running/.test(error?.message ?? '')) return {status:'already_running',exitCode:10};
  if (error?.message === 'owned_clock_invalid') return {status:'clock_invalid',exitCode:11};
  if (error?.message === 'owned_retention_failed') return {status:'retention_failed',exitCode:22};
  if (/owned_path_|backup_destination_/.test(error?.message ?? '')) return {status:'configuration_invalid',exitCode:12};
  return {status:'checkpoint_incomplete',exitCode:20};
}
