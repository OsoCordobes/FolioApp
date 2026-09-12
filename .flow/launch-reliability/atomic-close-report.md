# M120 atomic close task report

## Interface fixed before implementation

- `public.close_turno_atomic(p_org uuid,p_operation uuid,p_turno uuid,p_duracion integer DEFAULT NULL,p_decision jsonb DEFAULT NULL) RETURNS jsonb`.
- `public.resolve_turno_close(p_org uuid,p_operation uuid,p_turno uuid,p_decision jsonb) RETURNS jsonb`.
- `public.get_turno_close_status(p_org uuid,p_turno uuid) RETURNS jsonb`.
- `public.get_turno_close_receipt(p_org uuid,p_operation uuid,p_turno uuid,p_action text,p_duracion integer DEFAULT NULL,p_decision jsonb DEFAULT NULL) RETURNS jsonb`: read-only probe, action CLOSE/RESOLVE, same complete request; SQL NULL means no receipt.
- `public.enable_turno_atomic_close(p_reason text) RETURNS void`: one-way service-only, audited activation; requires M106 activated.

Decision NULL means no financial decision; exact object `{ "montoCents": 0 }` means explicit SIN_CARGO; positive integer cents up to 2147483647 requires exactly `montoCents`, `metodo` (existing enum), `pagado` (JSON boolean). Duration NULL preserves previous duration; explicit duration 0..480 minutes. Server stores canonical JSON request, not a client hash.

Result: `{turnoId,estado,closedAt,origen,clasificacion,pago,puedeRegistrar,operationId,pagoOrigen}`; status omits last two operation fields. Pago is null or `{id,montoCents,metodo,estado,pagadoTs,updatedAt}` and is redacted for COORDINADOR. Root requested `updatedAt` before finalizing callers; it comes from the real `pago.updated_at` (not a new clock value). `pagoOrigen` is CREADO/EXISTENTE/SIN_CARGO/SIN_DECISION. Receipt is the immutable original result, current status is separate. Current permissions are checked before every receipt. Conflicts use SQLSTATE 40001 (changed intent or contradictory payment), 55000 (closed visit requires administrative resolution), 42501 (authorization), 22023 (shape/bounds). No effects on error.

Historical closed visits without M120 markers are reported conservatively with closedAt NULL, HISTORICO origin. Administrative resolution can add a marker without inventing a close time or enqueueing old messages. Current closures always have a timestamp and durable queue intent.

Lock order: operation advisory lock, turno, organization/current actor/current professional; current actor and professional sources retained FOR SHARE until transaction end. M106 still owns clinical validation and session lock. Trigger recognizes only its private WRITE authority or M120 private authority, never a GUC. New initial pago INSERT requires M120 authority once enabled; existing settlement UPDATE is unchanged.

## Execution evidence

Source checkpoint ready for independent review; final full replay still running, not yet a final GREEN claim.

- Baseline: new `folio_test_launch_m120_red`, replay through M119: 113 migrations / 60 SQL specs PASS with PostgreSQL16 default body checks and platform session identity postgres.
- RED real defect: direct close then deliberately invalid payment (-1 cents) produced 23514; independently M106 CLOSE then the same payment failure produced 23514. Both visits remained CERRADO, session revision2, locked=true, payments=0. Each close was committed before the financial failure; this is the split-transaction defect, not a simulated rollback inside one SQL call.
- New RPC absent before migration: 42883. Added payment-freshness assertion failed because updatedAt was absent. Added expansion assertion failed because marker was stale after legacy payment insertion. Added clinical-policy requirement failed because RPC could close without M106 active. Each was observed before its implementation correction.
- Initial full replay on fresh `folio_test_launch_m120_green1`: 114 migrations / 61 SQL specs PASS. This preceded the final expanded cases and small corrections and is not presented as the final-source replay.
- Final atomic and expand specs subsequently passed individually in scratch green1 after owned M120 functions were refreshed. Last additive assertions (zero list price, no clinical session and retained existing leased job, extra queue rollback counts) are included in the pending final replay.
- Real concurrency runner passed 8/8 on green1: same operation/same intent, different operations/different payments, close followed by administrative resolve, contradictory resolve versus close, same operation/different request, membership revoked while waiting, appointment reassignment while waiting, and permission source frozen through commit with subsequent receipt revocation.
- Concurrent stored evidence: 7 receipts, 6 markers, 6 POST_VISITA jobs, 5 payments, 0 leaked authority rows. Fixtures remain in that local database for inspection.
- Final replay running on newly created `folio_test_launch_m120_green2` via `.flow/launch-reliability/replay-postgres-identity.mjs`; its M120 file has not yet been read at this checkpoint (progress M67). Output `.flow/launch-reliability/m120-green2.log`. First replay log `m120-green1.log`; baseline `m120-red-baseline.log`; concurrency `m120-concurrency.log`.
- `pnpm exec eslint tests/integration/turno-close-concurrency.mjs` passed. `git diff --check` passed (unrelated shared-worktree CRLF warnings only). No TS changes in this task.

### Commands and environment boundaries

Only new databases were created using `wsl -d Ubuntu -u postgres --exec createdb -p 55439 -O postgres <new_name>`. No existing DB was reset/dropped, no shared role altered, no `.env*` contents read. `Test-Path .env.local` was false before the CLI-created new migration. CLI help read first, then `pnpm exec supabase migration new M120_turno_close_atomic` generated version `20260912200817`.

All runners used explicit `LOCAL_SQL_TEST_URL` on 127.0.0.1:55439 and local synthetic account, plus `LOCAL_SQL_TEST_WSL=Ubuntu` for replay. Baseline command: `node .flow/launch-reliability/replay-postgres-identity.mjs --through=M119`; full replay omits that bound. Specs: feed `M120_turno_close_atomic.spec.sql` / `M120_turno_close_expand.spec.sql` from tests/sql to WSL psql with `-X -q -v ON_ERROR_STOP=1 -p 55439 -d <own_db> -f -`. Concurrency: `node tests/integration/turno-close-concurrency.mjs` using own migrated DB. Output is synthetic only. The safe runner copy preserves the original runner guards and sets session identity postgres for existing platform migration guards.

### Self-review and limits

No provider sends or external service calls; only durable queue insertion. M106 writer unmodified. Private tables use RLS with no client grants, helper names qualified and search_path fixed. Public entries are invoker wrappers; directly callable private entry checks same authorization. All current agenda sources are locked and roles checked again after waits. Activation and marker/payment hooks close the legacy no-op and initial INSERT/moved-association bypass; settlement UPDATE remains unchanged. Historical recovery uses unknown close time rather than fabricated history. RPC CLOSE itself requires M106 active, independent of the M120 gate.

`updatedAt` is the real existing pago.updated_at; its now()-based trigger records transaction start, not strict commit order. Callers must not treat it as a monotonic revision. A global pending-marker list is outside this contract; agenda may request current status of authorized visible visits.

These SQL/RLS/session-row tests use synthetic Auth/Storage stubs; real hosted/local Supabase Auth, Storage service behavior, browser paths, providers and production/deployment remain outside this evidence. Full replay final source and independent review are still pending at this checkpoint. Migration digest will be recorded with final evidence without changing this shared source commit.
