import assert from "node:assert/strict";
import test from "node:test";
import { sendEmail } from "../../lib/email/client";
const input = { to: "private@example.invalid", subject: "Private subject", html: "secret", idempotencyKey: "email/job-1" };
const config = { enabled: true, apiKey: "fake", from: "test@example.invalid" };
test("provider acceptance is not delivered and preserves receipt plus stable key", async () => {
  let key: string | undefined;
  const result = await sendEmail(input, { config, transport: async (_body, k) => { key = k; return { status: 200, body: { id: "provider-1" } }; } });
  assert.deepEqual(result, { status: "sent", providerId: "provider-1" });
  assert.equal(key, input.idempotencyKey);
});
test("ambiguous network response never leaks raw error and remains uncertain", async () => {
  const result = await sendEmail(input, { config, transport: async () => { throw new Error("private@example.invalid secret"); } });
  assert.deepEqual(result, { status: "uncertain", detail: "provider_response_unknown" });
});
test("rate limit is retryable, validation is terminal and errors contain no PII", async () => {
  for (const [status, retryable] of [[429,true],[422,false],[503,true]] as const) {
    const result = await sendEmail(input, { config, transport: async () => ({ status, body: { message: input.to } }) });
    assert.deepEqual(result, { status: "failed", detail: `provider_http_${status}`, retryable });
  }
});
test("disabled delivery does not invoke transport or report acceptance", async () => {
  const result = await sendEmail(input, { config: { ...config, enabled: false }, transport: async () => { assert.fail("external transport called"); } });
  assert.equal(result.status, "blocked");
});
test("successful HTTP without receipt remains uncertain", async () => {
  const result = await sendEmail(input, { config, transport: async () => ({ status: 200, body: {} }) });
  assert.equal(result.status, "uncertain");
});
