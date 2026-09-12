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
// service per clinician, caseId, and close() that revokes API/browser sessions and closes contexts/DB.
loginClinical(page, identity, destination?): Promise<void>;
assertBrowserActor(page, identity): Promise<{userId: string; sessionId: string}>;
prepareSavedVisit(page, fixture, {actor, attachment}): Promise<VisitEvidence>;
closeClinically(page, fixture, visit): Promise<ClinicalCloseEvidence>;
registerFromAgenda(page, fixture, visit, decision): Promise<CloseReceipt>;
loseCommittedResponseOnce(page, {matchRequest, assertCommitted}): Promise<LossHandle>;
// LossHandle exposes observed promise/dispose; request identity is retained in memory.
```

- [ ] Extract existing enrollment/encryption/profile/org/service logic once. Preflight profile/version/real Auth+Storage and all nine guards before any fixture write: seven existing conditions plus M120/M121. Remove the seven global enable/enforcement calls from the per-case fixture; it only checks, never heals or activates policy. Administrative cutover is Task3. Create only requested fresh identities; create membership only after verified TOTP. Require current mfa_access_status allowed/sessionValid for every authenticated client. Register clients in the cleanup registry from their first successful login, before enrollment or later provisioning can fail; do not wait for accounts.push after enrollment. Register browser session tokens/context on login too. In finally, revoke each owned API/browser session through real Auth (including OWNER before role switch), close contexts, then DB; preserve the original failure while reporting cleanup failure and retain all rows/files. Verify session revocation rather than treating cookie/context deletion as logout.
- [ ] Replace global completed Map/serial dependencies with test-owned fixture. Keep one Playwright worker for local load, but ordinary independent test mode so one failure does not suppress remaining cases. Shared helpers prepare prerequisites within the case; no test consumes another test's IDs, payment or login. Archive policy change and revocation remain confined to their own case.
- [ ] Update the shared login helper to the observed primary password form button `getByRole('button',{name:'Ingresar a Folio',exact:true})` from components/auth/login-form.tsx:307; the old /^entrar/i selector targets a different text. Preserve the existing MFA/navigation checks and all timeouts. A stale selector fails explicitly; no permissive fallback.
- [ ] Implement assertBrowserActor from the actual browser session, not identity.client. After UI MFA, read that context's session cookies only in memory using the installed SSR cookie decoding/client support; validate the resulting token with local Auth getUser and require expected userId. From the same browser token require aal2 and a session_id, confirm the real current mfa_access_status RPC is allowed/sessionValid and the active organization/member role. Cookie/JWT decoding alone is not authentication proof. Observe the actual server-action POST cookie header and recheck that session/user/role binding (including refresh) before attributing a financial action or denial to the role. Do not create a product test endpoint or inject credentials/cookies.
- [ ] Extract actual UI steps once: Sin turno→patient/arrival→save→optional upload; Guardar y cerrar; agenda registration/recovery. Return observed IDs/receipts and SQL evidence, never optimistic values. Do not insert sessions/payments directly to fake these prerequisites.
- [ ] Implement one-shot interceptor: exact app origin, POST server action, observed/compiled action ID and parsed action/turno identity; non-target routes fallback to existing network guard. For target bind the complete action type, turno and decision/duration (CLOSE/RESOLVE) or pagoId+turnoId (SETTLE); capture the real request operationId in memory and compare bound_input/receipt for that same actor/organization. Validate loopback then route.fetch({maxRetries:0,maxRedirects:0}), validate business outcome and separately committed SQL, then route.abort('failed'). If fetch, parse, binding or commit-check fails, reject LossHandle.observed, resolve/abort the intercepted route and dispose in finally; no hanging promise/route may masquerade as successful response loss. Preserve timeout budget and assert fired once. No settlement operationId, manufactured ACK, rollback claim, HTTP200-only or blanket /hoy POST identification.
- [ ] Add focused meaningful safety tests for additional gates missing/false, forbidden request destinations, complete operation binding and cleanup/observed rejection on fetch/parse/commit-check failure; also exercise enrollment-failure session cleanup without substituting successful real E2E responses. Preserve existing negative cases. Before final UI SHA, typecheck/focused lint and safety tests plus twelve-case discovery are allowed; they do not prove real recovery. No runtime change/activation or heavy suite until Task2 approval.

### Task 2: Implement exactly twelve self-contained scenarios

**Files:** `tests/e2e/clinical-path.spec.ts` consumes only the shared support above. Use actual UI labels from the approved Task2 component; do not edit components to accommodate tests.

- [ ] Case1: real AAL1 cannot read staff membership or enter dual patient portal. Provision its own OWNER/portal link and preserve original denial assertions.
- [ ] Cases2–4, one per quiropraxia/cardiologia/psicologia: preserve walk-in, Córdoba date despite Auckland browser, encrypted value, revision, attachment/hash/bytes/proxy/direct-Storage denial. Then Guardar y cerrar(M106) must leave one locked original, CERRADO, no payment, CLINICAL/REQUIERE_REGISTRO and one POST_VISITA. Explicitly register cash by agenda RESOLVE; only then assert one persisted PAGADO payment. Fresh login/reopen/download preserve counts and original. Price-list amount never proves payment.
- [ ] Case5: provision its own target+foreign organizations and saved document. First assert target existence and an authorized OWNER document download; preserve real cross-tenant REST/proxy and AAL1 clinical-read negatives against those same IDs, and authenticate each actor normally. It does not consume Cases2–4.
- [ ] Case6: prepare its own authorized and foreign targets, confirm both exist and their owners can access them, then pause only its synthetic subscription. Ordinary UI redirects to billing, authorized archive PDF/JSON is real, foreign PDF denied, provider charges zero. Preserve archive/absence checks and no server-mutation-gate claim.
- [ ] Case7: fresh AAL2 fixture token is denied by DB gate after real session revocation. No later case uses this account.
- [ ] Case8, direct CLOSE response loss: own saved ATENDIENDO visit; stable operationId/duration/decision. Forward the real close, prove committed receipt/payment/marker/job before abort. UI retains intent and prevents duplicate/contradictory actions. Click Comprobar resultado; authenticated get_turno_close_receipt POST with identical bound_input confirms. Same operation/payment, duration/closedAt/lock/revision/ciphertext/job; no additional write. Do not try a retry after UI already acknowledged.
- [ ] Case9, RESOLVE response loss: its own clinically closed unpaid visit, not Case8. Explicit pending decision; after committed RESOLVE abort. While uncertain click Reintentar misma solicitud: same operationId/payload returns original receipt and single payment. Then verify authorized receipt/current status; clinical original/duration/closedAt/job unchanged. No repeated CLOSE.
- [ ] Case10, settlement response loss: independently prepare closed visit and pending payment within this case. Forward marcarPagoCobradoAgendaAction, prove PAGADO commit, abort; deliberate retry keeps exact pagoId/turnoId. M121 returns alreadyPaid with unchanged pagadoTs/updatedAt/amount/method, one payment, no new M120 receipt and no clinical/job changes. Historical M120 PENDIENTE receipt must not downgrade current PAGADO. No settlement operationId invented.
- [ ] Case11, real ASISTENTE AAL2: OWNER prepares its own visit with attachment:true, confirms real document/Storage identity and a successful OWNER proxy download with exact bytes, then closes clinically. Revoke the OWNER browser session and close its context after preparation, then create a new guarded context with empty cookies/storage and login new ASISTENTE via password/TOTP. Require assertBrowserActor for the expected assistant user/session before actions and for the actual POSTs; membership/role/scope and mfa_access_status must use that browser session, not only its separately enrolled fixture client. From agenda Revisar cobro→Registrar decisión creates one pending payment→Marcar cobrado settles that same payment. Assert UI/SQL/RPC current values and no clinical/duration/job changes. Finanzas navigation absent; direct /finanzas yields the app's denied/not-found rendering without finance content. Real role REST session read and file proxy expose no clinical data. No service_role in browser or test action request.
- [ ] Case12, real COORDINADOR AAL2: its OWNER prepares a paid closed target. Revoke the OWNER browser session and close its context, create a new guarded context with empty cookies/storage and login new coordinator. Prove expected coordinator identity/current membership/scope/MFA with assertBrowserActor and bind all actual requests to that browser session. Agenda shows no financial controls/values, Revisar cobro/Registrar decisión/Marcar cobrado absent; Finanzas navigation and direct page denied. Its authenticated get_turno_close_status returns puedeRegistrar=false/pago=null even though admin observation confirms a payment exists. Real authenticated close_turno_atomic with financial decision, resolve_turno_close and settle_pago_atomic must reject42501; direct REST pago read exposes no rows. Assert payment/receipt/clinical/job snapshots unchanged after all attempts. An absent control alone is not proof of authorization.

For Cases11–12, request-level negatives use the role token from its actual fresh browser context, validated as above; never the OWNER session, a separately enrolled AAL2 client as sole proof, or forged claims. Merely navigating an authenticated OWNER page to /login does not switch roles. The context creation must use the shared browser fixture/network guard and cleanup in finally. Direct-page denial must check rendered access outcome/no protected content as well as response status; Next streaming may return200 with a not-found boundary. Preserve strict absence assertions; do not accept login redirects as proof of an authenticated role denial. Confirm AAL2 and same account before/after probes.

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
