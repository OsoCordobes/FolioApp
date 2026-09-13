import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import pg from "pg";
import { createPostgresSource } from "../../scripts/backup/source.mjs";
import { createStorageReader } from "../../scripts/backup/storage.mjs";
import { createBackup } from "../../scripts/backup/core.mjs";
import {
  restoreDatabase,
  verifyBackup,
} from "../../scripts/backup/restore.mjs";
import { parseConnection } from "../../scripts/backup/postgres.mjs";

test(
  "actual PostgreSQL snapshot preserves DB+Auth+ACL and verified paginated Storage through encrypted backup/local restore",
  { skip: process.env.FOLIO_RUN_LOCAL_BACKUP_REHEARSAL !== "1" },
  async () => {
    const baseUrl = process.env.FOLIO_BACKUP_TEST_ADMIN_URL;
    if (!baseUrl) throw new Error("synthetic_local_admin_url_required");
    const parsed = parseConnection(baseUrl);
    if (!["127.0.0.1", "localhost", "::1"].includes(parsed.host))
      throw new Error("local_only");
    const admin = new pg.Client(parsed);
    await admin.connect();
    const suffix = `${Date.now()}_${process.pid}`;
    const sourceName = `folio_test_backup_${suffix}`,
      targetName = `folio_restore_${suffix}`;
    const dbUrl = (name) => {
      const u = new URL(baseUrl);
      u.pathname = `/${name}`;
      return u.toString();
    };
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "folio-backup-real-rehearsal-"),
    );
    let sourceDb, server;
    let result;
    const objects = [
      ["alpha", Buffer.from("SYNTHETIC file one")],
      ["folder/bravo", Buffer.from("SYNTHETIC file two")],
      ["zulu", Buffer.from("SYNTHETIC file three")],
    ].map(([name, body], i) => ({
      name,
      body,
      id: `00000000-0000-0000-0000-00000000000${i + 1}`,
      updated_at: "2026-09-08T00:00:00.000Z",
      metadata: {
        size: body.length,
        eTag: createHash("md5").update(body).digest("hex"),
      },
    }));
    try {
      await admin.query(`CREATE DATABASE "${sourceName}" TEMPLATE template0`);
      await admin.query(`CREATE DATABASE "${targetName}" TEMPLATE template0`);
      sourceDb = new pg.Client(parseConnection(dbUrl(sourceName)));
      await sourceDb.connect();
      await sourceDb.query(`CREATE SCHEMA auth;CREATE TABLE auth.users(id integer PRIMARY KEY,email text,encrypted_password text);INSERT INTO auth.users VALUES(1,'synthetic@example.invalid','synthetic-password-hash');
   CREATE TABLE public.records(id integer PRIMARY KEY,value text);INSERT INTO public.records VALUES(1,'SYNTHETIC private database content');REVOKE ALL ON public.records FROM PUBLIC;
   CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text PRIMARY KEY,name text);INSERT INTO storage.buckets VALUES('private','private');
   CREATE TABLE storage.objects(id uuid PRIMARY KEY,bucket_id text,name text,updated_at timestamptz,metadata jsonb);`);
      for (const object of objects)
        await sourceDb.query(
          "INSERT INTO storage.objects VALUES($1,$2,$3,$4,$5)",
          [
            object.id,
            "private",
            object.name,
            object.updated_at,
            object.metadata,
          ],
        );
      let pages = 0,
        downloads = 0;
      server = createServer(async (req, res) => {
        if (req.headers.authorization !== "Bearer synthetic-storage-key") {
          res.writeHead(401).end();
          return;
        }
        if (req.url === "/storage/v1/bucket") {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify([{ id: "private" }]));
          return;
        }
        if (req.url === "/storage/v1/object/list/private") {
          let text = "";
          for await (const c of req) text += c;
          const { prefix, limit, offset } = JSON.parse(text);
          pages++;
          const entries = new Map();
          for (const object of objects) {
            const lead = prefix ? `${prefix}/` : "";
            if (!object.name.startsWith(lead)) continue;
            const rest = object.name.slice(lead.length);
            const segment = rest.split("/")[0];
            if (rest.includes("/"))
              entries.set(segment, { name: segment, id: null });
            else
              entries.set(segment, {
                ...object,
                body: undefined,
                name: segment,
              });
          }
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify(
              [...entries.values()]
                .sort((a, b) => a.name.localeCompare(b.name))
                .slice(offset, offset + limit),
            ),
          );
          return;
        }
        const name = decodeURIComponent(
          req.url.replace("/storage/v1/object/private/", ""),
        );
        const object = objects.find((x) => x.name === name);
        if (!object) {
          res.writeHead(404).end();
          return;
        }
        downloads++;
        res.setHeader("ETag", object.metadata.eTag);
        res.end(object.body);
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const source = createPostgresSource({
        databaseUrl: dbUrl(sourceName),
        tools: { wsl: "Ubuntu" },
        expectedServerMajor: 16,
        allowLocalPg16Rehearsal: true,
      });
      const originalBegin = source.begin;
      source.begin = async () => {
        const snapshot = await originalBegin();
        const originalDump = snapshot.database;
        snapshot.database = async () => {
          await sourceDb.query(
            "INSERT INTO public.records VALUES(2,'after exported snapshot')",
          );
          return originalDump();
        };
        return snapshot;
      };
      const keys = generateKeyPairSync("rsa", {
        modulusLength: 3072,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });
      const capture = await createBackup({
        destination: directory,
        publicKey: keys.publicKey,
        platformConfig: {
          auth: { synthetic: true },
          storage: { synthetic: true },
          database: { synthetic: true },
          application: { synthetic: true },
          custody: { synthetic: true },
        },
        source,
        storage: createStorageReader({
          url: `http://127.0.0.1:${server.address().port}`,
          serviceKey: "synthetic-storage-key",
          pageSize: 2,
        }),
      });
      assert.equal(downloads, 3);
      assert.ok(pages >= 6);
      const backupDir = path.join(directory, capture.id);
      const manifest = await verifyBackup(backupDir, keys.privateKey);
      assert.equal(
        manifest.artifacts.filter((a) => a.kind === "storage-object").length,
        3,
      );
      result = await restoreDatabase({
        directory: backupDir,
        privateKey: keys.privateKey,
        databaseUrl: dbUrl(targetName),
        confirmDatabase: targetName,
        tools: { wsl: "Ubuntu" },
      });
      assert.equal(result.databaseRestored, true);
      assert.equal(result.authLoginVerified, false);
      assert.equal(result.storageFilesRestored, false);
      const restored = new pg.Client(parseConnection(dbUrl(targetName)));
      await restored.connect();
      try {
        assert.equal(
          Number(
            (await restored.query("select count(*) as n from public.records"))
              .rows[0].n,
          ),
          1,
        );
        assert.equal(
          (await restored.query("select encrypted_password from auth.users"))
            .rows[0].encrypted_password,
          "synthetic-password-hash",
        );
        assert.equal(
          Number(
            (await restored.query("select count(*) as n from storage.objects"))
              .rows[0].n,
          ),
          3,
        );
        assert.equal(
          (
            await restored.query(
              "select has_table_privilege('public','public.records','SELECT') as allowed",
            )
          ).rows[0].allowed,
          false,
        );
      } finally {
        await restored.end();
      }
      await assert.rejects(
        restoreDatabase({
          directory: backupDir,
          privateKey: keys.privateKey,
          databaseUrl: dbUrl(targetName),
          confirmDatabase: targetName,
          tools: { wsl: "Ubuntu" },
        }),
        /restore_target_not_empty_loopback/,
      );
    } finally {
      await sourceDb?.end();
      if (server) await new Promise((resolve) => server.close(resolve));
      await admin.query(`DROP DATABASE IF EXISTS "${targetName}"`);
      await admin.query(`DROP DATABASE IF EXISTS "${sourceName}"`);
      await admin.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
