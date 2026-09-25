import assert from "node:assert/strict";
import test from "node:test";

import { isSameOrigin, parseCallerCookie, parseCallerCursor, readSmallJson } from "@/lib/caller/screen-http";
import { callerRetryDelay, shouldPlayCallTone } from "@/lib/caller/screen-poll";

const org = "14100000-0000-4000-8000-000000000010";
const token = "a".repeat(64);

test("screen cookie accepts only one organization and bounded token", () => {
  assert.deepEqual(parseCallerCookie(`${org}.${token}`), { org, token });
  for (const value of [undefined, `${org}.${token}.extra`, `${org}.short`, `other.${token}`, `${org}.${"z".repeat(64)}`]) {
    assert.equal(parseCallerCookie(value), null);
  }
});

test("cursor and same-origin checks reject ambiguous input", () => {
  assert.equal(parseCallerCursor(null), null);
  assert.equal(parseCallerCursor("0"), 0);
  assert.equal(parseCallerCursor("123"), 123);
  for (const raw of ["-1", "01", "1e3", "99999999999999999999", "1&token=secret"]) assert.equal(parseCallerCursor(raw), undefined);
  assert.equal(isSameOrigin("https://example.test", "https://example.test/api/caller/screen"), true);
  assert.equal(isSameOrigin("https://evil.test", "https://example.test/api/caller/screen"), false);
  assert.equal(isSameOrigin(null, "https://example.test/api/caller/screen"), false);
});

test("pairing JSON reader rejects oversized streamed bodies", async () => {
  const good = new Request("https://example.test/api/caller/screen/pair", { method: "POST", body: JSON.stringify({ code: "a".repeat(16) }) });
  assert.deepEqual(await readSmallJson(good), { code: "a".repeat(16) });
  const large = new Request("https://example.test/api/caller/screen/pair", { method: "POST", body: "x".repeat(257) });
  await assert.rejects(readSmallJson(large));
});

test("reset and reconnect remain silent; Retry-After is honored in full", () => {
  const next = { cursor: 9, reset: false, snapshot: [{ cursor: 9 }] };
  assert.equal(shouldPlayCallTone(next, 8, true, true), true);
  assert.equal(shouldPlayCallTone({ ...next, reset: true }, 8, true, true), false);
  assert.equal(shouldPlayCallTone(next, 8, false, true), false);
  assert.equal(shouldPlayCallTone(next, 9, true, true), false);
  assert.equal(callerRetryDelay("3600", 1), 3_600_000);
  assert.equal(callerRetryDelay(null, 2), 20_000);
});
