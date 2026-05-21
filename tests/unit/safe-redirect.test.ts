import assert from "node:assert/strict";
import test from "node:test";

import { safeRedirect } from "../../lib/security/safe-redirect";

test("safeRedirect: returns fallback for null/undefined/empty", () => {
  assert.equal(safeRedirect(null, "/hoy"), "/hoy");
  assert.equal(safeRedirect(undefined, "/hoy"), "/hoy");
  assert.equal(safeRedirect("", "/hoy"), "/hoy");
});

test("safeRedirect: accepts plain same-origin paths", () => {
  assert.equal(safeRedirect("/hoy", "/login"), "/hoy");
  assert.equal(safeRedirect("/pacientes/123", "/login"), "/pacientes/123");
  assert.equal(safeRedirect("/configuracion?tab=billing", "/login"), "/configuracion?tab=billing");
});

test("safeRedirect: rejects protocol-relative URLs (//evil.com)", () => {
  assert.equal(safeRedirect("//evil.com", "/hoy"), "/hoy");
  assert.equal(safeRedirect("//evil.com/path", "/hoy"), "/hoy");
});

test("safeRedirect: rejects backslash-escaped URLs (/\\evil.com)", () => {
  assert.equal(safeRedirect("/\\evil.com", "/hoy"), "/hoy");
  assert.equal(safeRedirect("/\\\\evil.com", "/hoy"), "/hoy");
});

test("safeRedirect: rejects absolute URLs", () => {
  assert.equal(safeRedirect("https://evil.com", "/hoy"), "/hoy");
  assert.equal(safeRedirect("http://evil.com", "/hoy"), "/hoy");
  assert.equal(safeRedirect("javascript:alert(1)", "/hoy"), "/hoy");
  assert.equal(safeRedirect("data:text/html,<script>", "/hoy"), "/hoy");
});

test("safeRedirect: rejects relative paths without leading slash", () => {
  assert.equal(safeRedirect("hoy", "/login"), "/login");
  assert.equal(safeRedirect("../etc", "/login"), "/login");
});

test("safeRedirect: rejects pathological length (>2048)", () => {
  const long = "/" + "a".repeat(2048);
  assert.equal(safeRedirect(long, "/hoy"), "/hoy");
});

test("safeRedirect: accepts max-length boundary (2048 chars)", () => {
  const ok = "/" + "a".repeat(2047);
  assert.equal(safeRedirect(ok, "/hoy"), ok);
});
