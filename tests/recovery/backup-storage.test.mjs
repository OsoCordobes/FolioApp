import assert from "node:assert/strict";
import test from "node:test";
import {
  createStorageReader,
  requireStorageMatch,
} from "../../scripts/backup/storage.mjs";
test("Storage pagination detects changing inventory rather than accepting missing copies", () => {
  const a = {
    bucket: "private",
    name: "a",
    id: "1",
    size: 2,
    etag: "v1",
    updatedAt: "2026-09-08T00:00:00Z",
  };
  assert.doesNotThrow(() =>
    requireStorageMatch([a], [{ ...a, updatedAt: "2026-09-08T00:00:00.000Z" }]),
  );
  assert.throws(
    () => requireStorageMatch([a], [{ ...a, etag: "v2" }]),
    /storage_inventory_changed/,
  );
  assert.throws(
    () => requireStorageMatch([a], []),
    /storage_inventory_changed/,
  );
});
test("Storage download checks complete byte count and refuses provider redirects", async () => {
  let options;
  const reader = createStorageReader({
    url: "http://127.0.0.1:3999",
    serviceKey: "synthetic",
    fetchImpl: async (_url, input) => {
      options = input;
      return new Response("short", { headers: { ETag: "known" } });
    },
  });
  const result = await reader.download({
    bucket: "private",
    name: "file",
    size: 10,
    etag: "known",
  });
  await assert.rejects(async () => {
    for await (const _chunk of result.stream) {
    }
  }, /storage_size_mismatch/);
  assert.equal(options.redirect, "error");
  assert.equal(options.headers["If-Match"], "known");
});
