import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createBackup } from "../../scripts/backup/core.mjs";
import { restoreStorageLocal } from "../../scripts/backup/storage-restore.mjs";

const keys = generateKeyPairSync("rsa", {
  modulusLength: 3072,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const data = [
  Buffer.from("synthetic private first"),
  Buffer.from("synthetic private second"),
];
const objects = data.map((bytes, i) => ({
  bucket: "private-fixture",
  name: `nested/patient name ${i}.pdf`,
  id: `synthetic-${i}`,
  updatedAt: "2026-09-08T00:00:00Z",
  size: bytes.length,
  etag: null,
  metadata: { mimetype: "application/pdf" },
}));

async function fixture(t) {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), "folio-storage-restore-"),
  );
  t.after(async () => {assert.equal(path.dirname(path.resolve(temporary)),path.resolve(os.tmpdir()));assert.ok(path.basename(temporary).startsWith("folio-storage-restore-"));await rm(temporary, { recursive: true, force: true });});
  const backup = await createBackup({
    destination: temporary,
    publicKey: keys.publicKey,
    rotate: false,
    platformConfig: Object.fromEntries(
      ["auth", "storage", "database", "application", "custody"].map((k) => [
        k,
        { synthetic: true },
      ]),
    ),
    source: {
      compareStorage() {},
      async begin() {
        return {
          metadata: {
            objects,
            buckets: [{ id: "private-fixture", public: false }],
          },
          database: async () => [Buffer.from("fake postgres archive")],
          roles: async () => [Buffer.from("fake roles")],
          verifyUnchanged: async () => {},
          close: async () => {},
        };
      },
    },
    storage: {
      inventory: async () => objects,
      download: async (o) => ({ stream: [data[objects.indexOf(o)]] }),
    },
  });
  const bytes = new Map();
  const uploads = [];
  let failAt = -1,
    loseResponseAt = -1,
    corruptAt = -1,
    extra = false,
    missingAs400 = false,
    onUpload = async () => {}, afterAcceptance = async () => {};
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/storage/v1/bucket") {
      res.setHeader("content-type", "application/json");
      return res.end(
        JSON.stringify([{ id: "private-fixture", public: false }]),
      );
    }
    if (url.pathname === "/storage/v1/object/list/private-fixture") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { prefix, offset, limit } = JSON.parse(body);
      const list =
        prefix === "nested"
          ? objects.map((o) => ({
              id: o.id,
              name: o.name.slice(7),
              updated_at: o.updatedAt,
              metadata: { size: o.size },
            }))
          : [
              { id: null, name: "nested" },
              ...(extra
                ? [
                    {
                      id: "unexpected",
                      name: "unexpected",
                      updated_at: objects[0].updatedAt,
                      metadata: { size: 1 },
                    },
                  ]
                : []),
            ];
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify(list.slice(offset, offset + limit)));
    }
    const i = objects.findIndex(
      (o) =>
        url.pathname ===
        `/storage/v1/object/${o.bucket}/${o.name.split("/").map(encodeURIComponent).join("/")}`,
    );
    if (i < 0) {
      res.statusCode = 404;
      return res.end();
    }
    if (req.method === "POST") {
      assert.equal(req.headers["x-upsert"], "true");
      assert.equal(req.headers["content-type"], "application/pdf");
      uploads.push(i);
      let parts = [];
      for await (const chunk of req) parts.push(chunk);
      await onUpload();
      if (i === failAt) {
        res.statusCode = 503;
        return res.end("private backend failure");
      }
      bytes.set(i, i === corruptAt ? Buffer.from("bad") : Buffer.concat(parts));
      await afterAcceptance();
      if (i === loseResponseAt) {
        req.socket.destroy();
        return;
      }
      res.setHeader("content-type", "application/json");
      return res.end("{}");
    }
    assert.equal(req.method, "GET");
    if (!bytes.has(i)) {
      res.statusCode = missingAs400 ? 400 : 404;
      return res.end(missingAs400 ? JSON.stringify({ statusCode: "404" }) : "");
    }
    res.end(bytes.get(i));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const options = {
    directory: path.join(temporary, backup.id),
    privateKey: keys.privateKey,
    storageUrl: origin,
    confirmStorageOrigin: origin,
    metadataRestored: true,
    serviceKey: "synthetic-local-key",
    journalDirectory: path.join(temporary, "journal"),
    pageSize: 1,
  };
  return {
    options,
    bytes,
    uploads,
    temporary,
    setFailure(i) {
      failAt = i;
    },
    setLostResponse(i) {
      loseResponseAt = i;
    },
    setCorruption(i) {
      corruptAt = i;
    },
    setExtra() {
      extra = true;
    },
    setMissingAs400() {
      missingAs400 = true;
    },
    setOnUpload(fn) {
      onUpload = fn;
    },
    setAfterAcceptance(fn) { afterAcceptance = fn; },
  };
}

test("local Storage restores exact paths and bytes, verifies download, then resumes without upload", async (t) => {
  const f = await fixture(t);
  f.setMissingAs400();
  const result = await restoreStorageLocal(f.options);
  assert.equal(result.storageFilesRestored, true);
  assert.equal(result.authLoginVerified, false);
  assert.equal(result.storageOwnershipVerified, false);
  assert.deepEqual(f.uploads, [0, 1]);
  assert.deepEqual(f.bytes.get(0), data[0]);
  assert.deepEqual(f.bytes.get(1), data[1]);
  await restoreStorageLocal(f.options);
  assert.deepEqual(f.uploads, [0, 1]);
  const journal = (await readdir(f.options.journalDirectory)).find((n) =>
    n.endsWith(".json"),
  );
  const text = await readFile(
    path.join(f.options.journalDirectory, journal),
    "utf8",
  );
  assert.ok(!text.includes("patient"));
  assert.ok(!text.includes("private-fixture"));
  assert.ok(!text.includes("synthetic-local-key"));
  assert.equal(JSON.parse(text).phase, "verified");
});

test("failed and uncertain uploads stay pending; retry retains verified files and observes prior acceptance", async (t) => {
  const f = await fixture(t);
  f.setFailure(1);
  await assert.rejects(
    restoreStorageLocal(f.options),
    /storage_restore_pending/,
  );
  assert.deepEqual(f.uploads, [0, 1]);
  assert.deepEqual(f.bytes.get(0), data[0]);
  f.setFailure(-1);
  f.setLostResponse(1);
  await assert.rejects(
    restoreStorageLocal(f.options),
    /storage_restore_pending/,
  );
  assert.deepEqual(f.uploads, [0, 1, 1]);
  f.setLostResponse(-1);
  await restoreStorageLocal(f.options);
  assert.deepEqual(f.uploads, [0, 1, 1]);
});

test("different bytes stay preserved even with a pending upload intent because their writer cannot be proven", async (t) => {
  const f = await fixture(t);
  f.setCorruption(0);
  await assert.rejects(
    restoreStorageLocal(f.options),
    /storage_restore_pending/,
  );
  f.setCorruption(-1);
  await assert.rejects(restoreStorageLocal(f.options),/storage_restore_pending/);
  assert.deepEqual(f.uploads, [0]);
  assert.deepEqual(f.bytes.get(0),Buffer.from("bad"));
});

test("killing a Storage restore releases its lease; resume observes the accepted bytes without reupload",{timeout:20000},async(t)=>{
 const f=await fixture(t);
 let accepted,release;const arrived=new Promise(resolve=>{accepted=resolve;});const blocked=new Promise(resolve=>{release=resolve;});
 f.setAfterAcceptance(async()=>{accepted();await blocked;});
 const helper=path.join(f.temporary,'restore-child.mjs');
 await writeFile(helper,`import {restoreStorageLocal} from ${JSON.stringify(new URL('../../scripts/backup/storage-restore.mjs',import.meta.url).href)};let input='';for await(const chunk of process.stdin)input+=chunk;await restoreStorageLocal(JSON.parse(input));`,{mode:0o600});
 const child=spawn(process.execPath,[helper],{stdio:['pipe','pipe','pipe'],windowsHide:true});
 child.stdin.end(JSON.stringify(f.options));
 let error='';child.stderr.on('data',chunk=>{error+=chunk;});
 try{
  await Promise.race([arrived,once(child,'exit').then(()=>{throw Error(`Restore child exited early: ${error}`);})]);
  child.kill('SIGKILL');await once(child,'exit');release();f.setAfterAcceptance(async()=>{});
  const result=await restoreStorageLocal(f.options);
  assert.equal(result.storageFilesRestored,true);assert.deepEqual(f.uploads,[0,1]);
 }finally{release();if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await once(child,'exit');}}
});

test("corrupt package, wrong target and unexpected inventory never upload or create a restore journal", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    restoreStorageLocal({
      ...f.options,
      storageUrl: "https://remote.supabase.co",
    }),
    /storage_restore_target/,
  );
  await assert.rejects(
    restoreStorageLocal({
      ...f.options,
      confirmStorageOrigin: "http://127.0.0.1:1",
    }),
    /storage_restore_target/,
  );
  const file = path.join(f.options.directory, "artifact_4.sealed");
  const content = await readFile(file);
  content[content.length - 1] ^= 1;
  await writeFile(file, content);
  // Repair the public checksum to prove AEAD of the LAST object is checked
  // before even the FIRST upload, not merely a receipt checksum rejection.
  const receiptFile = path.join(f.options.directory, "receipt.json");
  const receipt = JSON.parse(await readFile(receiptFile, "utf8"));
  receipt.files.find((f) => f.file === "artifact_4.sealed").sha256 = createHash(
    "sha256",
  )
    .update(content)
    .digest("hex");
  await writeFile(receiptFile, JSON.stringify(receipt));
  await assert.rejects(restoreStorageLocal(f.options));
  assert.deepEqual(f.uploads, []);
  await assert.rejects(readdir(f.options.journalDirectory), { code: "ENOENT" });
});

test("foreign existing bytes or metadata cannot be overwritten", async (t) => {
  const f = await fixture(t);
  f.bytes.set(0, Buffer.from("foreign file"));
  await assert.rejects(
    restoreStorageLocal(f.options),
    /storage_restore_pending/,
  );
  assert.deepEqual(f.uploads, []);
  f.bytes.clear();
  f.setExtra();
  await assert.rejects(
    restoreStorageLocal(f.options),
    /storage_restore_inventory/,
  );
  assert.deepEqual(f.uploads, []);
});

test("same target journal serializes writers while an upload is in flight", async (t) => {
  const f = await fixture(t);
  let entered, release;
  const started = new Promise((resolve) => (entered = resolve));
  const blocked = new Promise((resolve) => (release = resolve));
  f.setOnUpload(async () => {
    entered();
    await blocked;
  });
  const first = restoreStorageLocal(f.options);
  await started;
  try {
    await assert.rejects(restoreStorageLocal(f.options), /backup_capture_already_running_or_lock_unavailable/);
    assert.deepEqual(f.uploads, [0]);
  } finally {
    release();
    await first;
  }
  assert.deepEqual(f.uploads, [0, 1]);
});

test("the same Storage target cannot be written concurrently through a different journal directory",{timeout:10000},async(t)=>{
 const f=await fixture(t);let enterFirst,enterSecond,release;
 const firstEntered=new Promise(resolve=>{enterFirst=resolve;});const secondEntered=new Promise(resolve=>{enterSecond=resolve;});const blocked=new Promise(resolve=>{release=resolve;});
 f.setOnUpload(async()=>{if(f.uploads.length===1)enterFirst();else enterSecond('second-upload-started');await blocked;});
 const first=restoreStorageLocal(f.options);await firstEntered;
 const second=restoreStorageLocal({...f.options,journalDirectory:path.join(f.temporary,'another-journal')});
 try{const result=await Promise.race([secondEntered,second.then(()=> 'unexpected-success',()=> 'locked')]);assert.equal(result,'locked');}
 finally{release();await Promise.allSettled([first,second]);}
 assert.deepEqual(f.uploads,[0,1]);
});

test("a legacy Storage lock remains untouched for review rather than evicting a possibly active old writer",async(t)=>{
 const f=await fixture(t);const target=createHash('sha256').update(f.options.storageUrl).digest('hex');
 const legacy=path.join(f.options.journalDirectory,`.storage_${target}.lock`);await mkdir(legacy,{recursive:true});
 const owner=JSON.stringify({pid:process.pid,startedAt:'2000-01-01T00:00:00Z'});await writeFile(path.join(legacy,'owner.json'),owner);
 await assert.rejects(restoreStorageLocal(f.options),/storage_restore_legacy_lock_review_required/);
 assert.equal(await readFile(path.join(legacy,'owner.json'),'utf8'),owner);assert.deepEqual(f.uploads,[]);
});
