# Confirmed Close Callers and Administrative Recovery Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Give staff an honest, recoverable close/payment flow backed by the reviewed M120 transaction, including clinical close without an inferred payment.

**Architecture:** Typed server adapters validate complete SQL receipts and preserve operation identity. Agenda close and administrative resolution use an explicit operation coordinator with confirmed, failed and uncertain outcomes. Closed agenda rows offer authorized payment review independently of clinical access. Clinical CLOSE keeps M106 and only reads administrative status afterward.

**Tech Stack:** Existing Next.js server actions, React, Zod, Result, Supabase RPC, isolated action/component tests and a real local Supabase clinical journey.

**Spec:** `docs/CLOSE-RELIABILITY-SPEC.md`. Exact SQL contract and evidence: `docs/M120-TURNO-CLOSE-ATOMIC.md` after completion of the preceding SQL task.

## Global Constraints

- Work only in `folio-reliability`, branch `codex/launch-reliability`. Do not edit the live visual worktree or public stylesheet. Preserve existing visual tokens and accessibility patterns.
- Start implementation only after the SQL task is independently approved. If its final interface differs from the initial report, update this plan and brief before dispatch.
- Never fall back to direct UPDATE CERRADO or an automatic payment upsert. A missing RPC or disabled required policy is an actionable rollout error, not permission to use a legacy writer.
- Preserve non-close transitions, reassignment constraints, M106 revision/receipt semantics, clinical immutability, and finance settlement behavior.
- Only real persisted payment data may enter Recaudado or debt totals. Neither optimistic request data, a list price, absence of a payment, nor a malformed receipt proves financial success.
- Same uncertain operation retains its exact request. A read-only probe returning no receipt does not prove an in-flight write failed. A deliberate retry uses the same ID and payload, serialized by the database; a different intent requires a settled outcome.
- Avoid copying names, clinical content or payment details into browser persistent storage. If navigation/reload discards an in-memory attempt, reload the authorized current status and require review before another operation; do not silently restore or resubmit a guessed request.
- No production migration, deployment, provider delivery or actual money movement. Local synthetic tests only. Every .flow report remains ignored and outside commits.

---

### Task 1: Implement typed RPC adapters and honest clinical close

**Files:** Create a small shared close contract/schema module and a `lib/db` close adapter; modify `lib/db/turnos.ts`, `lib/db/errors.ts`, `app/(app)/hoy/actions.ts`, `app/(app)/pacientes/actions.ts`; extract the proven settlement logic from `app/(app)/finanzas/actions.ts` into a shared `lib/db` payment helper; add focused real-action/adapter tests and extend clinical/finance action tests. No UI or SQL changes in this task.

**Inputs:** Reviewed M120 close, resolve, status and receipt signatures; session organization; explicit operation ID from caller; optional duration and financial decision. Zero is normalized to exactly `{montoCents:0}`; absent decision is SQL NULL. Positive values preserve the exact enum and boolean.

**Outputs:** Shared typed status and operation receipt matching the final SQL contract, including real payment and classification. Read-only receipt action returns a validated receipt or null. Other transitions retain their existing result compatibility; close cannot return a legacy boolean as its only evidence.

Close/resolve failures carry `error.mutationOutcome: "rejected" | "uncertain" | "review_required"`. Add this optional field to the existing error contract without changing ordinary errors. The close-specific adapter requires a disposition on every failed result; unknown/missing disposition at the UI boundary is uncertain. SQL 55000 is review_required. Known transactional SQL rejection is rejected; thrown transport, unrecognized write error, or invalid success receipt is uncertain. Do not make a second error taxonomy from message text.

- [ ] Reproduce the old second UPDATE/payment write after a committed clinical CLOSE with the actual action body. Add a RED case where revalidation throws after a committed write; cache refresh failure must not change the confirmed clinical outcome to a failed-save result.
- [ ] Validate inputs before any RPC. Take organization from active session, not client. Verify returned turnoId, operationId, final state, timestamps, classification/payment relationships and requested operation identity; malformed success after a write is uncertain.
- [ ] Delegate only CERRADO in `transitionTurno` to the new adapter; require a valid operation ID for new closes, remove its payment-upsert and post-response POST_VISITA scheduling. Preserve the cancellation hooks and ordinary transitions.
- [ ] Add server actions for administrative resolution, status and read-only receipt. Map known SQL rollback/conflict/authorization errors without leaking SQL or PHI; transport interruption and unrecognized write outcomes stay uncertain. Do not blindly perform a new write during recovery.
- [ ] Preserve the Finanzas wrapper's canSeeFinanzas plus canRegistrarCobro gate. Extract its proven authorized read, guarded settlement and authorized zero-row reread into a shared helper. Add an agenda settlement wrapper gated canRegistrarCobro and binding the payment to the requested closed turno, active organization and current professional scope. ASISTENTE can complete collection there without gaining access to Finanzas or clinical records. Return current persisted payment, including identity and updatedAt; preserve uncertainty after lost response and never invent another registration/receipt mechanism for settlement.
- [ ] Remove `transitionTurno(CERRADO)` from `saveSesionYCerrarAction`. Keep the existing M106 commit and receipt, then read status. Show explicit follow-up text for REQUIERE_REGISTRO or unconfirmed status; a status or revalidation failure cannot undo confirmed clinical success. No automatic payment or message side effect.
- [ ] Cache invalidation runs best-effort after confirmed mutations and includes affected agenda/patient/finance views as appropriate. Receipt/status reads are side-effect free. Confirm that exceptions do not leak or trigger duplicate mutations.
- [ ] Tests exercise actual modules with only framework/persistence boundaries replaced: absent/zero/positive decisions, contradictory or malformed receipt, current authorization failure, loss of response, read-only null receipt, removal of redundant clinical write and post-commit cache failure. Existing clinical revision and finance tests remain meaningful.
- [ ] Validate role-dependent redaction and historical null close time against the approved SQL contract. REGISTRADO with payment redacted for COORDINADOR is not an absent payment. Use the default POST RPC transport; a logical read-only function that retains authorization locks must not be forced into a read-only GET transaction. Add agenda settlement negatives for wrong turno/payment, revoked scope and coordinator, while preserving the prior finance zero-row regression.
- [ ] Run focused tests, typecheck, lint and full unit suite once after final code changes; record exact evidence, self-review and explicit files in a commit. Independent review before Task 2.

### Task 2: Retain close intent, confirm actual payment and expose recovery in agenda

**Files:** `components/hoy/dashboard.tsx`, `turno-list.tsx`, `turno-row.tsx`, `cerrado-row.tsx`, `cobro-cierre-dialog.tsx`; a small focused operation helper or recovery component if needed; `lib/hoy/kpi-cobro.ts`, `lib/types.ts`, `lib/db/hoy.ts` only for necessary payment display data/freshness; focused real-component/operation regression tests. No SQL/server-contract changes unless root adjudicates an actual mismatch first.

**Inputs:** Task 1 validated actions and shared types. Existing refreshed Turno payment values remain authoritative when newer than a receipt, particularly settlement of an existing PENDIENTE payment.

- [ ] Keep the selected amount/method/debt and dialog open while a request is pending or uncertain. Prevent duplicate submits, Escape/backdrop dismissal and contradictory edits; expose clear progress and recovery controls with accessible focus/labels.
- [ ] Own dialog selection, operation and rendering in Dashboard or a Dashboard-owned helper, outside row grouping/filtering. A refresh that changes TurnoRow into CerradoRow must not unmount recovery. Reuse useModalA11y closeDisabled. Keep actual appointment state plus pending progress until confirmation; no optimistic close projection is necessary.
- [ ] Use one stable ID and immutable snapshot per CLOSE or RESOLVE. An uncertain request keeps its snapshot and blocks another write on that appointment. Offer read-only check and explicit retry of the same request; don't use a missing receipt alone as proof of rollback.
- [ ] Close state may indicate pending progress but must not claim completion or increase Recaudado/debt from optimistic money. On ACK project only the validated actual payment/classification. Preserve existing late-refresh barriers and unrelated appointment independence.
- [ ] Preserve payment identity and real updatedAt from the SQL contract and agenda data. Use one same-payment freshness merge for both ACK and equal-state SSR refresh; an older receipt or refresh cannot overwrite a newer financial row. Read actual payment fields in a batch using the already-selected pago IDs if the existing view omits updated_at; no per-row RPC fanout. Do not impose an undocumented irreversible PAGADO rule when an actual newer financial update exists. Preserve confirmed classification when SSR lacks marker data.
- [ ] Handle coordinator close without financial input, with the same uncertainty protection. Never show payment controls for a role without canRegistrarCobro, including manipulated UI state.
- [ ] Replace the unconditional «sin cargo» label on a closed row with conservative «Registro por revisar» when no confirmed payment or classification is available. A confirmed SIN_CARGO can be shown as such; failed status retrieval cannot become free care.
- [ ] Add a small «Revisar cobro» entry on closed agenda rows for authorized staff, including ASISTENTE, without opening clinical details or requiring Finanzas. Fetch current status on open, distinguish historical/unregistered/free/recorded, and offer initial administrative registration only when permitted. Do not classify REQUIERE_REGISTRO as a debt.
- [ ] Resolve a closed visit through RESOLVE only; never transition or write clinical content/duration. If payment exists, display it and direct authorized settlement to the existing supported action instead of overwriting it. No new financial product scope.
- [ ] Use the agenda settlement action from Task1 for an existing debt, including ASISTENTE; that action must not create a new RESOLVE operation. Recovery controls are independent buttons whose mouse and keyboard activation cannot bubble into clinical navigation. Snapshot duration once before close, check 0..480 and present an actionable correction for a long-open visit; receipt probes retain that exact value.
- [ ] Tests use real handlers/components and delayed responses: double click, network loss, changed intent, stale refresh, payment settled after receipt, dialog preservation, assistant recovery and coordinator denial, historical absence versus explicit free care. Replace old automatic-payment test expectations deliberately and document the behavior change.
- [ ] Run targeted tests, typecheck, lint and full unit suite; include an isolated browser interaction test if handler tests cannot prove focus/dismissal behavior. Record evidence and commit only task files, then independent review.

### Task 3: Prove the integrated journey and publish an integration candidate

**Files:** Clinical E2E scenario/fixture only where the intended flow or new gate requires it; launch evidence/runbook docs. Any discovered product defect becomes a bounded reproduction and fix, not a permissive test rewrite.

- [ ] Update the local runtime to the approved branch snapshot, inspect its known synthetic state and apply only the new migration. Activate the new gate via the audited local administration function after compatible code is present. Do not reset the existing local fixtures or read production environment files.
- [ ] Change the clinical journey to prove Guardar y cerrar leaves no fabricated payment, then explicitly record the cash decision through agenda, reopen and observe exactly one original/session/payment. Preserve existing Auth/TOTP/Storage, timezone and cross-tenant negatives.
- [ ] Add/execute user-facing interruption and retry evidence for direct close and administrative recovery, using the real database. Clearly distinguish browser transport interruption from a SQL rollback test. Retain original locking, revision and job count assertions.
- [ ] Run appropriate build and final branch checks once on the final candidate; report exact SHA, migration version/digest, SQL/concurrency evidence and E2E counts without omissions. Request independent whole-branch review and address load-bearing findings.
- [ ] Update launch docs with completed scope, external prerequisites and integration dependency on unpublished market-ready work; identify conflicts with visual work by read-only comparison. Prepare a reviewable integration candidate without merging/deploying production.

## Preflight review

| Pair/task | Shared interface | Ruling |
|---|---|---|
| SQL / Task1 | Exact M120 parameters, status, immutable receipt | Implementation waits for approval; adjust plan to final contract |
| Task1 / Task2 | Shared typed action inputs/receipts | Sequential review avoids speculative callers |
| Clinical close / cache | M106 commit precedes presentation/cache operations | Confirmed clinical success survives those later failures |
| Task2 / finance | Receipt may predate a later settlement | Never downgrade a known current payment using an old receipt |
| Task2 / refresh/reload | Memory retains exact in-flight operation; server retains durable status | Read current state after navigation; no automatic resubmission |
| Task2 / role access | ASISTENTE has payments but not clinical/Finanzas | Recovery must be available directly in agenda |
| Task2 / display | No payment is not proof of gratuity | On-demand status avoids a new per-row RPC fanout; conservative label until read |
| Task3 / baseline E2E | Existing path expects historical automatic cash | Change only with deliberate new explicit administrative step and assertions |
| Task3 / public launch | Technical candidate versus production delivery | Final publication remains separately authorized with explicit external prerequisites |

## Independent plan review and rulings

`/root/close_caller_plan_review` found four load-bearing omissions in the initial plan. All are accepted above: dialog ownership across active/closed row lifecycle; freshness on equal-state refresh as well as ACK; assistant settlement through an agenda wrapper preserving Finanzas permission; and a fixed failed/uncertain/review disposition. Report `.flow/launch-reliability/close-caller-plan-review.md`.

Root refinement of freshness recommendation: use existing `pago.updated_at` and identity, rather than assuming all paid states are permanently monotonic. SQL implementer was asked to include nested pago.updatedAt before the interface is finalized. This is an additional projection of an existing column, not a new versioning system or financial feature. Source clinical/finance scope and ordinary transitions remain unchanged.
