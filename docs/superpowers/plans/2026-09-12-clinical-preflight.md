# Clinical Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing real-service clinical rehearsal executable without invalid SQL, false failures on valid permission denials or taking over the visual task's port.

**Architecture:** Keep the dedicated real local Supabase API/database profile at 54321/54322 with PostgreSQL 17 and real Auth/Storage. Use app port 4420 for the clinical rehearsal and validate that exact profile before starting its app/browser. Preserve the ordinary test runner default at 4410. Fix the final payment count by joining the appointment organization.

**Tech Stack:** Node.js, TypeScript, Playwright, Supabase local configuration.

**Spec:** `docs/LAUNCH-RELIABILITY.md`, findings 3 and 4.

## Global Constraints

- No production access, real credentials, environment-file reads, provider calls or weakening of test isolation.
- Never stop or reuse the visual server at 4410. The clinical app uses exactly `http://127.0.0.1:4420`.
- Keep API exactly `http://127.0.0.1:54321`, database 127.0.0.1:54322/postgres, legacy local JWT checks, PG17, synthetic-only fixture ownership, and all seven enforcement gates.
- No starts/resets/migrations of services in the clinical runner. Service preparation remains separate.
- No claim that tests with real Auth/Storage passed until those services were actually used without omissions.
- Allowed files: `scripts/testing/clinical-config.mjs`, its `.d.mts`, `scripts/testing/run-clinical.mjs`, `tests/unit/clinical-fixture-safety.test.ts`, `tests/e2e/clinical-path.spec.ts`, `supabase/config.toml`, `scripts/testing/CLINICAL-LOCAL.md`, `tests/e2e/README.md`.

---

### Task 1: Dedicated clinical profile and valid payment evidence

**Files:** Allowed files listed in Global Constraints.

**Interfaces:**
- Consumes: `testAppConfig`, `clinicalConfig`, isolated browser runner and fixture, `pago.turno_id → turno.id/organization_id`.
- Produces: same clinical fixture contract, exact clinical app URL 4420, valid final per-organization payment count.

- [ ] Add a regression to fixture safety: a complete local clinical configuration on 4420 is accepted, while 4410, 3000, 3010, arbitrary ports, hosted URLs/keys, stub database and missing enforcement remain rejected. Confirm the new positive test fails before implementation.
- [ ] Set the clinical app URL to 4420; make `run-clinical.mjs` default to that URL and validate the full clinical profile before starting `run-browser.mjs`. Preserve validation of explicit overrides; reject an unsafe/other app URL instead of silently rewriting it. Keep the ordinary test runner default unchanged.
- [ ] Change local Supabase auth `site_url` and callback/reset redirect allowlist to the clinical 4420 URL. Do not change hosted Auth configuration or other integrations.
- [ ] Fix final count using `(SELECT count(*)::int FROM public.pago p JOIN public.turno t ON t.id=p.turno_id WHERE t.organization_id=$1) AS pagos`. Check remaining fixture SQL against migrations; report additional findings without silently expanding scope.
- [ ] For the AAL1 protected reads at clinical-path.spec.ts lines 26 and 141, accept either an empty successful result or the specific permission denial `42501` with no exposed rows. M101 permits both. Reject visible rows, unknown/missing result shapes and unrelated errors such as network/schema failures. Add a small reusable assertion alongside the existing clinical preflight assertions, declare its type, and test these accepted/rejected outcomes in clinical-fixture-safety.test.ts. Confirm the current strict `error === null` expectation conflicts with a valid synthetic `42501` response before replacing the two assertions. This does not relax cross-tenant or authorized happy-path assertions.
- [ ] Update local preparation documentation and clearly retain the real-service verification gap. Record the observed conflict with the visual port and the SQL correction.
- [ ] Run fixture/isolation unit tests, TypeScript and targeted lint. Confirm `node scripts/testing/run-clinical.mjs` without credentials still fails before launching app/browser. Use `--list` only to prove discovery and label it accordingly.
- [ ] If a dedicated real local database becomes available, execute the actual corrected query in the rehearsal; otherwise record that execution as pending. Do not add a source-text test that merely repeats the JOIN string.
- [ ] Write report `.flow/launch-reliability/clinical-preflight-report.md`, including RED/GREEN and exact commands, then commit only allowed files.
- [ ] Independent review of compliance and quality before closing this task.

## Preflight review

| Pair/task | Shared interface or agreement | Finding |
|---|---|---|
| Clinical profile / ordinary browser tests | Only clinical mode changes port; default generic runner remains 4410 | Must preserve existing generic tests |
| Clinical profile / Supabase auth redirects | Browser origin and redirect allowlist both become 4420 | Change together |
| Count query / schema | Payment org is derived through turno, as documented by financial server action | Use JOIN; no schema change |
| AAL1 negative / M101 | Both empty filtered result and explicit 42501 are valid denials | Accept only the two specified safe outcomes; do not swallow other errors |
| Clinical preflight / finance-confirmation task | Disjoint changed files; both preserve server contracts | Can review independently |

Plan follows the specified profile; no external service provisioning is implied.
