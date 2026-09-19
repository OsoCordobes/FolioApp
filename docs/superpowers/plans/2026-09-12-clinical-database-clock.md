# Clinical Fixture Database Clock Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for implementation and independent review.

**Goal:** Let the real clinical fixture activate MFA immediately using the database's own clock, while preserving strict policy assertions.

**Architecture:** Read a timestamp from the already validated, exclusively synthetic local PostgreSQL connection before administrative policy activation. Pass that timestamp to mfa_set_staff_enforcement. Do not use the host clock, relax guards or wait an arbitrary time.

**Spec:** `docs/LAUNCH-RELIABILITY.md`; real RED evidence `.flow/launch-reliability/clinical-real-runtime-report.md`.

## Global Constraints

- Main source changes only in `folio-reliability`; runtime copy `folio-clinical-runtime` remains fixed e7da69f plus this exact fixture change. No M120 in this baseline run.
- Local validated Supabase17 only, no environment file reads, real secrets or production. Keep all existing fixtures and unrelated services.
- Preserve seven policy checks, Auth/TOTP, Storage, row security and isolation. No sleep/mock substitution for a failed assertion.
- Reports/logs under .flow stay ignored; never force-add them. Coordinate the shared git index with root before committing.

### Task 1: Use database time for fixture policy activation

**Files:** `tests/fixtures/clinical-local.ts`; focused fixture safety test only if needed to prove clock selection; `scripts/testing/CLINICAL-LOCAL.md` for exact result/limitation after execution.

- [ ] Record the observed RED: actual beforeAll failed, no clinical journey ran; host clock led DB by973–975ms and all policies became true later without another activation.
- [ ] Obtain `clock_timestamp()` from the already validated DB, verify it is a valid timestamp and use it as p_after. A read/shape failure must stop preparation; never fall back to host time.
- [ ] Apply the exact same fixture diff to main and runtime and run typecheck/lint for the affected source. Confirm no migration or other source changed in runtime.
- [ ] Re-run the real seven-case clinical suite with trace disabled and no omitted failures; investigate and report the next actual blocker without changing source outside this task.
- [ ] Report base/diff, exact counts, DB/Auth/Storage evidence and any remaining blockers in ignored `.flow/launch-reliability/clinical-real-runtime-report.md`; no secrets or session artifacts. Commit only the scoped source/docs after index coordination.
- [ ] Independent scoped review validates the clock change and unchanged guards. A new E2E failure elsewhere does not invalidate the clock correction or count as a passing journey.

## Preflight review

| Pair/task | Shared boundary | Ruling |
|---|---|---|
| Timestamp / activation | DB compares p_after against its own now() | Read time from the same validated instance |
| Timestamp / assertion | Assertions must remain strict | No tolerance, retry loop or sleep masks the defect |
| Main / runtime | Same fixture behavior, different fixed code snapshots | Mirror only the exact clock diff; no M120 baseline change |
| Task / next E2E failure | Source ownership is one defect | Report unrelated failure before broadening implementation |
