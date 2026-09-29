import assert from "node:assert/strict";
import { test } from "node:test";
import { privateRobotsDirectives, s1Result, S1_MARKERS } from "../../scripts/testing/caller-proof/s1-contract";

test("S1 requires exactly three passes and actual emitted route/restoration receipts", () => {
  const valid = [...S1_MARKERS, "  3 passed (2s)"].join("\n");
  assert.equal(s1Result(valid).passed, true);
  for (const invalid of [
    valid.replace("3 passed", "13 passed"), valid + "\n1 skipped", valid + "\n1 failed",
    valid + "\n1 flaky", valid.replace(S1_MARKERS[2], ""), valid + "\n" + S1_MARKERS[0],
    valid.replace(S1_MARKERS[0], ` > 20 | console.log("${S1_MARKERS[0]}");`),
  ]) assert.equal(s1Result(invalid).passed, false);
});

test("private metadata must come from head, including when body contains a decoy", () => {
  const meta = '<meta name="robots" content="noindex, nofollow"/>';
  assert.deepEqual(privateRobotsDirectives(`<html><head>${meta}</head><body></body></html>`), ["noindex", "nofollow"]);
  assert.throws(() => privateRobotsDirectives(`<html><head></head><body>${meta}</body></html>`), /head_robots_missing/);
  assert.deepEqual(privateRobotsDirectives(`<head><meta name="robots" content="index, follow"></head><body>${meta}</body>`), ["index", "follow"]);
});
