import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const actual = createRequire(import.meta.url);

type WorkerStats = { processed: number; complete: number; retryable: number; terminal: number };

function fixture(options: {
  outbound?: WorkerStats;
  due?: string[];
  failInbound?: string;
  failDue?: boolean;
  failOutbound?: boolean;
} = {}) {
  const calls: string[] = [];
  const outbound = options.outbound ?? { processed: 1, complete: 1, retryable: 0, terminal: 0 };
  const source = readFileSync("app/api/cron/sync-google/route.ts", "utf8");
  const exports: Record<string, (request: Request) => Promise<Response>> = {};
  const mocks: Record<string, unknown> = {
    "next/server": { NextResponse: actual("next/server").NextResponse },
    "@/lib/security/verify-bearer": { verifyBearer: (header: string | null, secret: string) => header === `Bearer ${secret}` },
    "@/lib/supabase/server": {
      createSupabaseServiceClient: () => {
        calls.push("service");
        return { rpc: async (name: string, args: { p_limit: number; p_watch: boolean }) => {
          calls.push(`rpc:${name}:${args.p_limit}:${args.p_watch}`);
          return { data: (options.due ?? []).map(id => ({ id })), error: options.failDue ? { message: "private SQL detail" } : null };
        } };
      },
    },
    "@/lib/google/outbound": { dispatchGoogleOutbound: async (limit: number, turnoId: string | undefined, signal: AbortSignal) => {
      assert.equal(limit, 3);
      assert.equal(turnoId, undefined);
      assert.equal(signal.aborted, false);
      calls.push("outbound");
      if (options.failOutbound) throw new Error("private provider detail");
      return outbound;
    } },
    "@/lib/google/inbound": { syncGoogleInbound: async (_service: unknown, row: { id: string }, signal: AbortSignal) => {
      assert.equal(signal.aborted, false);
      calls.push(`inbound:${row.id}`);
      if (options.failInbound === row.id) throw new Error("private provider detail");
      return { skipped: false };
    } },
  };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports,
    require: (name: string) => name in mocks ? mocks[name] : actual(name.startsWith("@/") ? resolve(name.slice(2)) : name),
    process,
    AbortSignal,
    Error,
  });
  return { route: exports, calls };
}

async function withCronSecret(secret: string | undefined, action: () => Promise<void>) {
  const previous = process.env.CRON_SECRET;
  if (secret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = secret;
  try { await action(); }
  finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
}

function request(token = "synthetic-cron") {
  return new Request("https://synthetic.test/api/cron/sync-google", { headers: { authorization: `Bearer ${token}` } });
}

test("Google cron rejects missing or incorrect secret before opening a service client", async () => {
  await withCronSecret(undefined, async () => {
    const f = fixture();
    const response = await f.route.GET(request());
    assert.equal(response.status, 503);
    assert.deepEqual(f.calls, []);
  });
  await withCronSecret("synthetic-cron", async () => {
    const f = fixture();
    const response = await f.route.GET(request("invalid"));
    assert.equal(response.status, 401);
    assert.deepEqual(f.calls, []);
  });
});

test("Google cron dispatches bounded outbound jobs and due inbound integrations", async () => {
  await withCronSecret("synthetic-cron", async () => {
    const f = fixture({ due: ["integration-1", "integration-2"] });
    const response = await f.route.GET(request());
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.outbound.complete, 1);
    assert.equal(body.inbound.complete, 2);
    assert.deepEqual(f.calls.filter(call => call.startsWith("rpc:")), ["rpc:google_due_integrations:10:false"]);
    assert.deepEqual(f.calls.filter(call => call.startsWith("inbound:")), ["inbound:integration-1", "inbound:integration-2"]);
  });
});

test("Google cron surfaces retryable, terminal and inbound failures without leaking provider details", async () => {
  await withCronSecret("synthetic-cron", async () => {
    const f = fixture({ due: ["healthy", "failed"], failInbound: "failed", outbound: { processed: 2, complete: 0, retryable: 1, terminal: 1 } });
    const response = await f.route.GET(request());
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.outbound.retryable, 1);
    assert.equal(body.outbound.terminal, 1);
    assert.equal(body.inbound.failed, 1);
    assert.equal(body.inbound.complete, 1);
    assert.equal(JSON.stringify(body).includes("private provider detail"), false);
  });
});

test("Google cron masks database and worker exceptions as a service failure", async () => {
  await withCronSecret("synthetic-cron", async () => {
    for (const options of [{ failDue: true }, { failOutbound: true }]) {
      const f = fixture(options);
      const response = await f.route.GET(request());
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { ok: false, error: "google_sync_failed" });
    }
  });
});
