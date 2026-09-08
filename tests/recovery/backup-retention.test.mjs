import assert from "node:assert/strict";
import test from "node:test";
import {
  backupStatus,
  chooseRetention,
} from "../../scripts/backup/retention.mjs";
test("backup status catches up when absent, failed or older than 24h", () => {
  const now = new Date("2026-09-08T12:00:00Z");
  assert.equal(backupStatus(null, now).catchUp, true);
  assert.equal(
    backupStatus({ completedAt: "2026-09-07T11:59:59Z" }, now).stale,
    true,
  );
  assert.equal(
    backupStatus({ completedAt: "2026-09-08T11:59:59Z" }, now).catchUp,
    false,
  );
});
test("retention preserves newest valid copy plus seven daily and four weekly recovery points", () => {
  const rows = Array.from({ length: 50 }, (_, n) => ({
    id: String(n),
    completedAt: new Date(Date.UTC(2026, 8, 8 - n)).toISOString(),
  }));
  const keep = chooseRetention(rows);
  assert.ok(keep.has("0"));
  for (let n = 0; n < 7; n++) assert.ok(keep.has(String(n)));
  assert.ok(keep.has("9"));
  assert.ok(keep.size <= 11);
});
