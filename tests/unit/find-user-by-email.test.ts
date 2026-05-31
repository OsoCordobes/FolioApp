import assert from "node:assert/strict";
import test from "node:test";

import { findUserByEmail } from "../../lib/auth/find-user-by-email";

/**
 * Folio · findUserByEmail · M38 direct-SQL refactor.
 *
 * Before M38 this helper paginated `admin.listUsers`. Tests covered the
 * pagination edge cases. The new flow is rpc → admin.getUserById, so the
 * mock surface area is different: we stub `rpc("find_user_id_by_email")`
 * and `auth.admin.getUserById(id)`.
 */

interface MockUser {
  id: string;
  email: string;
  email_confirmed_at: string | null;
}

interface Fixture {
  /** uuid returned by the RPC, or null if not found, or "error" to simulate failure. */
  rpcResult: string | null | "error";
  /** user object returned by getUserById, or null, or "error". */
  hydrate?: MockUser | null | "error";
}

interface CallLog {
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
  hydrateCalls: string[];
}

function makeMockService(fixture: Fixture): {
  service: Parameters<typeof findUserByEmail>[0];
  calls: CallLog;
} {
  const calls: CallLog = { rpcCalls: [], hydrateCalls: [] };
  const service = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.rpcCalls.push({ fn, args });
      if (fixture.rpcResult === "error") {
        return { data: null, error: { message: "rpc failed" } };
      }
      return { data: fixture.rpcResult, error: null };
    },
    auth: {
      admin: {
        getUserById: async (id: string) => {
          calls.hydrateCalls.push(id);
          if (fixture.hydrate === "error") {
            return { data: null, error: { message: "admin failed" } };
          }
          return { data: { user: fixture.hydrate ?? null }, error: null };
        },
      },
    },
  } as unknown as Parameters<typeof findUserByEmail>[0];
  return { service, calls };
}

test("rpc returns id → hydrates and returns the full user", async () => {
  const { service, calls } = makeMockService({
    rpcResult: "user-uuid-1",
    hydrate: { id: "user-uuid-1", email: "lautaro@folio.app", email_confirmed_at: "2026-05-20T00:00:00Z" },
  });
  const result = await findUserByEmail(service, "lautaro@folio.app");
  assert.equal(result?.id, "user-uuid-1");
  assert.equal(result?.email, "lautaro@folio.app");
  assert.equal(calls.rpcCalls.length, 1);
  assert.equal(calls.rpcCalls[0].fn, "find_user_id_by_email");
  assert.equal(calls.rpcCalls[0].args.p_email, "lautaro@folio.app");
  assert.deepEqual(calls.hydrateCalls, ["user-uuid-1"]);
});

test("rpc returns null → returns null without hydrating", async () => {
  const { service, calls } = makeMockService({ rpcResult: null });
  const result = await findUserByEmail(service, "nope@folio.app");
  assert.equal(result, null);
  assert.equal(calls.hydrateCalls.length, 0);
});

test("rpc fails → returns null and skips hydration (caller treats as not-found)", async () => {
  const { service, calls } = makeMockService({ rpcResult: "error" });
  const result = await findUserByEmail(service, "x@folio.app");
  assert.equal(result, null);
  assert.equal(calls.hydrateCalls.length, 0);
});

test("hydrate fails → returns null even if rpc found the id", async () => {
  const { service } = makeMockService({
    rpcResult: "user-uuid-1",
    hydrate: "error",
  });
  const result = await findUserByEmail(service, "x@folio.app");
  assert.equal(result, null);
});

test("hydrate returns null user → returns null (race: user deleted between rpc and admin call)", async () => {
  const { service } = makeMockService({
    rpcResult: "user-uuid-1",
    hydrate: null,
  });
  const result = await findUserByEmail(service, "x@folio.app");
  assert.equal(result, null);
});

test("empty / whitespace email → returns null without hitting RPC", async () => {
  const { service, calls } = makeMockService({ rpcResult: null });
  assert.equal(await findUserByEmail(service, ""), null);
  assert.equal(await findUserByEmail(service, "   "), null);
  assert.equal(calls.rpcCalls.length, 0);
});

test("email normalization: trims whitespace before RPC", async () => {
  const { service, calls } = makeMockService({
    rpcResult: "u",
    hydrate: { id: "u", email: "lautaro@folio.app", email_confirmed_at: null },
  });
  await findUserByEmail(service, "  lautaro@folio.app  ");
  // Case is preserved (the RPC does case-insensitive matching); only
  // surrounding whitespace is stripped.
  assert.equal(calls.rpcCalls[0].args.p_email, "lautaro@folio.app");
});
