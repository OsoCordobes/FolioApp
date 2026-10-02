import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { proofConfiguration } from "../../scripts/testing/caller-proof/run.mjs";
import { MAIL_API, MAIL_PROJECT, MAIL_CASES, assertMailFixtureIsolation, mailReceipt, finishMailReceipt, mailReadFailureFetch } from "../../scripts/testing/mail-recipient-proof/prove.mjs";

test("mail selector is exclusive and preserves caller, portal, S1 and Google modes", () => {
  const config = proofConfiguration(["--mail-internal"]);
  assert.equal(config.project, MAIL_PROJECT); assert.equal(config.mode, "mail-internal");
  assert.deepEqual(config.specs, []); assert.equal(config.clinical, "0");
  for (const args of [["--mail-internal", "--google-internal"], ["--mail-internal", "--s1"], ["--portal-export", "--mail-internal"], ["--mail-internal", "--mail-internal"], ["--mail-internal", "extra"]]) assert.throws(() => proofConfiguration(args));
  for (const [args, expected] of [[[], "caller"], [["--portal-export"], "portal-export"], [["--s1"], "s1"], [["--google-internal"], "google-internal"]] as const) assert.equal(proofConfiguration([...args]).mode, expected);
});

test("mail fixtures require the exclusive fresh hosted backend and exact loopback API", () => {
  const isolated = { project: MAIL_PROJECT, githubActions: "true", runnerEnvironment: "github-hosted", platform: "linux", fresh: true, internalNetwork: true, apiUrl: MAIL_API };
  assertMailFixtureIsolation(isolated);
  for (const delta of [{ project: "folio_google_internal_proof" }, { githubActions: "false" }, { runnerEnvironment: "self-hosted" }, { platform: "win32" }, { fresh: false }, { internalNetwork: false }, { apiUrl: "https://example.invalid" }, { apiUrl: "http://127.0.0.1:54321" }]) assert.throws(() => assertMailFixtureIsolation({ ...isolated, ...delta }));
});

function completeReceipt() {
  const receipt = mailReceipt("553860117a361dea4f6bb4959cd66d8daf116d94");
  const expected = { active: [1, "accepted"], revoked: [0, "terminal"], email_changed: [0, "terminal"], lookup_failure: [0, "retryable"], retry_identity: [2, "accepted"] } as const;
  for (const name of MAIL_CASES as (keyof typeof expected)[]) receipt.cases[name] = { passed: true, sends: expected[name][0], state: expected[name][1], invariant: true };
  receipt.cleanup = true; receipt.migrations = 138;
  return receipt;
}

test("mail receipt needs replay, cleanup and every case with exact call counts/state/invariants", () => {
  assert.equal(finishMailReceipt(mailReceipt("553860117a361dea4f6bb4959cd66d8daf116d94")).passed, false);
  assert.equal(finishMailReceipt(completeReceipt()).passed, true);
  for (const delta of [{ cleanup: false }, { failure: "fixture" }, { migrations: 0 }]) assert.equal(finishMailReceipt({ ...completeReceipt(), ...delta }).passed, false);
  for (const name of MAIL_CASES) for (const mutation of ["missing", "sends", "state", "invariant", "passed"]) {
    const receipt = completeReceipt();
    if (mutation === "missing") delete receipt.cases[name];
    else if (mutation === "sends") receipt.cases[name].sends = 99;
    else if (mutation === "state") receipt.cases[name].state = "delivered";
    else if (mutation === "invariant") receipt.cases[name].invariant = false;
    else receipt.cases[name].passed = false;
    assert.equal(finishMailReceipt(receipt).passed, false);
  }
  const extra = completeReceipt(); extra.cases.unplanned = { passed: true, sends: 0, state: "terminal", invariant: true };
  assert.equal(finishMailReceipt(extra).passed, false);
});

test("mail receipt discards raw bodies, identities and errors and labels injected HTTP failure", () => {
  const sensitive = "secret-token synthetic@example.invalid https://example.invalid/request Patient name stack";
  const receipt = completeReceipt();
  Object.assign(receipt, { body: sensitive, stack: sensitive, url: sensitive, token: sensitive, email: sensitive });
  Object.assign(receipt.cases.active, { body: sensitive, memberId: sensitive, subject: sensitive });
  receipt.failure = sensitive;
  const clean = finishMailReceipt(receipt);
  assert.ok(!JSON.stringify(clean).includes(sensitive)); assert.equal(clean.failure, "unclassified");
  assert.equal(clean.passed, false); assert.equal(clean.provider, "function-stub");
  assert.equal(clean.lookupFailure, "injected-http-read");
  assert.deepEqual(Object.keys(clean.cases.active).sort(), ["invariant", "passed", "sends", "state"]);
});

test("mail fault injects one exact member HTTP read while organization and finish delegate", async () => {
  const scope = { org: "30000000-0000-0000-0000-000000000001", member: "30000000-0000-0000-0000-000000000002" };
  const forwarded: string[] = [];
  const fault = mailReadFailureFetch(async (input: string) => { forwarded.push(input); return new Response("{}", { status: 200 }); }, scope);
  const target = `${MAIL_API}/rest/v1/member?id=eq.${scope.member}&organization_id=eq.${scope.org}`;
  await fault.fetch(`${MAIL_API}/rest/v1/organization`, {});
  await fault.fetch(target.replace(scope.member, "different"), {});
  await fault.fetch(`${MAIL_API}/rest/v1/rpc/email_finish`, { method: "POST" });
  assert.equal(fault.injections, 0);
  const failed = await fault.fetch(target, {});
  assert.equal(failed.status, 403); assert.equal((await failed.json()).code, "MAIL_INTERNAL_INJECTED_READ_FAILURE");
  assert.equal(fault.injections, 1);
  await fault.fetch(target, {});
  assert.equal(fault.injections, 1); assert.equal(forwarded.length, 4);
  await assert.rejects(() => fault.fetch("https://example.invalid/rest/v1/member", {}), /mail_http_scope_escape/);
  assert.equal(forwarded.length, 4);
});

test("mail injected HTTP failure survives actual PostgREST retry behavior without delegating", async () => {
  const scope = { org: "30000000-0000-0000-0000-000000000001", member: "30000000-0000-0000-0000-000000000002" };
  let forwarded = 0;
  const fault = mailReadFailureFetch(async () => { forwarded++; return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }); }, scope);
  const client = createClient(MAIL_API, "synthetic-test-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fault.fetch } });
  const result = await client.from("member").select("id,profile_id").eq("id", scope.member).eq("organization_id", scope.org).maybeSingle();
  assert.equal(result.error?.code, "MAIL_INTERNAL_INJECTED_READ_FAILURE");
  assert.equal(fault.injections, 1); assert.equal(forwarded, 0);
  const unrelated = await client.from("organization").select("id").eq("id", scope.org).maybeSingle();
  assert.equal(unrelated.error, null); assert.equal(forwarded, 1);
});
