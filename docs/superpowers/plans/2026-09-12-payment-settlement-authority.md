# Current Authority for Payment Settlement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement and independently review this task.

**Goal:** Prevent a waiting payment-settlement request from committing after its actor loses the relevant appointment/member scope.

**Architecture:** An additive migration exposes an idempotent, authorized settlement transaction. It locks appointment and authorization sources before payment, preserving M120's lock order. A separately activated private guard prevents direct REST settlement from bypassing that boundary after compatible callers are deployed. Existing finance permission gates remain in their wrappers; the database also supports a scoped closed-visit assistant collection entry.

**Spec:** `docs/CLOSE-RELIABILITY-SPEC.md`, extended by the reproduced case in `.flow/launch-reliability/settlement-scope-race-review.md` and this plan's invariants. Current callers must no longer assume a guarded REST UPDATE rechecks changed authorization after a lock wait.

## Global Constraints

- Work only in folio-reliability; append a CLI-named M121 migration. Do not edit the reviewed M120 migration or older applied schema. No production, provider, real payment, env-file reads or reset/deletion of existing DBs.
- Preserve current finance scope: OWNER/DIRECTOR organization, PROFESIONAL own appointments, ASISTENTE allowed reception scope on a closed visit through agenda, COORDINADOR denied. No new access to clinical records or Finanzas page.
- No clinical write, appointment state/duration change, new payment insertion, payment association change, amount/method edit or reminder side effect during settlement. This task only confirms an existing payment as PAGADO without overwriting an already-paid timestamp.
- No generic new receipt subsystem. Idempotency is the same existing payment's confirmed state, with current authorization checked on every call. A lost response can query/retry that same existing payment safely; never return success from zero affected rows alone.
- Activation starts disabled, is audited/service-only/one-way and requires the preceding compatible policy prerequisites. Test legacy UPDATE before and after activation; never require cutting over production now.
- Reports under .flow stay ignored; never force-add. Coordinate the shared git index with root before commits.

### Task 1: Implement and prove the settlement boundary

**Files:** New M121 SQL migration; focused new SQL spec and fixture if needed; new bounded concurrent settlement runner; docs/M121-PAYMENT-SETTLEMENT.md. May make the two approved nonfunctional improvements in tests/sql/M120_turno_close_atomic.spec.sql and docs/M120-TURNO-CLOSE-ATOMIC.md. No server/UI changes in this task.

- [ ] Record exact signatures and JSON contract before implementation. Reuse the proven M120 authorization/lock conventions where safe. Bind current payment to the requested appointment and active organization, rechecking its association after waiting; document finance versus closed-agenda requirements clearly.
- [ ] Preserve reported actual RED evidence: three separate waiting-UPDATE races (reassignment, revocation, reception scope loss) each committed one PAGADO row while a subsequent fresh statement affected zero rows. Retain the original fixtures/evidence, not a synthetic mock assertion.
- [ ] Implement authorized settlement: lock turno, current authorization sources, then pago; revalidate after waits; transition only the existing allowed payment, preserve previous paid timestamps on retries and return real stored fields including id, amount/method/state/timestamps. Fail closed on moved association, wrong organization/role/scope and invalid shape.
- [ ] Implement a private transactional authority and a staged guard for changes to pago.estado/pagado_ts. After activation, authenticated direct REST writes cannot bypass the new transaction, including redundant or mixed UPDATE forms as applicable. Do not treat client GUCs as authority; preserve explicitly trusted platform maintenance and unchanged non-settlement operations without creating a privilege bypass.
- [ ] Test initially disabled compatibility, service-only activation, refusal of anonymous/coordinator/cross-tenant and out-of-scope actors, assistant closed-visit requirements, paid idempotency, guarded update failure rollback and real receipt/current-state response. Confirm no other clinical/payment/job fields change.
- [ ] Repeat the three races with the new RPC using deterministic lock coordination; revoked/reassigned/out-of-scope request must reject without settling. Also prove a valid request retains its authority through commit, parallel identical settlements preserve one paid timestamp, and an uncertain same-payment retry does not reapply effects.
- [ ] Apply the minor M120 review suggestions: null-safe JSON assertions and explicit default POST instruction for locking logical reads. Do not change the M120 implementation or digest.
- [ ] Replay the full migration chain/new specs in a fresh dedicated PostgreSQL16 DB with existing safe runner, run final concurrency and targeted lint/diff checks. Report exact source/digests/counts and limitations; no claim of real Auth/Storage E2E from stubs.
- [ ] Commit only scoped files after index coordination; independently review this boundary before Task1 of the caller plan consumes its contract.

## Preflight review

| Pair/task | Shared boundary | Ruling |
|---|---|---|
| Legacy settlement / current permissions | Statement may retain an old RLS snapshot while waiting | Replace with lock-aware RPC plus durable enforcement |
| M120 / M121 | Lock order and current authorization | Reuse conventions; preserve reviewed close/resolve semantics |
| Finance / agenda assistant | Same operation, different page access and visit prerequisites | Keep finance page gate; enforce scoped closed-visit assistant access in DB |
| Settlement / close receipts | Receipt can predate later settlement | Return real current payment, never rewrite original close receipt |
| Activation / code | Additive migration first, compatible caller next | Default disabled and documented staged enablement |
| Task / tests | Local SQL races are necessary evidence, not hosted authentication | Keep real Supabase verification separate |
