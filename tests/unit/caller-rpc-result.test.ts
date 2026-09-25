import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

import { parseCallerRpcResult } from "../../lib/caller/rpc-result";

test("unreadable caller mutation receipt remains unresolved", () => {
  const receipt = z.object({ code: z.string(), cursor: z.number().int() });
  const malformed = parseCallerRpcResult(receipt, { code: "A0001" }, true);
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.error.mutationOutcome, "review_required");

  const confirmed = parseCallerRpcResult(receipt, { code: "A0001", cursor: 1 }, true);
  assert.equal(confirmed.ok, true);
  if (confirmed.ok) assert.deepEqual(confirmed.data, { code: "A0001", cursor: 1 });
});
