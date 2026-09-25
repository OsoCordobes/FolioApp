import assert from "node:assert/strict";
import test from "node:test";
import { putVerifiedFragment, type PrivateFragmentStore } from "../../lib/patient/export-jobs-storage";

const job = "13600000-0000-4000-8000-000000000001";
const entry = "13600000-0000-4000-8000-000000000002";

test("new upload and identical lost-response replay require readback", async () => {
  const objects = new Map<string, Uint8Array>();
  let writes = 0, reads = 0;
  const store: PrivateFragmentStore = {
    upload: async (path, bytes) => { writes++; if (objects.has(path)) return false; objects.set(path, bytes); return true; },
    download: async path => { reads++; return objects.get(path) ?? null; },
  };
  const bytes = Buffer.from("private fragment");
  const first = await putVerifiedFragment(store, job, entry, 0, bytes);
  const second = await putVerifiedFragment(store, job, entry, 0, bytes);
  assert.deepEqual(first, second);
  assert.equal(writes, 2);
  assert.equal(reads, 2);
  assert.equal(first.path, `${job}/${entry}/00000.bin`);
});

test("different replay, missing object and mutated readback fail closed", async () => {
  const bytes = Buffer.from("expected");
  const existing: PrivateFragmentStore = {
    upload: async () => false, download: async () => Buffer.from("different"),
  };
  await assert.rejects(() => putVerifiedFragment(existing, job, entry, 0, bytes));
  await assert.rejects(() => putVerifiedFragment({ upload: async () => { throw Error("lost response"); }, download: async () => null }, job, entry, 0, bytes));
  const recovered = await putVerifiedFragment({ upload: async () => { throw Error("lost response"); }, download: async () => bytes }, job, entry, 0, bytes);
  assert.equal(recovered.bytes, bytes.byteLength);
  await assert.rejects(() => putVerifiedFragment({ upload: async () => true, download: async () => null }, job, entry, 0, bytes));
  await assert.rejects(() => putVerifiedFragment({ upload: async () => true, download: async () => Buffer.from("changed") }, job, entry, 0, bytes));
});
