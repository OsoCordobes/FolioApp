import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  closePgClient,
  monitorPostgresChild,
} from "../../scripts/backup/postgres.mjs";
import { verifyEmptyPgsodiumKey } from "../../scripts/backup/source.mjs";

function childFixture() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.exitCode = null;
  child.kills = 0;
  child.kill = () => {
    child.kills++;
  };
  return child;
}
test("stderr remains fatal even after a successful exit; diagnostic callback receives bounded bytes only", async () => {
  const child = childFixture();
  let received;
  const completion = monitorPostgresChild(child, {
    timeoutMs: 1000,
    diagnosticSink: async (body, summary) => {
      received = { body: Buffer.from(body), summary };
    },
  });
  child.stderr.write(
    "pg_dump: warning: there are circular foreign-key constraints PRIVATE_PATIENT_DETAIL",
  );
  child.emit("close", 0);
  await assert.rejects(
    completion,
    (error) =>
      error.category === "circular_foreign_keys" &&
      error.exitCode === 0 &&
      !JSON.stringify(error).includes("PRIVATE_PATIENT_DETAIL"),
  );
  assert.ok(received.body.includes("PRIVATE_PATIENT_DETAIL"));
  assert.equal(received.summary.truncated, false);
});
test("process timeout kills child and closes streams without waiting forever for close", async () => {
  const child = childFixture();
  const start = Date.now();
  await assert.rejects(
    monitorPostgresChild(child, { timeoutMs: 20 }),
    (error) => error.category === "timeout",
  );
  assert.ok(Date.now() - start < 500);
  assert.equal(child.kills, 1);
  assert.equal(child.stdout.destroyed, true);
});
test("diagnostic is capped and sink failure cannot become a successful backup", async () => {
  const child = childFixture();
  let count;
  const completion = monitorPostgresChild(child, {
    timeoutMs: 1000,
    diagnosticSink: async (body, summary) => {
      count = body.length;
      assert.equal(summary.truncated, true);
      throw new Error("PRIVATE_SINK_ERROR");
    },
  });
  child.stderr.write(Buffer.alloc(70000, 65));
  child.emit("close", 1);
  await assert.rejects(
    completion,
    (error) =>
      error.category === "diagnostic_capture_failed" &&
      !String(error).includes("PRIVATE_SINK_ERROR"),
  );
  assert.equal(count, 65536);
});
test("unresponsive rollback has a bounded close and destroys only its own connection", async () => {
  let destroyed = 0;
  let ended = 0;
  const client = {
    query: () => new Promise(() => {}),
    end: async () => {
      ended++;
    },
    connection: {
      stream: {
        destroy: () => {
          destroyed++;
        },
      },
    },
  };
  await assert.rejects(
    closePgClient(client, { rollback: true, timeoutMs: 20 }),
    (error) => error.category === "timeout",
  );
  assert.equal(destroyed, 1);
  assert.equal(ended, 0);
});

test("reviewed extension workaround cannot omit data, a normal table or an unverified constraint", async () => {
  const valid = {
    rows: 0,
    extension_configuration_table: true,
    self_foreign_key: true,
  };
  const query = (row) => ({ query: async () => ({ rows: [row] }) });
  assert.equal(
    (await verifyEmptyPgsodiumKey(query(valid))).checkedInExportedSnapshot,
    true,
  );
  for (const row of [
    { ...valid, rows: 1 },
    { ...valid, extension_configuration_table: false },
    { ...valid, self_foreign_key: false },
    undefined,
  ]) {
    await assert.rejects(
      verifyEmptyPgsodiumKey(query(row)),
      /pgsodium_key_requires_managed_restore_review/,
    );
  }
});

test("an unrelated warning remains fatal and is never silently accepted", async () => {
  const child = childFixture();
  const completion = monitorPostgresChild(child, { timeoutMs: 1000 });
  child.stderr.write(
    "pg_dump: warning: unrecognized synthetic warning PRIVATE_DETAIL",
  );
  child.emit("close", 0);
  await assert.rejects(
    completion,
    (error) =>
      error.category === "tool_failure_or_warning" &&
      !String(error).includes("PRIVATE_DETAIL"),
  );
});
