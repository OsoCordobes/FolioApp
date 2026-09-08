# Folio market readiness — approved implementation

Approved by the owner on 2026-09-08. Scope: Argentina, Córdoba/Alta Gracia;
independent chiropractic, cardiology and psychology practices, adults and minors.
Preserve existing test data, existing visual language and Next/Supabase/Vercel.
Preparation has no new infrastructure budget. Vercel Pro before professional use;
Supabase Free admission is bounded by measurements, not a promise of 200 clients.
Solo remains ARS 30,000/month with 30-day trial. Owner's best friend is the partner.

## Execution ledger

Baseline: `2bfbe54137603e373a0fa2ab439d367dedf93415`; audit observed 1,563 unit
tests passing, typecheck/lint/build passing, 91 migration versions matched in prod.
These checks do not certify launch readiness. Branch: `codex/market-ready`.

Ruling: use external worktree `C:/Users/amiun/Documents/Codex/folio-market-ready`
to keep the user's checkout and `.env.local` intact. No production secrets copied
into this worktree. Shared source changes are assigned by subsystem; migration IDs
are reserved centrally before parallel edits. No edits to applied schema migrations.

| Task | Status | Acceptance / dependencies |
|---|---|---|
| A1 Preserve configuration and audit branch inventory | Local cleanup complete; PR closure pending | DPAPI safety backup verified. 97 proven obsolete/integrated local refs removed after verified bundle; master and working branch remain. Both stashes independently archived including untracked parents; six useful hunks ported/tested, both removed. PR159 reconciliation written, closure after reviewable commit. |
| A2 Recover application secrets | All production variables recovered; custody/restore pending | Synthetic rehearsal, first12credentials and full42variable encrypted archive verified against complete Vercel inventory. Eight existing fields and four indexes validated, two fields need review. All3 administrative deployments deleted, URLs404, original production unchanged. Portable archive and private custody UI prepared; owner phrase custody and complete restore outstanding. |
| B1 Authorization fixes | Implemented; independent review passed locally | M98, verified-email atomic adult linkage, internal flags guarded, clinical RPC access checks, onboarding owner/state, HTTP migration endpoint removed. Negative action/SQL tests and independent corrections passed. Not deployed. |
| B2 MFA, sessions, privacy, attachments | Implemented locally; hosted verification pending | M101 server/RLS/session/factor guard: 26 focused tests and independent SQL review pass. M102 expansion / M104 enforcement: 32 attachment tests, real SQL phase checks, browser checks pass. Privacy: 165 focused tests and 3 browser scenarios pass. Atomic limiter 27 tests pass; real Redis/Auth/Storage validation remains. |
| B3 Runtime/development isolation | Implemented locally; real Auth/Storage pending | Next15.5.24; automated tests reject production and external providers, clear inherited env, and use synthetic keys and an owned browser server. 1,822 unit tests and 10 isolation probes passed at that checkpoint; isolated build passed. SQL through M112: 106 migrations, 49 specs passed. Master now requires app-ci/sql-specs and resolved review conversations; force pushes/deletion prohibited, squash only. Second human approver pending. Real Supabase Auth/Storage awaits user-started Docker. |
| C Clinical integrity | Export and atomic saving reviewed locally; remaining work | Complete paginated history/PDF/professional-reviewed JSON and amendments; 69 focused tests. M106 atomic save/close with durable revisions, idempotent receipts and validated encounter context; independent review closed four findings, 38 focused tests and real SQL races pass. Persistent draft recovery, snapshot exports, authorized suspended access and complete clinical archive remain. |
| D Minors and instruments | Implemented locally; professional/portal validation pending | M103 representatives, decisions per act and participant evidence, authenticated signatures; no blanket under-18 guardian rule. M105 population gates UI/server/SQL and historical preservation tested; unvalidated CV classification removed. Delegated portal workflow and professional approval remain. |
| E Billing and durable operations | Core implemented; provider/operations verification pending | M99 atomic charge/subscription/outbox, receipts/leases/reconcile and durable provider operations; 61 billing tests plus realSQL pass. M100 encrypted mail queue/synthetic guard/receipts/reminders. M107 Google atomic snapshots and durable queue independently reviewed: 63 tests and SQL pass. Provider config, Pro schedules, admin recovery/quota UI remain. |
| F Volume and usability | Several slices verified locally; work continues | M108 finance aggregates/pages/export, M109 shared contacts, M110 atomic booking, M112 durable imports passed focused tests and SQL/concurrency checks. M111 agenda revision/SSR acknowledgment, failure states and Cordoba midnight tested locally; M113 availability concurrency in review, M114 directory pagination beginning. Remaining agenda/history/picker pagination, typed boundaries, mobile/a11y and load proof remain. |
| G1 Backup/restore | Real encrypted checkpoint verified; full recovery and operation pending | Real PG17.6 consistent snapshot, roles/config and Storage inventory captured with verified TLS; 4 buckets/0 objects. Complete archive authenticated, selected structure restored locally. 40 recovery tests pass, one optional local PG test skipped in the latest independent review; earlier actual PG rehearsal passed. OS leases, strict receipts, lost ACK recovery and changed-artifact rejection verified. Full Supabase17/Auth/Storage recovery and platform config completion remain; no scheduler or offsite copy yet. Owner deferred phrase custody. |
| G2 Operations and legal preparation | Pending | Admin health/quotas/jobs/backup state; runbooks, owner/support responsibilities, incident/offboarding/record requests, validated legal/professional documentation. Human validation is not substituted by code. |
| V1 Local verification | Pending | 200 synthetic Solo orgs, 40k patients, 400k events; 50 staff + 10 booking concurrent, ramp/30min/100-staff burst/2h soak; no real deliveries/payments. |
| V2 Hosted verification | Pending | Only before real clinical use, backup/restoration precheck; <=50 synthetic orgs, +50MB DB/+20MB storage/200MB egress; staged 3/10/25/50 staff plus 10 booking; stop on resource/error/latency thresholds. |
| L Pilot/launch | Pending | No known critical/high issues; clinical/legal/professional signoff; restored backup; Pro cron verified; three professionals, 14 days and >=5 practice days each. |

## Invariants and shared contracts

- One org cannot access another's patient, clinical boolean, attachment or job.
- Portal email comes only from confirmed Auth identity; family email/phone does not
  establish patient ownership. Link final verification and write share a transaction.
- Representation is a separate relation with explicit scopes, verification, expiry,
  revocation; it never replaces the minor's own account. Clinical delivery is reviewed.
- Clinical originals remain immutable; corrections retain authorship and chronology.
  Failed reads/exports never masquerade as empty or complete results.
- Financial state transitions and their durable work are atomic. Delivery is at least
  once with provider idempotency where supported, never an unsupported exactly-once claim.
- Paged collections expose continuation; writes expose conflicts; jobs expose pending,
  leased, retryable/terminal/accepted/delivered states without PHI in telemetry.
- SQL migrations apply additively before dependent code; enforce constraints last.
  Verify schema by replay (vanilla Postgres 16 and isolated Supabase matching prod).
- Production helpers/tests refuse production by default. Hosted synthetic fixtures
  are archived/disabled without breaking clinical immutability, never reset production.
  External sends are permanently blocked for synthetic orgs; quotas include fixtures.

## Verification and rollout targets

Local p95 server reads <1s, writes <2s; unexpected errors <0.5%; zero lost data or
duplicate financial effects. The load generator must not be the bottleneck.
Hosted validation is a bounded compatibility/capacity experiment, not proof of
monthly sustainable Free usage. Supabase has two occupied active Free project slots;
do not touch `lorenzo-quiropraxia` or create an assumed third free project.

Admission 3 -> 10 -> 25 -> 50 -> 100 -> 200 requires stability, current restore,
and consumption projection. Alert at 60%, stop intake/bulk import at 70% or earlier
on forecast. Include Auth/transactional email, audit, backups/egress and attachments.
Do not delete histories or silently lower backup frequency to remain free.

Backup RPO target 24h only with a valid daily copy. PC uptime affects backup freshness,
not website availability. Disk protection depends on owner's last manual copy.
RTO 4h is a target to measure; local restore alone does not prove cloud recovery.

## Human release gates (remain explicit)

The three professionals validate specialty practices, instruments and adult/minor
cohorts; verify actual titles/matriculation/authority, particularly chiropractic.
Review Córdoba consent/confidentiality and international transfers, terms/privacy,
record retention/delivery, service operator and subscription tax handling.
Owner keeps the encrypted recovery material and physical disk. No paid upgrade,
actual patient pilot or claim of legal/clinical certification before its release gate.

## Evidence and updates

2026-09-08: existing `.env*` files saved outside repository using Windows CurrentUser
DPAPI with restricted directory ACL and byte-for-byte round-trip verification.
This is a local safety backup, not yet the portable recovery package. Vercel CLI
54.1.0 is installed and authenticated as the owner despite earlier session guidance.
Git remote refs refreshed; unique branch/stash audit delegated before cleanup.

2026-09-08 follow-up: user supplied a local video of repeated arrival notices.
Root reproduced server effects inside replayed React state updaters. The request
now runs once per user action, per-turn pending work survives refresh, failures
are explicit, and confirmed state cannot be overwritten by predecessor snapshots.
Independent Chromium checks passed in React StrictMode and production bundles
(12 cases), plus 25 focused unit checks, types and lint. This is still local;
production has not received the correction. No video or patient images were
copied into the repository. Evidence uses synthetic fixtures in ignored `.flow/`.

Independent B1/C review found and corrected five issues: linked household
contacts excluded from ambiguity; RLS-partial histories labeled complete;
corrupt intake silently omitted; EVA originals missing from export; lost-response
onboarding retry forbidden. 69 focused tests and real SQL M98 pass. Complete
history export now requires OWNER or registered DIRECTOR under existing RLS;
PROFESIONAL retains authorized session export and requests full delivery through
the responsible clinician. Granular full-history authorization remains future scope.


Further implementation checkpoint, 2026-09-08:

- M108 aggregates preserve exact cents and scope; M110 booking acceptance and
  M112 import receipts survive retries and real concurrent database writers.
  Shared family contacts never identify or merge patients automatically.
- M111 compares a marker captured before server data with the marker actually
  rendered; a failed refresh cannot acknowledge itself. Hidden tabs stop work,
  stale access/read checks stay visible, and local midnight changes the marker.
- The separate walk-in fix is PR160. The first candidate passed checks; automated
  review then reproduced a successor-control/navigation race, now being fixed.
  Do not merge the earlier candidate or claim production contains this fix.
- Removed remaining HTTP administration routes for email confirmation and demo
  resets, plus their seed workflow. Existing data is preserved. No production
  deployment or production schema change is implied by these local deletions.
- Master protection is active with the real CI job names, stale-review dismissal,
  resolved conversations, linear history and no forced updates or deletion.
  Only squash merges are enabled; human approval count remains zero while the
  user identifies a second account able to review. This is an explicit open gate.
- The backup custody phrase remains pending at the owner's request. A complete
  platform restore, offsite copy and daily schedule are not yet certified.
