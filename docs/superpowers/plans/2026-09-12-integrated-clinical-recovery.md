# Integrated Clinical Recovery Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task under root coordination. Steps use checkbox syntax; do not activate the local gates until the compatible UI is independently approved.

**Goal:** Prove twelve independent clinical/recovery scenarios using real local Supabase Auth/TOTP, PostgreSQL, Storage and browser UI, including reception roles and lost responses after committed writes.

**Architecture:** One shared case fixture provisions fresh synthetic identities and organizations; shared UI journey and transport helpers serve every case. Each test owns its data, authentication and recovery intent. The final approved app snapshot consumes M120/M121 after an explicit local additive migration and gate cutover.

**Tech Stack:** Existing Playwright, TypeScript, Supabase JS/CLI2.98.2, pg, Next15, local PostgreSQL17.

**Spec:** `docs/CLOSE-RELIABILITY-SPEC.md`; Task3 of `docs/superpowers/plans/2026-09-12-close-callers-recovery.md`; `docs/M120-TURNO-CLOSE-ATOMIC.md`; `docs/M121-PAYMENT-SETTLEMENT.md`. Detailed local procedure: ignored `.flow/launch-reliability/integrated-clinical-preflight.md`.

## Global constraints

- Start point main34dc605 plus separately owned Task2 UI edits. Execution requires an immutable reviewed final UI SHA, not this moving checkout.
- Only synthetic local data. App localhost4420, API127.0.0.1:54321, DB127.0.0.1:54322/postgres; preserve4410, existing36Auth/TOTP/orgs and all volumes/fixtures. No production/env reads, resets, provider payments or delivery.
- Retain all seven existing policy guards and strict local configuration, plus require active M120/M121 for the integrated run. Retain DOM30s, MFA60s, provider12s, SQL15s, scenario180s, existing action/navigation/negative bounds. No retries configured globally, fixed sleeps, fake successes or skipped failures.
- Tracesoff; passwords/TOTP/JWT/cookies and clinical request bodies remain in process memory. Only sanitized IDs, hashes, outcomes and counts enter evidence. Browser never receives service_role/admin DB access.
- No product/UI changes belong to this plan. A defect becomes a separate bounded RED reviewed by root. Coordinate shared index and owned files; reports stay ignored.

## Feasibility and concrete dependencies

ASISTENTE can register via agenda but cannot enter Finanzas or clinical records. COORDINADOR can see its scoped agenda but cannot register/settle; M120 status redacts payment and sets puedeRegistrar=false. Verified sources: capabilities.ts, /finanzas/page.tsx, M120.authorize/status_value, M121.execute and user_has_scope_over.

For each role case create a new OWNER clinician plus one new role account in that case's new organization. Enroll real TOTP before membership; role is es_colegiado=false, accepted_at set, alcance=LISTA_PROFESIONALES, profesionales_gestionados=[owner.memberId as text]. Verify own membership and current scope through real authenticated RPC; do not merely trust fixture inserts. The two roles add two Auth/TOTP accounts and two browser logins beyond their OWNER case preparation. Each case may need two UI logins and one saved/closed visit; measure within180s, never raise it speculatively.

Execution is blocked until Task2 UI is fixed/reviewed and runtime receives M120/M121 (currently113 migrations/M106 active, new schemas absent). No role-contract blocker was found. The old fixture supports three OWNERs only, so parametrized per-case provisioning is implementation work. New accounts avoid unavailable old secrets; do not reuse or reset historical accounts. Final accessible labels must match the reviewed UI; current coordinated controls are Revisar cobro, Registrar decisión, Marcar cobrado, Comprobar resultado and Reintentar misma solicitud.

### Task 1: Shared independent fixture and transport support

**Files:** modify `tests/fixtures/clinical-local.ts`, `tests/e2e/clinical-path.spec.ts`; create `tests/fixtures/clinical-journey.ts`, `tests/fixtures/clinical-response-loss.ts`; extend `tests/unit/clinical-fixture-safety.test.ts` for the added gate/profile/request invariants. No `tests/hoy/*` or UI writes; those belong to Task2.

**Interfaces:**
```ts
type CaseRole = 'OWNER' | 'ASISTENTE' | 'COORDINADOR';
// Add role to a reusable auth identity; role accounts do not need a serviceId.
interface ClinicalStaffIdentity {
  role: CaseRole; userId: string; memberId: string; organizationId: string;
  email: string; password: string; secret: string; client: SupabaseClient;
}
createClinicalCaseFixture({specialty, receptionRole?, foreignOwner?}): Promise<ClinicalCaseFixture>;
// ClinicalCaseFixture owns db/admin, owner, optional reception/foreign owner,
// service per clinician, caseId, and close() that signs out all new sessions.
prepareSavedVisit(page, fixture, {actor, attachment}): Promise<VisitEvidence>;
closeClinically(page, fixture, visit): Promise<ClinicalCloseEvidence>;
registerFromAgenda(page, fixture, visit, decision): Promise<CloseReceipt>;
loseCommittedResponseOnce(page, {matchRequest, assertCommitted}): Promise<LossHandle>;
// LossHandle exposes observed promise/dispose; request identity is retained in memory.
```

- [ ] Extract existing enrollment/encryption/profile/org/service logic once. Preflight profile/version/real Auth+Storage and seven policy guards before writes; check both added gates rather than silently activating them. Create only requested fresh identities; create membership only after verified TOTP. Require current mfa_access_status allowed/sessionValid for every authenticated client. close() signs out all created clients and closes DB even after failure; retain rows/files.
- [ ] Replace global completed Map/serial dependencies with test-owned fixture. Keep one Playwright worker for local load, but ordinary independent test mode so one failure does not suppress remaining cases. Shared helpers prepare prerequisites within the case; no test consumes another test's IDs, payment or login. Archive policy change and revocation remain confined to their own case.
- [ ] Extract actual UI steps once: Sin turno→patient/arrival→save→optional upload; Guardar y cerrar; agenda registration/recovery. Return observed IDs/receipts and SQL evidence, never optimistic values. Do not insert sessions/payments directly to fake these prerequisites.
- [ ] Implement one-shot interceptor: exact app origin, POST server action, observed/compiled action ID and parsed action/turno identity; non-target routes fallback to existing network guard. For target validate loopback then route.fetch({maxRetries:0,maxRedirects:0}), validate business outcome and separately committed SQL, then route.abort('failed'). If commit cannot be verified, fail; never manufacture an ACK or claim rollback. Preserve timeout budget, dispose in finally, assert fired once. Do not identify writes solely by HTTP200 or blanket /hoy POST.
- [ ] Add focused meaningful safety tests for additional gates missing/false, forbidden request destinations and mismatched operation binding. Preserve existing negative cases. Before final UI SHA, typecheck/focused lint and safety tests plus twelve-case discovery are allowed; they do not prove real recovery. No runtime change/activation or heavy suite until Task2 approval.

### Task 2: Implement exactly twelve self-contained scenarios

**Files:** `tests/e2e/clinical-path.spec.ts` consumes only the shared support above. Use actual UI labels from the approved Task2 component; do not edit components to accommodate tests.

- [ ] Case1: real AAL1 cannot read staff membership or enter dual patient portal. Provision its own OWNER/portal link and preserve original denial assertions.
- [ ] Cases2–4, one per quiropraxia/cardiologia/psicologia: preserve walk-in, Córdoba date despite Auckland browser, encrypted value, revision, attachment/hash/bytes/proxy/direct-Storage denial. Then Guardar y cerrar(M106) must leave one locked original, CERRADO, no payment, CLINICAL/REQUIERE_REGISTRO and one POST_VISITA. Explicitly register cash by agenda RESOLVE; only then assert one persisted PAGADO payment. Fresh login/reopen/download preserve counts and original. Price-list amount never proves payment.
- [ ] Case5: provision its own target+foreign organizations and saved document. Preserve real cross-tenant REST/proxy and AAL1 clinical-read negatives; authenticate each actor normally. It does not consume Cases2–4.
- [ ] Case6: prepare its own authorized and foreign targets; pause only its synthetic subscription. Ordinary UI redirects to billing, authorized archive PDF/JSON is real, foreign PDF denied, provider charges zero. Preserve archive/absence checks and no server-mutation-gate claim.
- [ ] Case7: fresh AAL2 fixture token is denied by DB gate after real session revocation. No later case uses this account.
- [ ] Case8, direct CLOSE response loss: own saved ATENDIENDO visit; stable operationId/duration/decision. Forward the real close, prove committed receipt/payment/marker/job before abort. UI retains intent and prevents duplicate/contradictory actions. Click Comprobar resultado; authenticated get_turno_close_receipt POST with identical bound_input confirms. Same operation/payment, duration/closedAt/lock/revision/ciphertext/job; no additional write. Do not try a retry after UI already acknowledged.
- [ ] Case9, RESOLVE response loss: its own clinically closed unpaid visit, not Case8. Explicit pending decision; after committed RESOLVE abort. While uncertain click Reintentar misma solicitud: same operationId/payload returns original receipt and single payment. Then verify authorized receipt/current status; clinical original/duration/closedAt/job unchanged. No repeated CLOSE.
- [ ] Case10, settlement response loss: independently prepare closed visit and pending payment within this case. Forward marcarPagoCobradoAgendaAction, prove PAGADO commit, abort; deliberate retry keeps exact pagoId/turnoId. M121 returns alreadyPaid with unchanged pagadoTs/updatedAt/amount/method, one payment, no new M120 receipt and no clinical/job changes. Historical M120 PENDIENTE receipt must not downgrade current PAGADO. No settlement operationId invented.
- [ ] Case11, real ASISTENTE AAL2: OWNER prepares and clinically closes its own visit. Login new ASISTENTE via browser password/TOTP; membership/role/scope and mfa_access_status verified through its authenticated client. From agenda Revisar cobro→Registrar decisión creates one pending payment→Marcar cobrado settles that same payment. Assert UI/SQL/RPC current values and no clinical/duration/job changes. Finanzas navigation absent; direct /finanzas yields the app's denied/not-found rendering without finance content. Real role REST session read and file proxy expose no clinical data. No service_role in browser or test action request.
- [ ] Case12, real COORDINADOR AAL2: its OWNER prepares a paid closed target. Login new coordinator and prove current membership/scope/MFA. Agenda shows no financial controls/values, Revisar cobro/Registrar decisión/Marcar cobrado absent; Finanzas navigation and direct page denied. Its authenticated get_turno_close_status returns puedeRegistrar=false/pago=null even though admin observation confirms a payment exists. Real authenticated close_turno_atomic with financial decision, resolve_turno_close and settle_pago_atomic must reject42501; direct REST pago read exposes no rows. Assert payment/receipt/clinical/job snapshots unchanged after all attempts. An absent control alone is not proof of authorization.

For Cases11–12, request-level negatives use each role's actual newly issued AAL2 client/session, never forged claims. Direct-page denial must check rendered access outcome/no protected content as well as response status; Next streaming may return200 with a not-found boundary. Preserve strict absence assertions; do not accept login redirects as proof of an authenticated role denial. Confirm AAL2 and same account before/after probes.

### Task 3: Preserve runtime, apply reviewed schema, activate after UI approval

**Files:** ignored runtime executor/evidence only; source changes to test helpers/spec must be committed and reviewed first. No new migration file.

- [ ] Root pins final SHA after independent Task2 and test review. Preserve runtime's eight approved diffs in an ignored binary patch plus explicit-path stash/OID, keep untracked AGENTS/evidence, switch detached to that SHA. No clean/reset, stale stash replay or env copying. Verify profile/config identical and dependencies frozen/offline if needed; do not restart Supabase unnecessarily.
- [ ] Reinventory fixtures/volumes/M106. Require exactly two missing versions and reviewed digests: M120 20260912200817 / 3a8047fee2323c671def88c6976f91a2dcb9b8d401cd70ba51aa7038b7260464; M121 20260912204646 / f0fbd4a705b1266b999ba4a24c08a7cc7f1795c6433ba0f1d6bb867fcf916fec. Unexpected migration/schema state stops the step.
- [ ] Use a local pg runner with status credentials only in memory: BEGIN; execute M120 exact SQL and parameterized canonical ledger(version,name,statements); execute M121 and ledger; verify115 versions and both gates initially off; COMMIT, or ROLLBACK all. Keep SQL15s. Names are M120_turno_close_atomic and M121_payment_settlement_authority. Preserve historical closures without fabricated marker/time/payment/jobs.
- [ ] Only with compatible reviewed UI present and M106 active, one administrative local transaction calls enable_turno_atomic_close(reason), then enable_payment_settlement_authority(reason), with auditable reason including final SHA. Verify both policies and one activation-history row each. No direct policy edits/disable or production calls. Record same retained fixtures/volumes.

### Task 4: Real validation and reviewable checkpoint

**Files:** `scripts/testing/CLINICAL-LOCAL.md`, `tests/e2e/README.md`; ignored runtime report/ledger/brief. Root owns whole-branch build/release docs and review.

- [ ] Coordinate zero parallel heavy load. Execute the dedicated real runner with tracesoff/reportlist for all12 cases, no skips. Collect exact per-case outcomes and commit-before-abort evidence. Preserve any failure as RED; diagnose before a new attempt or scoped fix. Do not add retries/timeouts to make it pass.
- [ ] Run typecheck, focused lint, meaningful safety tests and appropriate final branch checks once after source settles; coordinate build/fullunit with root. Discovery/fake isolation tests never count as real case completion.
- [ ] Report final app SHA,115 versions/digests, activeM106/M120/M121, role/session proof, case counts, same-operation/payment evidence and original/job invariants. Retain baseline7/7 and failed-run history separately. No claim about providers, production, or runtime latency from a development run.
- [ ] Commit explicit owned test/docs paths only after index coordination; ignored reports never staged. Independent review checks guards, roles, transport truth and absence of cross-test dependencies before root publishes an integration candidate.
