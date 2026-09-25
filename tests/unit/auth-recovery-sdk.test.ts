import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { resolveRecoveryLink } from "../../lib/auth/recovery-link";

// Load the exact transitive Auth SDK installed with @supabase/ssr.
const require = createRequire(import.meta.url);
const authRequire = createRequire(require.resolve("@supabase/supabase-js"));
const { GoTrueClient } = authRequire("@supabase/auth-js") as { GoTrueClient: new (options: Record<string, unknown>) => AuthSdk };
type AuthSdk = {
  initialize(): Promise<{ error: Error | null }>;
  getSession(): Promise<{ data: { session: unknown }; error: Error | null }>;
  exchangeCodeForSession(code: string): Promise<{ error: Error | null }>;
};

function syntheticBrowser(href: string) {
  const priorWindow = (globalThis as { window?: unknown }).window;
  const priorDocument = (globalThis as { document?: unknown }).document;
  const priorBroadcastChannel = globalThis.BroadcastChannel;
  let current = href;
  const location = {
    get href() { return current; },
    set href(value: string) { current = value; },
    get hash() { return new URL(current).hash; },
    set hash(value: string) { const url = new URL(current); url.hash = value; current = url.href; },
  };
  (globalThis as { window?: unknown }).window = {
    location,
    history: { state: null, replaceState(_state: unknown, _title: string, next: string) { current = next; } },
    addEventListener() {}, removeEventListener() {},
  };
  (globalThis as { document?: unknown }).document = {
    visibilityState: "visible", addEventListener() {}, removeEventListener() {},
  };
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
  return { current: () => current, restore() {
    (globalThis as { window?: unknown }).window = priorWindow;
    (globalThis as { document?: unknown }).document = priorDocument;
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = priorBroadcastChannel;
  } };
}

let fixtureCounter = 0;
function authFixture({ expired = false, verifier = true, priorSession = false, withoutSession = false } = {}) {
  const href = "http://localhost:4430/reset-password?code=synthetic-code";
  const browser = syntheticBrowser(href);
  const values = new Map<string, string>();
  const key = `sb-synthetic-${++fixtureCounter}-auth-token`;
  if (verifier) values.set(`${key}-code-verifier`, JSON.stringify("synthetic-verifier/recovery"));
  if (priorSession) values.set(key, JSON.stringify({
    access_token: "old.synthetic.token", refresh_token: "old-refresh", token_type: "bearer",
    expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "old-user", email: "old@example.test" },
  }));
  let exchanges = 0;
  const client = new GoTrueClient({
    url: "http://127.0.0.1:55421/auth/v1", storageKey: key, headers: {},
    persistSession: true, autoRefreshToken: false, detectSessionInUrl: true,
    flowType: "pkce", storage: {
      getItem: (name: string) => values.get(name) ?? null,
      setItem: (name: string, value: string) => { values.set(name, value); },
      removeItem: (name: string) => { values.delete(name); },
    },
    fetch: async () => {
      exchanges += 1;
      return new Response(JSON.stringify(expired
        ? { code: "otp_expired", message: "Synthetic expired link" }
        : withoutSession ? { user: { id: "new-user", email: "new@example.test" } }
        : {
          access_token: "new.synthetic.token", refresh_token: "new-refresh", token_type: "bearer",
          expires_in: 3600, user: { id: "new-user", email: "new@example.test" },
        }), { status: expired ? 400 : 200, headers: { "content-type": "application/json" } });
    },
  });
  return { browser, client, href, exchanges: () => exchanges };
}

test("installed SDK exchanges once; old manual exchange fails after verifier removal", async () => {
  const fixture = authFixture();
  try {
    assert.equal(await resolveRecoveryLink(fixture.client, fixture.href, fixture.browser.current), true);
    assert.equal(fixture.exchanges(), 1);
    assert.equal(new URL(fixture.browser.current()).searchParams.has("code"), false);
    const second = await fixture.client.exchangeCodeForSession("synthetic-code");
    assert.ok(second.error);
    assert.equal(fixture.exchanges(), 1);
  } finally { fixture.browser.restore(); }
});

test("reused link cannot borrow an existing session", async () => {
  const fixture = authFixture({ expired: true, priorSession: true });
  try {
    assert.equal(await resolveRecoveryLink(fixture.client, fixture.href, fixture.browser.current), false);
    assert.equal(fixture.exchanges(), 1);
  } finally { fixture.browser.restore(); }
});

test("missing verifier or link evidence cannot borrow an existing session", async () => {
  const fixture = authFixture({ verifier: false, priorSession: true });
  try {
    assert.equal(await resolveRecoveryLink(fixture.client, fixture.href, fixture.browser.current), false);
    assert.equal(fixture.exchanges(), 0);
    assert.equal(await resolveRecoveryLink(fixture.client, "http://localhost:4430/reset-password", fixture.browser.current), false);
  } finally { fixture.browser.restore(); }
});

test("a response without a new session never opens the password form", async () => {
  const fixture = authFixture({ withoutSession: true });
  try {
    assert.equal(await resolveRecoveryLink(fixture.client, fixture.href, fixture.browser.current), false);
    assert.equal(fixture.exchanges(), 1);
  } finally { fixture.browser.restore(); }
});

test("strict effect remount shares SDK initialization and does not exchange twice", async () => {
  const fixture = authFixture();
  try {
    const both = await Promise.all([
      resolveRecoveryLink(fixture.client, fixture.href, fixture.browser.current),
      resolveRecoveryLink(fixture.client, fixture.href, fixture.browser.current),
    ]);
    assert.deepEqual(both, [true, true]);
    assert.equal(await resolveRecoveryLink(fixture.client, fixture.href, fixture.browser.current), true);
    assert.equal(fixture.exchanges(), 1);
  } finally { fixture.browser.restore(); }
});
