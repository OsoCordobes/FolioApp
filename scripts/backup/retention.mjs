import { lstat, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileDigest } from "./envelope.mjs";
export function backupStatus(last, now = new Date()) {
  const age = last?.completedAt
    ? now.getTime() - Date.parse(last.completedAt)
    : Infinity;
  const stale = !Number.isFinite(age) || age < 0 || age > 86400000;
  return {
    stale,
    catchUp: stale,
    ageHours: Number.isFinite(age) ? Math.max(0, age / 3600000) : null,
  };
}
export function chooseRetention(rows) {
  const sorted = [...rows].sort(
    (a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt),
  );
  const days = new Set(),
    weeks = new Set(),
    keep = new Set();
  for (const row of sorted) {
    const d = new Date(row.completedAt);
    const day = d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const week = d.toISOString().slice(0, 10);
    if (days.size < 7 && !days.has(day)) {
      days.add(day);
      keep.add(row.id);
    }
    if (weeks.size < 4 && !weeks.has(week)) {
      weeks.add(week);
      keep.add(row.id);
    }
  }
  if (sorted[0]) keep.add(sorted[0].id);
  return keep;
}
export async function validateReceipt(dir) {
  const directoryState = await lstat(dir);
  const receiptState = await lstat(path.join(dir, "receipt.json"));
  if (!directoryState.isDirectory() || directoryState.isSymbolicLink() ||
      !receiptState.isFile() || receiptState.isSymbolicLink())
    throw new Error("backup_receipt_invalid");
  const receipt = JSON.parse(
    await readFile(path.join(dir, "receipt.json"), "utf8"),
  );
  if (
    receipt.version !== 1 ||
    receipt.complete !== true ||
    !/^backup_[a-zA-Z0-9_-]+$/.test(receipt.id) ||
    !Array.isArray(receipt.files) ||
    receipt.files.length < 4 ||
    receipt.id !== path.basename(path.resolve(dir)) ||
    !Number.isFinite(Date.parse(receipt.startedAt)) ||
    !Number.isFinite(Date.parse(receipt.completedAt)) ||
    Date.parse(receipt.completedAt) < Date.parse(receipt.startedAt)
  )
    throw new Error("backup_receipt_invalid");
  const names = new Set(receipt.files.map((f) => f?.file));
  if (names.size !== receipt.files.length || !names.has("manifest.sealed") ||
      !["artifact_0.sealed", "artifact_1.sealed", "artifact_2.sealed"].every((file) => names.has(file)))
    throw new Error("backup_receipt_invalid");
  // A truncated receipt cannot silently omit an on-disk archive. Require the
  // complete contiguous inventory emitted by createBackup before retention.
  for (let i = 0; i < names.size - 1; i++)
    if (!names.has(`artifact_${i}.sealed`)) throw new Error("backup_receipt_invalid");
  const disk = await readdir(dir);
  if (disk.length !== names.size + 1 || disk.some((file) => file !== "receipt.json" && !names.has(file)))
    throw new Error("backup_integrity_failed");
  for (const f of receipt.files) {
    const state = await lstat(path.join(dir, f.file));
    if (
      !/^(artifact_\d+|manifest)\.sealed$/.test(f.file) ||
      !/^[a-f0-9]{64}$/.test(f.sha256) || !state.isFile() || state.isSymbolicLink() ||
      (await fileDigest(path.join(dir, f.file))) !== f.sha256
    )
      throw new Error("backup_integrity_failed");
  }
  return receipt;
}
export async function rotateBackups(root, {eligible} = {}) {
  const valid = [];
  for (const dir of await readdir(root, { withFileTypes: true })) {
    if (dir.isDirectory() && /^backup_/.test(dir.name)) {
      try {
        const receipt = await validateReceipt(path.join(root, dir.name));
        if (eligible && !await eligible(path.join(root,dir.name))) continue;
        if (receipt.id === dir.name) valid.push(receipt);
      } catch {
        /* Invalid copies are never counted or erased automatically. */
      }
    }
  }
  const keep = chooseRetention(valid);
  const removed = [];
  for (const receipt of valid) {
    if (keep.has(receipt.id)) continue;
    const target = path.resolve(root, receipt.id);
    if (path.dirname(target) !== path.resolve(root))
      throw new Error("backup_path_invalid");
    // Owner rotation requires a current linked AEAD record again immediately
    // before deletion. Unknown/legacy packages are preserved for manual review.
    if (eligible) {
      try { if (!await eligible(target)) continue; }
      catch { continue; }
    }
    await rm(target, { recursive: true });
    removed.push(receipt.id);
  }
  return { kept: keep.size, removed: removed.length };
}
export async function writeAtomicJson(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporary, file);
}
