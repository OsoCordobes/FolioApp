# Canonical Loopback for Real Clinical Tests Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for implementation and independent review.

**Goal:** Preserve the same cookie origin through local login and MFA so the real clinical journey can run.

**Architecture:** Use exactly http://localhost:4420 for the clinical app and Auth redirect profile, matching Next15's intentional loopback normalization. Keep the API/database on their existing exact127.0.0.1 endpoints and generic visual runner unchanged. Do not modify production middleware for a local origin mismatch.

**Spec:** `docs/LAUNCH-RELIABILITY.md`; actual RED in `.flow/launch-reliability/clinical-real-runtime-report.md`. Installed Next15.5.24 next-url.js lines15–17 normalizes127.* and[::1] tolocalhost; real unauthenticated307 and login reproduce the origin switch.

## Global Constraints

- Main folio-reliability plus runtime detached e7da69f+reviewed clockfix and this exact profile diff. No M120/M121 in baseline runtime yet.
- Clinical app localhost4420 only; API127.0.0.1:54321, DB127.0.0.1:54322/postgres, PG17. Generic4410 and other worktrees/services unchanged.
- Preserve all isolation/credential/fixture/policy checks. No broad allowance for arbitrary hosts, app origins or hosted services. No fake Auth or cookie/session injection.
- LocalAuth container must use the same new configuration. Stop/start only the owned folio-local-clinical project with default retained volumes, never --all, --no-backup or db reset. Inventory/count fixtures and migration history before/after; no secret output or env-file reads.
- .flow evidence stays ignored and outside commits. Coordinate shared index before commit.

### Task 1: Align the strict local profile and prove real login

**Files:** scripts/testing/run-clinical.mjs, clinical-config.mjs, CLINICAL-LOCAL.md; supabase/config.toml; tests/unit/clinical-fixture-safety.test.ts; tests/e2e/README.md. The diagnostic-backed MFA completion wait below may change only that assertion in tests/fixtures/clinical-local.ts. No production code changes.

- [ ] Capture prior RED and verify localhost resolves/connects through the existing allowed loopback/browser policy and app bind. Do not relax the general isolation policy.
- [ ] Change the clinical default and exact accepted app origin to localhost4420, and local Auth site_url/redirects together. Keep generic app defaults unchanged. Add negative tests for the old127app, alternateIPv6host, wrongport and API/DB mismatch.
- [ ] Mirror only this profile diff and the approved clockfix to runtime. Read current own-project counts before reload, stop only folio-local-clinical preserving all volumes, start same project with prior analytics exclusions, then verify non-secret Auth origin settings and unchanged fixtures/migration history.
- [ ] Typecheck/lint and focused safety tests, then the real seven-case clinical suite with traces off. Verify login/MFA stay on localhost4420 and use real credentials through UI. Report exact pass/fail/not-run counts, preserve strict negatives and investigate the next failure without unrelated source edits.
- [ ] Root ruling after the local observer: Auth verification returned200 in about129ms; the complete UI POST finished in4.8s, then cold Next development compilation of /hoy ran for10.7s. UI completion was present at30s. Extend only the MFA-completion assertion from15s to60s to tolerate this measured development compilation; preserve actual heading/navigation assertions, the180s scenario bound,12s provider and15s SQL limits. Do not claim a passing slow dev run certifies production latency or relax an unresolved authentication error.
- [ ] Update source docs and ignored runtime report with exact snapshot/diff and evidence. Commit scoped files only; independent review checks profile consistency and guard preservation.

## Preflight review

| Pair/task | Shared boundary | Ruling |
|---|---|---|
| NextURL / cookies | Framework normalizes loopback during redirects | One canonicallocalhostapp origin prevents split sessions |
| Clinical / ordinary runner | Same port isolation policy, distinct defaults | Only clinical4420 changes origin |
| App / Auth | Persisted container config differs from edited file | Reload owned project preserving its volumes and verify settings/counts |
| Profile / isolation | Localhost already allowed, exact clinical checks remain | Narrow accepted app origin instead of allowing both origins |
| Real E2E / next defect | No false pass from skipped serial tests | Report next blocker separately and preserve actual negatives |
