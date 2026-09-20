import { createServer } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { writeAtomicJson } from './retention.mjs';

/** Exclusivity belongs to the OS, not the age of a file. A killed process
 * releases it automatically; a slow/live capture cannot be evicted by a timer.
 * This guards a directory on this PC, not a shared network destination. */
export async function acquireBackupLock(destination, {targetScope} = {}) {
  const directory = await realpath(destination);
  if (!path.isAbsolute(directory) || directory.startsWith('\\\\')) throw new Error('backup_local_destination_required');
  const canonical = process.platform === 'win32' ? directory.toLowerCase() : directory;
  if(targetScope!==undefined&&!/^storage-restore:[a-f0-9]{64}$/.test(targetScope))throw new Error('backup_lock_scope_invalid');
  // Restore exclusivity belongs to the target origin even if another process
  // chooses another journal directory. Capture keeps its canonical-root scope.
  const hash = createHash('sha256').update(targetScope??canonical).digest('hex');
  // Windows named pipes and Linux abstract sockets disappear with their owner.
  // The full hash keeps distinct Linux destinations out of the same 14-bit TCP
  // port. Other Unix systems retain the loopback-only port and fail closed.
  // Old Linux TCP leases and new abstract leases do not exclude each other:
  // stop old operators before rollout. All operators for a destination must
  // share a network namespace, not a volume mounted across isolated ones.
  const address = process.platform === 'win32'
    ? { path: `\\\\.\\pipe\\folio-backup-${hash}` }
    : process.platform === 'linux'
      ? { path: `\0folio-backup-${hash}` }
      : { host: '127.0.0.1', port: 49152 + (parseInt(hash.slice(0,8),16) % 16384), exclusive: true };
  const server = createServer(socket => socket.destroy());
  try {
    await new Promise((resolve,reject) => {
      server.once('error',reject);
      server.listen(address,resolve);
    });
  } catch {
    throw new Error('backup_capture_already_running_or_lock_unavailable');
  }
  const close = () => new Promise(resolve => server.close(() => resolve()));
  const ownerFile = path.join(directory,'.backup-owner.json');
  const id = randomUUID();
  try {
    // One-time compatibility with pre-lease directory locks. Only a proven
    // dead PID can be archived. Unknown/active legacy owners require review.
    const legacy = path.join(directory,'.backup.lock');
    let exists = false;
    try {
      const stat = await lstat(legacy);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('backup_legacy_lock_review_required');
      exists = true;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (exists) {
      const owner = JSON.parse(await readFile(path.join(legacy,'owner.json'),'utf8'));
      if (!Number.isSafeInteger(owner.pid) || owner.pid < 1 || owner.pid > 2147483647) throw new Error('backup_legacy_lock_review_required');
      try { process.kill(owner.pid,0); throw new Error('backup_legacy_capture_running'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
      const archived = path.join(directory,`.abandoned-lock-${id}`);
      if (path.dirname(legacy) !== directory || path.dirname(archived) !== directory) throw new Error('backup_path_invalid');
      await rename(legacy,archived);
    }
    await writeAtomicJson(ownerFile,{version:2,id,pid:process.pid,startedAt:new Date().toISOString()});
    let released = false;
    return {
      async release() {
        if (released) return;
        released = true;
        try {
          const owner = JSON.parse(await readFile(ownerFile,'utf8'));
          if (owner.id === id) await unlink(ownerFile);
        } catch { /* Diagnostic metadata is not the lock. Preserve unknown data. */ }
        finally { await close(); }
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
