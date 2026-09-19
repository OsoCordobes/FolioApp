import assert from "node:assert/strict";
import test from "node:test";

import { verifyTurnstile } from "../../lib/security/turnstile";

const TEST_SECRET = "1x0000000000000000000000000000000AA";
const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

test("Siteverify distinguishes accepted, expired, spent and network-failed tokens without bypassing validation", async () => {
  const previousFetch = globalThis.fetch;
  const previousSecret = process.env.TURNSTILE_SECRET_KEY;
  process.env.TURNSTILE_SECRET_KEY = TEST_SECRET;
  let requests = 0;
  try {
    for (const [response, expected] of [
      [{ success: true }, true],
      [{ success: false, "error-codes": ["timeout-or-duplicate"] }, false],
      [{ success: false, "error-codes": ["invalid-input-response"] }, false],
    ] as const) {
      globalThis.fetch = async (input, init) => {
        requests++;
        assert.equal(input, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
        const body = new URLSearchParams(String(init?.body));
        assert.equal(body.get("secret"), TEST_SECRET);
        assert.equal(body.get("response"), DUMMY_TOKEN);
        return new Response(JSON.stringify(response), { status: 200 });
      };
      assert.equal(await verifyTurnstile(DUMMY_TOKEN), expected);
    }
    globalThis.fetch = async () => { requests++; throw new Error("synthetic network failure"); };
    assert.equal(await verifyTurnstile(DUMMY_TOKEN), false);
    assert.equal(await verifyTurnstile("short"), false);
    assert.equal(requests, 4);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = previousSecret;
  }
});
