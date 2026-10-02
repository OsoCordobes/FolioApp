import assert from "node:assert/strict";
import test from "node:test";
import { google } from "googleapis";
import { proofConfiguration } from "../../scripts/testing/caller-proof/run.mjs";
import { GOOGLE_CASES, GOOGLE_PROJECT, assertGoogleFixtureIsolation, assertGoogleSyncObserved, googleReceipt, finishGoogleReceipt } from "../../scripts/testing/google-c05-proof/contract.mjs";
import { googleAdapter, installGoogleTransport, startGoogleHttp } from "../../scripts/testing/google-c05-proof/transport.mjs";
import { createEvent, getEvent, updateEvent, listEvents } from "../../lib/google/calendar";

test("Google selector is exclusive and keeps the existing hosted modes", () => {
  assert.equal(proofConfiguration(["--google-internal"]).project, GOOGLE_PROJECT);
  assert.deepEqual(proofConfiguration(["--google-internal"]).specs, []);
  assert.equal(proofConfiguration([]).mode, "caller");
  assert.equal(proofConfiguration(["--portal-export"]).mode, "portal-export");
  assert.equal(proofConfiguration(["--s1"]).mode, "s1");
  for (const args of [["--google-internal", "--s1"], ["--portal-export", "--google-internal"], ["--google-internal", "--google-internal"], ["--google-internal", "extra"]]) assert.throws(() => proofConfiguration(args));
});
test("eligible Google fixtures require the exclusive fresh hosted project", () => {
  const isolated = { project: GOOGLE_PROJECT, githubActions: "true", runnerEnvironment: "github-hosted", platform: "linux", fresh: true, internalNetwork: true };
  assertGoogleFixtureIsolation(isolated);
  for (const delta of [{ project: "folio_caller_proof" }, { githubActions: "false" }, { runnerEnvironment: "self-hosted" }, { platform: "win32" }, { fresh: false }, { internalNetwork: false }]) assert.throws(() => assertGoogleFixtureIsolation({ ...isolated, ...delta }));
});
test("HTTP receipt cannot pass before every internal case and cleanup", () => {
  const receipt = googleReceipt("f30388f100d4e32fc85910130b96dce2f0c2c87f");
  assert.equal(finishGoogleReceipt(receipt).passed, false);
  for (const name of GOOGLE_CASES) receipt.cases[name] = { passed: true };
  assert.equal(finishGoogleReceipt(receipt).passed, false);
  receipt.cleanup = true; assert.equal(finishGoogleReceipt(receipt).passed, true);
  receipt.failure = "fixture"; assert.equal(finishGoogleReceipt(receipt).passed, false);
  assert.equal(receipt.provider, "http-loopback");
});

test("inbound proof requires an applied snapshot and an actual HTTP list", () => {
  const applied = { ok: true, upserted: 0, deleted: 0 };
  assertGoogleSyncObserved(applied, 3, 5);
  for (const delta of [{ ok: false }, { skipped: "busy" }, { skipped: "no_token" }, { upserted: -1 }, { deleted: NaN }]) assert.throws(() => assertGoogleSyncObserved({ ...applied, ...delta }, 3, 5));
  for (const counts of [[3, 3], [3, 2], [-1, 5], [3, NaN]]) assert.throws(() => assertGoogleSyncObserved(applied, counts[0], counts[1]));
});
test("transport rejects scope escapes before any HTTP adapter and preserves request options", async () => {
  const adapter = googleAdapter("http://127.0.0.1:55427"); let calls = 0;
  for (const url of ["https://evil.test/token", "http://www.googleapis.com/calendar/v3/calendars/c05-internal/events", "https://www.googleapis.com/calendar/v3/calendars/primary/events", "https://oauth2.googleapis.com/revoke", "http://127.0.0.1:55427/token"]) {
    await assert.rejects(() => adapter({ url }, async () => { calls++; }), /c05_transport_escape/);
  }
  assert.equal(calls, 0);
  const signal = AbortSignal.timeout(1000);
  await adapter({ url: "https://www.googleapis.com/calendar/v3/calendars/c05-internal/events?sendUpdates=none", method: "PATCH", signal }, async (options: { url: URL; method: string; signal: AbortSignal }) => {
    assert.equal(options.url.origin, "http://127.0.0.1:55427"); assert.equal(options.url.search, "?sendUpdates=none"); assert.equal(options.method, "PATCH"); assert.equal(options.signal, signal);
  });
  for (const origin of ["https://127.0.0.1:55427", "http://localhost:55427", "http://127.0.0.1:55427/path", "http://127.0.0.1:80"]) assert.throws(() => googleAdapter(origin));
});
test("actual OAuth and Calendar wrappers use loopback HTTP, ETag and accepted lost response", async () => {
  const http = await startGoogleHttp(); const restore = installGoogleTransport(google, http.origin);
  process.env.GOOGLE_OAUTH_CLIENT_ID = "c05-client.invalid";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "c05-test-secret";
  process.env.GOOGLE_OAUTH_REDIRECT_URI = `${http.origin}/unused`;
  const payload = { summary: "Turno reservado", description: "Reserva gestionada por Folio.", start: "2026-10-03T12:00:00Z", end: "2026-10-03T12:30:00Z" };
  try {
    const id = "f0123456789"; http.loseInsert();
    await assert.rejects(() => createEvent("c05-http-refresh", payload, "c05-internal", id));
    assert.equal(http.calls.insert, 1); assert.equal(http.events.size, 1);
    await assert.rejects(() => getEvent("c05-http-refresh", id, "primary"), /c05_transport_escape/);
    assert.equal(http.calls.get, 0);
    const found = await getEvent("c05-http-refresh", id, "c05-internal"); assert.equal(found.id, id);
    const originalEtag = found.etag; assert.ok(originalEtag);
    await updateEvent("c05-http-refresh", id, { start: "2026-10-03T12:10:00Z" }, "c05-internal", undefined, originalEtag);
    await assert.rejects(() => updateEvent("c05-http-refresh", id, { status: "cancelled" }, "c05-internal", undefined, originalEtag));
    assert.equal(http.events.get(id).status, "confirmed");
    assert.equal((await listEvents("c05-http-refresh", "2026-10-03T00:00:00Z", "2026-10-04T00:00:00Z", "c05-internal")).length, 1);
    assert.ok(http.calls.token > 0); assert.equal(http.calls.insert, 1);
  } finally {
    restore(); await http.close();
    delete process.env.GOOGLE_OAUTH_CLIENT_ID; delete process.env.GOOGLE_OAUTH_CLIENT_SECRET; delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
  }
});
