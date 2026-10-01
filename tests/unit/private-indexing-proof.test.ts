import assert from "node:assert/strict";
import { test } from "node:test";
import { privateRobotsDirectives, s1Result, S1_MARKERS } from "../../scripts/testing/caller-proof/s1-contract";
import { proofConfiguration } from "../../scripts/testing/caller-proof/run.mjs";

test("shared privacy entry keeps S1 isolated and portal/caller clinical scopes exclusive", () => {
  const s1 = proofConfiguration(["--s1"]);
  const portal = proofConfiguration(["--portal-export"]);
  const caller = proofConfiguration([]);
  assert.equal(s1.project, "folio_s1_indexing_proof");
  assert.notEqual(s1.project, portal.project);
  assert.deepEqual(s1.specs, ["tests/e2e/private-indexing.spec.ts", "tests/e2e/private-indexing-authenticated.spec.ts"]);
  assert.deepEqual(portal.specs, ["tests/e2e/portal-export-authenticated.spec.ts"]);
  assert.deepEqual(caller.specs, ["tests/e2e/caller-screen.spec.ts"]);
  assert.equal(s1.clinical, "0");
  assert.equal(portal.clinical, "0");
  assert.equal(caller.clinical, "1");
  assert.equal(s1.fixtureName, "folio-s1-indexing-fixture.json");
  assert.equal(portal.fixtureName, "folio-portal-export-proof-fixture.json");
  assert.equal(s1.prefix, "s1_proof");
  assert.equal(portal.prefix, "portal_export_proof");
  assert.equal(caller.prefix, "caller_proof");
});

test("shared privacy entry rejects mixed, duplicate and unknown selectors before execution", () => {
  for (const args of [["--s1", "--portal-export"], ["--portal-export", "--s1"],
    ["--s1", "--s1"], ["--portal-export", "--portal-export"], ["--unknown"], ["--s1", "extra"]]) {
    assert.throws(() => proofConfiguration(args));
  }
});

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
