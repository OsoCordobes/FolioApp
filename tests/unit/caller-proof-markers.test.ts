import assert from "node:assert/strict";
import { test } from "node:test";

import { DIAGNOSTIC_PREFIX, parseCallerProofOutput, STAGE_PREFIX } from "../../scripts/testing/caller-proof/markers";

test("caller proof accepts emitted JSON lines and ignores failure codeframes", () => {
  const output = [
    '  > 29 | console.log("caller_proof_stage:pair_issued");',
    `  > 30 | console.log("${STAGE_PREFIX}${JSON.stringify({ stage: "screen_paired", elapsedMs: 10 })}");`,
    `  ${STAGE_PREFIX}${JSON.stringify({ stage: "pair_requested", elapsedMs: 1234 })}`,
    `${STAGE_PREFIX}${JSON.stringify({ stage: "pair_issued", elapsedMs: 1250 })}`,
    `  > 31 | console.log("${DIAGNOSTIC_PREFIX}{\\"kind\\":\\"pair\\"}");`,
    `${DIAGNOSTIC_PREFIX}${JSON.stringify({ kind: "pair", action: "complete", status: "2xx", button: "enabled", message: "unmapped", code: "absent" })}`,
  ].join("\n");
  assert.deepEqual(parseCallerProofOutput(output), {
    stages: [{ stage: "pair_requested", elapsedMs: 1234 }, { stage: "pair_issued", elapsedMs: 1250 }],
    diagnostics: [{ kind: "pair", action: "complete", status: "2xx", button: "enabled", message: "unmapped", code: "absent" }],
  });
});
