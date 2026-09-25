import assert from "node:assert/strict";
import test from "node:test";

import { pendingAfterAttempt } from "../../lib/caller/pending-call";

test("unknown write followed by rate limit retains the same operation", () => {
  const original = { operationId: "14100000-0000-4000-8000-000000000001", destination: "CONSULTORIO" as const, room: 1 };
  const uncertain = pendingAfterAttempt(original, false);
  const limited = pendingAfterAttempt(uncertain!, false);
  assert.strictEqual(limited, original);
  assert.equal(limited?.operationId, original.operationId);
  assert.equal(pendingAfterAttempt(limited!, true), null);
});
