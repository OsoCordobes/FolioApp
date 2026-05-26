import assert from "node:assert/strict";
import test from "node:test";

import { getOnboardingResumeState } from "../../lib/db/onboarding-resume";

/**
 * Folio · onboarding-resume · soft-delete loop regression.
 *
 * Audit 2026-05-26 (HIGH): pre-M37, if `organization.deleted_at IS NOT NULL`
 * while `member.deleted_at IS NULL`, the resume helper would return
 * `not_found` → page redirected to /hoy → (app)/layout redirected back to
 * /onboarding → infinite loop.
 *
 * Post-fix:
 *   - DB trigger `tg_cascade_soft_delete_org_members` (M37) prevents the
 *     orphan state from arising organically.
 *   - This helper detects existing orphan rows (legacy) and treats them as
 *     "fresh user, step 1" so the wizard can re-bootstrap, and proactively
 *     soft-deletes the orphan member to prevent the same orphan being seen
 *     on the next request.
 *
 * These tests pin the soft-delete branch in isolation using the same
 * hand-mocked-service pattern as `find-user-by-email.test.ts`.
 */

interface MockRow {
  id?: string;
  organization_id?: string;
  deleted_at?: string | null;
}

interface Fixture {
  member?: MockRow | null;
  orgExistence?: MockRow | null;
  memberError?: string;
  orgExistsError?: string;
}

interface MockState {
  memberUpdates: Array<{ id?: string; patch: Record<string, unknown> }>;
}

/**
 * Hand-rolled mock of the supabase-js builder we use in onboarding-resume.
 *
 * Real shapes exercised by the soft-delete branch:
 *   - service.from("member").select(...).eq(...).is(...).maybeSingle()
 *   - service.from("organization").select(...).eq(...).maybeSingle()
 *   - service.from("member").update(...).eq("id", id)        ← awaited directly
 *
 * The last form is the tricky one: in supabase-js, calling `.eq()` after
 * `.update()` returns a PostgrestFilterBuilder that is itself awaitable
 * (thenable). We emulate this by giving `.eq()` a context-aware path:
 * after `.update()` was called, `.eq()` records the write and returns a
 * resolved promise. Otherwise it keeps chaining for selects.
 */
function makeService(fixture: Fixture): {
  service: Parameters<typeof getOnboardingResumeState>[2];
  state: MockState;
} {
  const state: MockState = { memberUpdates: [] };

  const from = (table: string) => {
    let mode: "select" | "update" = "select";
    let currentPatch: Record<string, unknown> = {};
    let lastEqId: string | undefined;

    const selectMaybeSingle = () => {
      if (table === "member") {
        if (fixture.memberError) {
          return Promise.resolve({ data: null, error: { message: fixture.memberError } });
        }
        return Promise.resolve({ data: fixture.member ?? null, error: null });
      }
      if (table === "organization") {
        if (fixture.orgExistsError) {
          return Promise.resolve({ data: null, error: { message: fixture.orgExistsError } });
        }
        return Promise.resolve({ data: fixture.orgExistence ?? null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };

    const builder = {
      select() {
        return builder;
      },
      eq(col: string, val: unknown) {
        if (col === "id") lastEqId = String(val);
        if (mode === "update") {
          // The real client makes the builder thenable here. Recording the
          // write + returning a resolved promise matches how the caller awaits
          // `service.from(...).update(...).eq(...)`.
          state.memberUpdates.push({ id: lastEqId, patch: currentPatch });
          return Promise.resolve({ data: null, error: null });
        }
        return builder;
      },
      is() {
        return builder;
      },
      update(patch: Record<string, unknown>) {
        mode = "update";
        currentPatch = patch;
        return builder;
      },
      maybeSingle: selectMaybeSingle,
    };

    return builder;
  };

  return { service: { from } as unknown as Parameters<typeof getOnboardingResumeState>[2], state };
}

test("soft-delete branch: returns step 1 when org is soft-deleted", async () => {
  const { service, state } = makeService({
    member: { id: "m1", organization_id: "org-deleted" },
    orgExistence: { id: "org-deleted", deleted_at: "2026-05-01T00:00:00Z" },
  });

  const result = await getOnboardingResumeState("user-1", "lautaro@folio.app", service);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.shouldShowOnboarding, true);
  assert.equal(result.data.initialStep, 1);
  assert.equal(result.data.organizationId, null);
  assert.equal(result.data.slug, null);
  assert.equal(result.data.initialData.email, "lautaro@folio.app");

  // Cleanup: orphan member should be soft-deleted so we don't see the same
  // state on the next request.
  assert.equal(state.memberUpdates.length, 1);
  assert.equal(state.memberUpdates[0].id, "m1");
  assert.ok(
    typeof state.memberUpdates[0].patch.deleted_at === "string",
    "member update should set deleted_at to a timestamp string",
  );
});

test("soft-delete branch: returns step 1 when org row simply doesn't exist", async () => {
  // Distinct from soft-deleted: maybeSingle returns null (no row at all).
  // Should still return step 1, but should NOT attempt to update the member
  // (no orphan to clean since the org never existed in the first place).
  const { service, state } = makeService({
    member: { id: "m1", organization_id: "org-ghost" },
    orgExistence: null,
  });

  const result = await getOnboardingResumeState("user-1", "lautaro@folio.app", service);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.initialStep, 1);
  assert.equal(result.data.organizationId, null);
  assert.equal(state.memberUpdates.length, 0);
});

test("no member: returns step 1 with prefilled email (existing behavior preserved)", async () => {
  const { service, state } = makeService({ member: null });

  const result = await getOnboardingResumeState("user-1", "new@folio.app", service);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.initialStep, 1);
  assert.equal(result.data.organizationId, null);
  assert.equal(result.data.initialData.email, "new@folio.app");
  assert.equal(state.memberUpdates.length, 0);
});

test("member lookup error: propagates db_error", async () => {
  const { service } = makeService({ memberError: "connection refused" });

  const result = await getOnboardingResumeState("user-1", "x@folio.app", service);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "db_error");
});

test("org-existence lookup error: propagates db_error (not a loop)", async () => {
  const { service } = makeService({
    member: { id: "m1", organization_id: "org-x" },
    orgExistsError: "timeout",
  });

  const result = await getOnboardingResumeState("user-1", "x@folio.app", service);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "db_error");
});
