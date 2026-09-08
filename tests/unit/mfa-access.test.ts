import assert from "node:assert/strict";
import test from "node:test";
import { readMfaStatus, verifyMfaSession, mfaRouteDecision, safeMfaReturnPath } from "../../lib/auth/mfa-access";

const allowed = { required: false, allowed: true, isStaff: false, hasVerifiedFactor: false, sessionValid: false };
function client(status: unknown = allowed, options: { user?: boolean; error?: boolean } = {}) {
  const calls: string[] = [];
  return { calls, auth: { getUser: async () => {
    calls.push("getUser");
    return { data: { user: options.user === false ? null : { id: "verified-user" } }, error: null };
  } }, rpc: async () => { calls.push("status"); return { data: status, error: options.error ? { message: "private provider detail" } : null }; } };
}
test("server verifies the user before querying the database MFA policy", async () => {
  const c = client(); const result = await verifyMfaSession(c as never);
  assert.equal(result.ok, true); assert.deepEqual(c.calls, ["getUser", "status"]);
});
test("missing Auth user never reaches policy or a privileged continuation", async () => {
  const c = client(allowed, { user: false }); const result = await verifyMfaSession(c as never);
  assert.equal(result.ok, false); assert.deepEqual(c.calls, ["getUser"]);
});
test("dual or staff account at AAL1 is denied server-side", async () => {
  const c = client({ ...allowed, required: true, allowed: false, isStaff: true });
  const result = await verifyMfaSession(c as never);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "mfa_required");
});
test("missing migration, transport error, malformed and inconsistent policy fail closed", async () => {
  for (const value of [null, {}, { ...allowed, required: true }, { ...allowed, allowed: "true" }]) {
    const result = await readMfaStatus(client(value) as never);
    assert.equal(result.ok, false);
  }
  const result = await readMfaStatus(client(allowed, { error: true }) as never);
  assert.equal(result.ok, false);
  assert.ok(!JSON.stringify(result).includes("private provider detail"));
});
test("MFA gate covers portal, direct APIs, app and authenticated public actions", () => {
  for (const path of ["/portal", "/portal/perfil", "/api/me/export", "/hoy", "/onboarding"]) {
    const result = mfaRouteDecision(path, false);
    assert.equal(result, path.startsWith("/api/") ? "json" : "redirect");
  }
});
test("recovery and enrollment stay reachable without creating prefix bypasses", () => {
  for (const path of ["/seguridad/mfa", "/seguridad/mfa/recuperar", "/login", "/portal/login", "/forgot", "/reset-password", "/api/auth/callback", "/api/auth/signout", "/api/auth/reset"]) {
    assert.equal(mfaRouteDecision(path, false), "pass");
  }
  assert.equal(mfaRouteDecision("/seguridad/mfa/anything-else", false), "redirect");
  assert.equal(mfaRouteDecision("/api/auth/unknown", false), "json");
});
test("return destination cannot escape origin or loop into MFA/auth callbacks", () => {
  for (const path of ["https://evil.invalid", "//evil.invalid", "/\\evil.invalid", "/api/auth/callback", "/seguridad/mfa", "/login", "/%2f%2fevil.invalid", "/hoy\r\nX:bad"]) {
    assert.equal(safeMfaReturnPath(path), "/hoy");
  }
  assert.equal(safeMfaReturnPath("/portal/turnos?tab=proximos"), "/portal/turnos?tab=proximos");
});
