# Atomic Visit Close Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make appointment close, the explicit financial decision and their recovery durable, while preserving immutable clinical records.

**Architecture:** An additive migration captures a durable administrative close and POST_VISITA in the transaction that closes the appointment, including M106. New guarded functions close an active appointment with an optional explicit payment decision, recover receipts and resolve administrative payment on an already closed appointment. Existing clinical revision logic is preserved. New server/UI callers are a subsequent task after the SQL interface is proven.

**Tech Stack:** PostgreSQL 16/17, existing Supabase Auth/RLS helpers, SQL regression and real concurrent local PostgreSQL connections; TypeScript callers follow after this task.

**Spec:** `docs/CLOSE-RELIABILITY-SPEC.md` and `docs/LAUNCH-RELIABILITY.md`.

## Global Constraints

- Work only in `C:/Users/amiun/Documents/Codex/folio-reliability`, branch `codex/launch-reliability`.
- Append-only schema. Generate a new migration with the existing Supabase CLI after reading its help. No applied migration edits, production connections or deployment.
- Preserve M106's clinical writer and receipt checks, original locking, operation identity, clinician scoping and current MFA/session validation.
- COORDINADOR may close without financial rights; ASISTENTE may record collection through agenda but not read clinical records; PROFESIONAL may operate only on own appointments/payments.
- No closure without explicit payment data may invent PAGADO, PENDIENTE or SIN_CARGO. Existing payments win and cannot be silently changed by closing.
- Recovery cannot edit clinical state/content, duration or original close time. Same operation and same request recover the receipt; different content conflicts.
- Explicit requested payment failure rolls back a new close; committed clinical close remains closed with durable administrative recovery.
- No network/provider effects during SQL, tests or migrations. POST_VISITA is only queued with original close time + 2 hours and ON CONFLICT DO NOTHING.
- New enforcement starts disabled and must reject legacy direct/redundant close writes after activation while accepting M106's genuine private WRITE authority and the new RPC. Never accept a client-set GUC as authority.
- No permanent changes to shared local roles, no resetting/deleting existing databases, no reading `.env*`. Use a newly created synthetic test database per replay.

---

### Task 1: Implement and prove the database boundary

**Files:**
- Create: one new CLI-named M120 migration, SQL regression `tests/sql/M120_turno_close_atomic.spec.sql`, staged-rollout regression `tests/sql/M120_turno_close_expand.spec.sql`, concurrency runner `tests/integration/turno-close-concurrency.mjs`, and `docs/M120-TURNO-CLOSE-ATOMIC.md`.
- May add a focused SQL fixture file in `tests/fixtures/` if shared by the two new specs; do not edit historical SQL fixtures.
- Do not change server actions, UI, existing migrations, test isolation runners, the financial confirmation task or clinical preflight task.

**Interfaces:**
- Consumes: current `turno`, `pago`, `sesion`, `recordatorio_job`, M106 private authority/receipt, M101 authorization helpers and existing role/professional policies.
- Produces: documented SQL signatures and minimal JSON results for close with optional explicit payment decision, administrative resolution on a closed visit, current close status and operation receipt recovery, plus an audited service-only activation function. The SQL implementation defines and records exact parameter names/types before a TypeScript caller is started; do not publish an undocumented contract.

- [ ] Read the spec and relevant definitions M09/M92/M101/M106/M108/M117/M119. Record the chosen exact SQL interface in the task report before implementation; preserve the spec's behaviors even if private table layout differs.
- [ ] Reproduce the existing split close/payment defect with real PostgreSQL transactions and a deliberate payment-write failure. Capture the prior CERRADO/no-payment state as the RED evidence without altering any existing test database. Include the clinical CLOSE path, whose M106 transaction currently precedes the financial follow-up.
- [ ] Implement the additive schema, guarded close/payment/recovery/status/activation functions and private trigger. Validate state, role, organization, current member/assignment, request shape and safe numeric bounds before effects, and after lock waits where authority can change. Use stable lock order compatible with M106.
- [ ] Add SQL regressions for explicit paid/pending/zero, absent decision, payment preservation/conflict, denied roles/tenants/AAL, recovery without clinical mutation, reused receipt with changed request, rollback after payment/queue failure, and M106 clinical close/receipt retry. The test must observe stored data and revision/transition/job counts.
- [ ] Add real two-connection cases: identical concurrent requests, conflicting decisions, new close versus administrative resolve, and changed assignment/authority while waiting where supported by the locking contract. Use time-bounded synchronization rather than arbitrary long sleeps, and retain synthetic fixtures for inspection.
- [ ] Prove additive mode preserves old writers before activation and guarded mode rejects legacy close/no-op close after activation without letting legacy automatic payment follow-up run. M106 authorized close still works. Validate only service/platform administration can activate.
- [ ] Replay the entire migration chain with default PostgreSQL16 function-body checks in a new test DB and run new SQL regressions/concurrency. Existing baseline replay uses the repository runner, with local execution identity postgres as required by platform guards; root can provide a fresh DB and an existing safe runner copy.
- [ ] Run targeted script lint and `git diff --check`. Write `.flow/launch-reliability/atomic-close-report.md` with RED/GREEN, commands, exact interfaces, migration version and digest, staged rollout, limitations and self-review. Do not claim Auth/Storage E2E or production coverage.
- [ ] Commit only the new task files. Independent review checks spec and quality before caller implementation begins.

## Preflight review

| Pair/task | Shared interface or agreement | Finding |
|---|---|---|
| New close / M106 | Both lock turno before the clinical original; M106 private authority permits true clinical close | Do not duplicate or weaken M106 writer |
| New close / old writers | Additive migration first, enforcement only after compatible callers | Must test activation and legacy no-op close |
| Resolve payment / finance settlement | Initial registration differs from saldar existing PENDIENTE | Preserve existing UPDATE settlement path |
| Close / reminder queue | Queue inside transaction, dispatcher sends later | Preserve existing job and time on retry |
| SQL task / future TypeScript task | Exact interface becomes documented before callers begin | No parallel implementation of guessed signatures |

This plan covers the independently reviewable database part; it does not close the overall launch goal or the user-facing close defect until the compatible callers and recovery UI are integrated and tested.
