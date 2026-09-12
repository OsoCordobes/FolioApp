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

### Task 2: Bound clinical DOM hydration waits consistently

**Evidence:** Runtime run 6 passed real login/MFA, walk-in, arrival and encrypted clinical save. The first reload assertion exceeded the default five-second DOM wait; its later error context contained the correct saved marker. Result was one passed, one failed and five not run. This is not evidence of production latency or a completed clinical journey.

**Files:** `tests/e2e/clinical-path.spec.ts`, a short explanation in `scripts/testing/CLINICAL-LOCAL.md` and the ignored runtime report. Mirror only this exact approved test diff into the existing baseline runtime.

- [ ] Introduce `uiExpect = expect.configure({timeout:30000})` for positive page/locator rendering assertions in this dedicated real-services development suite. Keep explicit existing positive DOM limits when longer; replace shorter positive rendering limits consistently with the single 30-second bound. Do not change click/navigation action defaults without separate evidence.
- [ ] Keep ordinary `expect` for SQL values, API responses, authorization negatives, absence/count-zero assertions, decrypted bytes and data equality. Preserve all `expect.poll` SQL predicates and their existing timeouts, helper MFA 60 seconds, provider 12 seconds, SQL operation 15 seconds and each scenario 180 seconds. No retries, fixed sleeps, assertion removal or fake success.
- [ ] Rerun the real seven-case suite against the preserved owned services with traces off. Report exact results and the first remaining failure. Investigate a new failure before changing product code or further broadening waits.
- [ ] Run typecheck and lint after the final scoped edit; commit explicit source/docs files only after coordinating the index. Independent review must compare assertion semantics and ensure the new bound applies only to DOM rendering.

**Diagnostic amendment:** Run 7 still failed at 30 seconds. A real local observer then confirmed the note was saved (one session, revision 1, decrypted marker), reload completed in 1773 ms, exact `getByLabel('Notas libres')` matched zero elements and exact textbox role/name matched one with the correct value. The wrapping label includes the SSR textarea text, so its label-text selector changes after hydration. Replace exactly the three quiropraxia selectors (fill, reload, reopen) with `getByRole('textbox',{name:'Notas libres',exact:true})`. Preserve value equality and every persistence/authorization check. Attribute this fix to stable field selection, not the longer timeout; no product code change is needed.
