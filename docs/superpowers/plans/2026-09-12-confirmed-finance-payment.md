# Confirmed Finance Payment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Never announce a payment as collected unless the authorized operation updated it or a fresh authorized read confirms it was already collected.

**Architecture:** Preserve the existing server action contract `marcarPagoCobradoAction(pagoId: string): Promise<Result<void>>`. Keep RLS, session-derived organization and professional scope. An UPDATE returning zero rows triggers a new read with the same authorization checks; it is successful only when that readable, scoped payment is PAGADO.

**Tech Stack:** Next.js 15, TypeScript, Supabase/PostgREST, node:test with the existing isolated runner.

**Spec:** `docs/LAUNCH-RELIABILITY.md`, finding 2.

## Global Constraints

- Only change `app/(app)/finanzas/actions.ts` and the dedicated new unit test `tests/unit/finanzas-charge-action.test.ts` in this task.
- Keep `Result<void>`, Spanish user messages, session-derived tenant and professional scope, and existing authorization rules.
- No production access, provider calls, environment-file reads, UI redesign, schema changes or service-role bypass.
- Never retry a write blindly. Never change an already recorded payment timestamp.
- Execute the actual action body with controlled persistence/framework boundaries. Do not settle for source-text assertions.

---

### Task 1: Verify payment persistence before returning success

**Files:**
- Modify: `app/(app)/finanzas/actions.ts` (`marcarPagoCobradoAction`).
- Create/Test: `tests/unit/finanzas-charge-action.test.ts`.
- Reference: `tests/unit/finanzas-actions.test.ts` for transpile/VM isolation; `lib/auth/finanzas-scope.ts` and `lib/db/errors.ts` for current contracts.

**Interfaces:**
- Consumes: `getActiveSession`, `capabilitiesFor`, `finanzasScopeMemberId`, `createSupabaseServerClient`, `revalidatePath`, `ok`/`err`/`mapSupabaseError`.
- Produces: unchanged exported action; zero-row UPDATE is not automatically successful.

- [ ] Reproduce current false success using a fake Supabase boundary: initial SELECT returns authorized PENDIENTE; UPDATE resolves `{ data: [], error: null }`; subsequent SELECT would return null. Assert `result.ok === false` and no revalidation. Confirm that assertion fails on the unchanged action.
- [ ] Add meaningful cases for initial forbidden role, wrong organization/professional, initial PAGADO, actual updated row, empty UPDATE followed by authorized PAGADO, empty UPDATE followed by still PENDIENTE, reassigned payment, absent payment, reread DB error and UPDATE DB error. Verify only one write and preserved existing timestamp on the concurrent-success path.
- [ ] Implement the smallest change: retain returned UPDATE rows; if absent, reread the payment and joined turno; apply the original organization/member authorization again; return success only for PAGADO, and a recoverable conflict or mapped error otherwise. Share the local read/check code if this avoids duplicating security rules, without changing unrelated exports.
- [ ] Run `pnpm test:unit -- tests/unit/finanzas-charge-action.test.ts tests/unit/finanzas-actions.test.ts tests/unit/finanzas-scope.test.ts`.
- [ ] Run `pnpm typecheck` and targeted lint of changed TypeScript files. Record outputs and self-review in `.flow/launch-reliability/finance-report.md`.
- [ ] Commit only the task's two allowed files with a conventional fix title.
- [ ] Independent reviewer checks both compliance and quality against the task diff. Address important findings and rerun covering tests before the task closes.

## Preflight review

| Pair/task | Shared interface or internal agreement | Finding |
|---|---|---|
| Task 1/action and test | The VM invokes the actual exported action and returns real Result shapes | Tests must assert business outcomes and writes, not duplicated internal implementation |
| Task 1/visual task | Action signature and Result<void> are unchanged; no UI files touched | No direct file overlap planned |
| Task 1/cobro-cierre investigation | Financial debt settlement and initial close are separate call paths | Investigate the close independently; this task makes no claim to fix missing initial payments |

Plan reviewed against the goal before execution. No conflicting interfaces identified for this bounded task.
