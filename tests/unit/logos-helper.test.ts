import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLogoPath,
  buildLogoPublicUrl,
  LOGO_ALLOWED_MIME,
  LOGO_BUCKET,
  LOGO_MAX_BYTES,
  LOGO_OBJECT_NAME,
  validateLogoFile,
} from "../../lib/storage/logos";

/**
 * Folio · pure-helper acceptance for lib/storage/logos.ts
 *
 * Runs with Node's built-in test runner (no extra deps):
 *   pnpm exec tsx --test tests/unit/logos-helper.test.ts
 *
 * The helper is pure (no Supabase client created here, no I/O), so no
 * browser fixture is needed. node:test sidesteps the Playwright runner
 * entirely.
 *
 * Plan reference: docs/specs/2026-05-21-public-card-and-onboarding-redesign-plan.md §F2.3.
 */

test("LOGO_BUCKET is 'org-logos'", () => {
  assert.equal(LOGO_BUCKET, "org-logos");
});

test("LOGO_MAX_BYTES is 500 KB (under the bucket's 512 KB cap)", () => {
  assert.equal(LOGO_MAX_BYTES, 500 * 1024);
});

test("LOGO_ALLOWED_MIME is PNG-only", () => {
  assert.deepEqual([...LOGO_ALLOWED_MIME], ["image/png"]);
});

test("LOGO_OBJECT_NAME is 'logo.png' (re-upload overwrites)", () => {
  assert.equal(LOGO_OBJECT_NAME, "logo.png");
});

test("buildLogoPath produces <org_id>/logo.png", () => {
  assert.equal(
    buildLogoPath("11111111-2222-3333-4444-555555555555"),
    "11111111-2222-3333-4444-555555555555/logo.png",
  );
});

test("buildLogoPublicUrl appends bucket + path against a clean Supabase URL", () => {
  const url = buildLogoPublicUrl({
    supabaseUrl: "https://abc.supabase.co",
    orgId: "11111111-2222-3333-4444-555555555555",
  });
  assert.equal(
    url,
    "https://abc.supabase.co/storage/v1/object/public/org-logos/11111111-2222-3333-4444-555555555555/logo.png",
  );
});

test("buildLogoPublicUrl strips trailing slashes on supabaseUrl", () => {
  const url = buildLogoPublicUrl({
    supabaseUrl: "https://abc.supabase.co/",
    orgId: "11111111-2222-3333-4444-555555555555",
  });
  assert.equal(
    url,
    "https://abc.supabase.co/storage/v1/object/public/org-logos/11111111-2222-3333-4444-555555555555/logo.png",
  );
});

test("validateLogoFile accepts a non-empty PNG under 500 KB", () => {
  const file = new File([new Uint8Array(1024)], "logo.png", { type: "image/png" });
  assert.deepEqual(validateLogoFile(file), { ok: true });
});

test("validateLogoFile rejects an empty file with code 'empty'", () => {
  const file = new File([], "logo.png", { type: "image/png" });
  const result = validateLogoFile(file);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "empty");
});

test("validateLogoFile rejects a JPG with code 'wrong-mime'", () => {
  const file = new File([new Uint8Array(1024)], "logo.jpg", { type: "image/jpeg" });
  const result = validateLogoFile(file);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "wrong-mime");
    assert.match(result.error, /PNG/);
  }
});

test("validateLogoFile rejects > 500 KB with code 'too-big'", () => {
  const big = new File([new Uint8Array(LOGO_MAX_BYTES + 1)], "logo.png", { type: "image/png" });
  const result = validateLogoFile(big);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "too-big");
    assert.match(result.error, /500 KB/);
  }
});

test("validateLogoFile accepts exactly LOGO_MAX_BYTES (boundary)", () => {
  const exactlyMax = new File([new Uint8Array(LOGO_MAX_BYTES)], "logo.png", { type: "image/png" });
  assert.deepEqual(validateLogoFile(exactlyMax), { ok: true });
});
