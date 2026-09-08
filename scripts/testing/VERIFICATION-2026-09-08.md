# Local SQL verification — 2026-09-08

Passed on PostgreSQL **16.15** in the existing Ubuntu 24.04 WSL distribution:

- **94 migration files**, including M98, M99 and M100, replayed from an empty
  database with PostgreSQL's default `check_function_bodies=on` in each session.
- **34 SQL specs** passed using actual `psql` statement/transaction boundaries.
- M98 regression demonstrated **RED** on the baseline: an OWNER could exempt
  their own organization from billing. After M98, the complete security spec
  passed **GREEN**.
- The local replay runner rejected a production hostname before connecting and
  refused to modify an already populated test database.

CI and the local runner now share `supabase-stubs.sql`. The stubs include
`auth.identities`, required to validate M38 under default checks. CI no longer
forces `check_function_bodies=off` across every migration.

## Coverage limit

These are SQL tests with Auth/Storage stubs. **Real Supabase Auth JWT and Storage
API testing remains incomplete.** Docker Desktop failed to start because its
existing `dockerInference` socket was inaccessible. An exact socket rename also
failed; the existing socket and Docker Desktop data were left unchanged.

Automatic approval review rejected starting a separate Docker daemon in WSL,
including the attempt with normal firewall protections and loopback binding.
The rejection gave only a generic policy block, without a detailed reason. No
alternative daemon launch was attempted after that rejection. **No new Docker
daemon or container was created.**

## Local resources created during verification

- Official Ubuntu packages: PostgreSQL 16 and its client/dependencies.
- Dedicated PostgreSQL cluster: `/var/lib/postgresql/16/folio_test`, loopback
  port **55439**, with synthetic-only databases `folio_test_market_*`.
- Package-created empty cluster: `/var/lib/postgresql/16/main`, port 5432;
  stopped at the end of verification. Existing user databases were not changed.
- Dedicated Docker binaries and extracted Ubuntu firewall dependencies:
  `/opt/folio-local-docker`. Runtime/data directories:
  `/run/folio-local-docker` and `/var/lib/folio-local-docker`; daemon launch was
  rejected before these were used by a running daemon.
- Bounded hidden WSL keepalive: Windows process **28948**, launched as
  `wsl.exe -d Ubuntu --exec sleep 3600`. It expires automatically; the parent
  task can stop this exact helper when all local checks finish.
- Local console evidence: `%TEMP%\folio-sql-replay-20260908.log`.
- File hashes and verification metadata:
  `.flow/local-sql-verification-20260908.json` (local, ignored by Git).

Installing additional packages encountered an already interrupted Ubuntu
systemd package upgrade: `systemd-resolved` expected version `255.4-1ubuntu8.17`,
while `systemd` was `255.4-1ubuntu8.16`. The attempt to finish pending package
configuration reported that mismatch. No broad system upgrade or dependency
repair was attempted afterward; PostgreSQL tests remained operational.

No production database, `.env.local`, Docker Desktop images/volumes, or user WSL
distribution was reset or deleted.

## MFA follow-up (same date)

- Final clean database: `folio_test_mfa_replay6`, same isolated PostgreSQL16 cluster.
- **95 migrations and 35 SQL specifications PASS**, including latest M98 RED/GREEN,
  M99 provider saga, M100 late email receipt mirror and M101 MFA.
- M101 verifies actual preparation/activation procedures, private policy audit,
  AAL1 dual-account denial, AAL2 access, session expiry/revocation/downgrade,
  removed factor, current membership, preserved optional RPC arguments, and
  restrictive Storage SELECT/INSERT with synthetic JWTs.
- Auth stubs now model sessions (`not_after`, `aal`, `factor_id`) and factor rows.
  Storage stubs enable RLS, matching the real service's table baseline.
- **1660 unit tests PASS** with process-local synthetic AES/HMAC test keys;
  TypeScript and targeted ESLint checks PASS. No production secrets loaded.
- Final SQL log: `%TEMP%\folio-mfa-replay6.log`; unit log:
  `%TEMP%\folio-mfa-unit-final.log`. Databases `folio_test_mfa_replay1` through `6`
  contain only this task's synthetic fixtures; earlier failed runs were preserved.
- Rollout and recovery: `docs/MFA-ROLLOUT.md`. Real Auth/Storage E2E remains blocked
  as described above; initial migration keeps application readiness off and global
  staff activation NULL. No production policy was activated.


## D1 representation and final integrated replay

- Fresh database `folio_test_d1_final2`, PostgreSQL 16.15, loopback port 55439:
  **99 migrations and 40 SQL specs PASS** with default function-body checks in
  each fresh connection, including M98 RED/GREEN, expanded M101 negatives,
  M102/M104 attachment expansion/enforcement, M103 consent expansion/enforcement,
  and M105 population/clinical-date checks.
- **1750 unit tests PASS**, TypeScript PASS and targeted D1 ESLint PASS.
  UI tests execute actual React component handlers in a VM; they are not a visual
  browser inspection or real Supabase end-to-end test.
- M103 regression demonstrated RED on the previous synthetic schema: verified
  representation could be demoted to pending and have its identity rewritten.
  Final M103 prohibits this transition; final SQL suite is GREEN.
- SQL log `%TEMP%\folio-d1-final2-sql.log`; unit log
  `%TEMP%\folio-d1-final-unit.log`. Hash manifest:
  `.flow/d1-sql-verification-20260908.json` (local, ignored).
- Earlier synthetic databases `folio_test_representation_dev1`, `dev2`,
  `folio_test_d1_final1` preserved. The first integrated replay failed only the
  historical M95 direct-document-update expectation after M104; B2 owner adapted
  that historical spec inside BEGIN/ROLLBACK, while effective M102 tests still
  assert direct writes are denied. Fresh final replay passed all 40 specs.
- WSL helper process 28948 had expired by final verification. The dedicated
  PostgreSQL cluster was not stopped because other agents were still testing.
- `docs/REPRESENTACION-CONSENTIMIENTO.md` records activation, legacy evidence,
  human review and real Auth/Storage limitations. No production activation,
  delegated portal access, legal certification or cleanup of evidence occurred.


## C2 atomic clinical save/close and integrated M107 replay

- Fresh database `folio_test_c2_final2`, same isolated PostgreSQL 16.15:
  **101 migrations / 43 SQL specs PASS**, default per-file function-body checks
  and M98 baseline RED/GREEN. Includes final M106 and M107 MFA policy correction.
- M106 expansion spec was then strengthened and independently rerun PASS on that
  database: legacy writer remains compatible before activation; an ASISTENTE
  cannot read the clinical row but closes agenda and locks exactly its saved
  content, preserving it and incrementing revision. Transaction rolled back.
- Separate real two-client run in `folio_test_c2_race2` PASS: concurrent creation
  admits one writer; disconnect before commit rolls back; competing close and
  autosave serialize; lost close response returns the same receipt. The script
  observes an actual PostgreSQL lock wait, not just sequential mocked calls.
- RED/GREEN reproduced direct deletion of an open session after activation,
  which could reset its revision. Final M106 blocks authenticated direct DELETE
  as well as INSERT/UPDATE; expansion remains compatible.
- A focused writer regression was RED for omitted legacy notes/EVA being erased
  by a SOAP-only save. The writer now omits untouched fields on updates; explicit
  empty/null values remain supported. Population/historical-tool gates preserved.
- **35 focused tests PASS**, including 14 coordinator/server-action/actual React
  handler tests plus 21 population/writer tests. Targeted C2 ESLint PASS.
- Final full unit run: **1778 PASS / 3 FAIL out of 1781**. All three remaining
  failures belong to concurrent root work in `rate-limit-atomic.test.ts` (atomic
  operation/counter TTL/settings). TypeScript likewise reports only its two
  implicit-any parameters at line 15. C2 is not reporting the global suite GREEN.
  Unit run used process-local synthetic AES/HMAC keys, no real env files.
- Logs: `%TEMP%\folio-c2-final2-sql.log`, `%TEMP%\folio-c2-focused.log`,
  `%TEMP%\folio-c2-final4-unit.log`. Hash manifest:
  `.flow/c2-verification-20260908.json` (local ignored evidence).
- New synthetic databases preserved: `folio_test_c2_dev1`, `dev2`, `race1`,
  `race2`, `final1`, `final2`. First full C2 replay exposed missing restrictive MFA
  policy on M107 google_outbound_job; owner corrected it before the fresh PASS.
- WSL keepalive helper Windows PID 18324 (`wsl.exe -d Ubuntu --exec sleep 3600`)
  was still present at completion. Parent and backup agent may still need it.
  After all local checks finish, parent may stop this exact helper if it is still
  the same process; do not stop unrelated WSL/Docker processes or delete clusters.
  No cluster shutdown, production action or Docker restart occurred in C2.
- `docs/GUARDADO-CLINICO.md` specifies staged activation, private receipts,
  human recovery, no automatic clinical merge, retention decision pending and
  memory-only draft limits. Actual Supabase Auth/Storage E2E and visual browser
  verification remain distinct pending checks; React handlers were run in a VM.


## Independent E2 Google Calendar review

- `folio_test_google_review1`: clone of D1 baseline plus final M107; original
  M107 durability spec and new M107 scope-guard spec PASS on PostgreSQL 16.
- Fresh `folio_test_google_review_final`: explicit `--through=M107`,
  **101 migrations / 44 SQL specs PASS**, including default checks and M98
  RED/GREEN. M108/M109 under parallel implementation were intentionally excluded.
  This run captures the chain at execution time, not later concurrent C2 edits.
- **63 Google-focused tests PASS**; targeted ESLint PASS. Typecheck passed before
  concurrent finance work changed; later global checks encountered only in-flight
  family-contact regressions and finance NOMBRES_MES. No global GREEN is claimed
  from this review; parent requested focused checks while those owners work.
- RED/GREEN: synthetic organization admitted outbound work; current membership
  revocation retained worker authority; missing provider ETag permitted mutation;
  impossible all-day date accepted; absence beginning over a year ago vanished
  from the window; absent collection envelope accepted as empty snapshot; OAuth
  callback exchanged tokens for a synthetic organization.
- Final guards exclude synthetic/deleted organizations and inactive/unaccepted
  members, revalidate current scope and lease before provider I/O, require ETag,
  validate collection/final-page/date metadata, and clip long intervals before
  segmentation. Current service jobs do not impersonate a human MFA session.
- Logs: `%TEMP%\folio-google-review-sql.log`,
  `%TEMP%\folio-google-review-unit.log`. M107/source hashes in
  `.flow/google-review-verification-20260908.json` (ignored local evidence).
- Google provider requests remained mocked. No real token, Google account,
  Supabase production, external delivery or daemon action was used.
  Existing helper WSL Windows PID 18324 and all synthetic databases preserved.

## B — automated test isolation

- Removed seven unit-test environment-file readers. Central pre-import bootstrap
  supplies synthetic encryption/Supabase values, clears inherited secrets, rejects
  environment-file reads and external fetch/HTTP/TCP/TLS/DNS/UDP. Node children
  inherit the guard. Recovery test preload preserves only its explicit local
  rehearsal URL; manual custody/capture/recovery scripts remain separate.
- Browser commands own localhost:4410, reject hosted endpoints/keys and ordinary
  developer ports, never reuse an existing server and write only `.next-test`.
  Browser fixtures guard both default and explicitly created contexts, HTTP and
  WebSockets. A production-shaped JWT is rejected even with a loopback URL.
- Effective negatives: 10/10 PASS, including real Resend SDK invocation, Next env
  loader, redirect escape, CLI startup validation and actual IPC child. RED/GREEN
  fixed two compatibility defects: Next dev readiness flag was cleared; Chromium
  DNS rules inadvertently rejected the literal loopback address. Only required
  boolean worker selectors are preserved in actual IPC children.
- Full unit suite: 1,822/1,822 PASS. Recovery: 33 PASS, one optional local PostgreSQL
  rehearsal skipped. Final typecheck and targeted ESLint PASS.
- Isolated Next production build: PASS, 33 static pages. Explicit pnpm plugin
  resolution fixed the first build's react-hooks lint warning. Existing Sentry
  import-in-the-middle/require-in-the-middle externalization warnings remain;
  this task did not install dependencies or claim those providers were tested.
- Actual Chromium loopback fixture + blocked external HTTP/WebSocket: PASS.
  Actual owned Next dev + login page + blocked provider in a separately created
  browser context: 1/1 PASS (1.7 minutes including compilation). App server and
  browser were shut down by Playwright after the run.
- Historical not-found spec: RED retained, expected404 / observed login200 for
  an unknown route outside the public allow-list. `decideRouteGate` intentionally
  redirects non-public anonymous requests to login. Unknown `/book/*` is a public
  prefix with a different contract; it was not validated without local Supabase.
  No middleware permission was relaxed and no assertion was weakened.
- Logs in `%TEMP%`: folio-isolated-unit-final.log,
  folio-isolated-recovery.log, folio-isolated-build-final.log,
  folio-isolated-app-smoke-final.log, folio-isolated-app-browser-pass.log (404 RED).
- This is accidental-I/O protection, not an OS sandbox against hostile code or
  localhost proxies. Real Supabase Auth/Storage integration remains pending.
  No hosted validation, provider delivery, production query or daemon action ran.

## G1 — independent backup/restore review

- Reviewed envelope authentication, publication/retention, PostgreSQL snapshot and
  transactional target guards, Storage inventories and restore journal/leases.
- RED/GREEN: incomplete/duplicate receipts counted valid; Storage directory lock
  survived SIGKILL; different journals allowed concurrent writes to one origin;
  pending upload intent overwrote unproven different bytes; reopened PostgreSQL
  archive was not rebound to the previously verified manifest digest.
- Fixed strict receipt identity/date/full inventory/file checks, per-origin OS
  lease with metadata under a dedicated journal child, preserved legacy locks
  for review, refusal to overwrite any different bytes and a final dump digest
  check immediately before the consumer. Capture's default lease identity stays
  unchanged. Manual owned capture/recovery authorization and scripts unchanged.
- Full isolated recovery suite: 40 PASS / 1 optional PostgreSQL skip / 0 failures.
  Targeted ESLint PASS. Real killed child + local HTTP accepted upload resumes
  without duplicate writes; cross-journal race prevents the second upload.
  Dump replacement test uses real encrypted files/restorer with mocked PG port.
- Log: `%TEMP%/folio-backup-independent-final.log`. No PostgreSQL/daemon activity,
  hosted provider, production data or scheduler used in this independent review.
