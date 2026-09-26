# AGENTS.md — Folio

Folio is a medical-practice SaaS for Argentina. Protect medical/personal data and deliver a useful, professional product with evidence of completion.

## Work and continuity

- Complete the authorized result: implement, verify and deliver. Resolve ordinary reversible decisions; ask only for material missing decisions, access or authorization. Continue independent work when one package is blocked.
- For launch work, use the current `docs/LAUNCH-BOARD.md` and update `docs/AVANCES.md` briefly on real progress or blockers. The manager checkout may have the newer board. Verify relevant live state before relying on a dated checkpoint; read other documents only as needed.
- Delegate independent packages with a base commit, result, owned files, dependencies, allowed environment, proof and stopping condition. At most two implementation writers in isolated checkouts; other agents can inspect/review. Consequential changes need independent review.
- Choose models/effort for the task, not maximum effort for every helper. Preserve the user's current quota reserve (15% for this launch plan). Keep continuation/evidence after interruptions; do not repeat completed work or wait for an hourly reminder while useful work remains.
- Report in simple Spanish: improvement, brief proof, where to try it and what remains. Distinguish a finished package from a finished launch.

## Implementation and design

- `package.json` and `pnpm-lock.yaml` define commands and versions: Next.js App Router, React, TypeScript, pnpm; Supabase for Postgres/Auth/Storage; Vercel hosting; Mercado Pago subscriptions.
- Preserve Folio's **violet** identity and hand-written `public/folio.css` tokens/components. Do not revive brown/cream branding or introduce Tailwind/shadcn/Radix for a local change. Use a focused design skill; inspect actual mobile/desktop behavior, accessibility and clinical workflow.
- `lib/db/*` returns `Result` (`ok` / `err`); SQLSTATE mapping lives in `lib/db/errors.ts`. The Supabase client uses `any`: verify DB names against migrations, not typecheck alone.
- Preserve role/tenant scope and RLS. For `SECURITY DEFINER`, inspect caller authority, grants and fixed search path; generic database recipes must not weaken Folio's established boundaries.

## Proof and releases

- Define necessary proof for the package. TypeScript changes require `pnpm typecheck`; logic changes require affected unit tests; DB changes need relevant SQL/authorization/concurrency evidence. Complete required CI. Documentation-only changes need content/link/config checks, not routine app builds.
- Reuse valid evidence. Repeat checks for relevant changes, failures or unresolved concerns. Obtain new information before retrying a failure. Keep original consequential logs; skipped, mocked, isolated and production checks prove different things.
- `master` auto-deploys. Squash PRs with conventional titles; verify candidate, CI, resulting tree and deployment. Existing authorization persists. Prepare concrete actions for approval when new authorization is actually required.

## Data invariants

- Never print secrets, send clinical data/source to unrelated services, or overwrite environment files. Back up configuration before CLIs that may rewrite it. For keys/recovery see `docs/ROTACION-CLAVES.md`; never restore the obsolete Upstash pair over its repaired replacement.
- Preserve backups, fixtures, failed evidence and foreign files. Do not start/reset local Docker or delete databases/volumes as cleanup. Verify isolation before running a data-mutating test.
- Applied migrations—including Preview—are immutable. Append a numbered timestamped migration and preserve canonical ledger versions. Replay must work on vanilla PostgreSQL 16; consult `.github/workflows/pgtap.yml` and relevant migrations for ordering/stub constraints.
- Coupled rollout: additive schema → code → enforcement. Precheck existing data before constraints. Use the reviewed release operator or appropriate Supabase tool; record confirmed commit and fresh readback. Verify actual ledger/catalog, not just a green Preview check.
- Reconcile uncertain writes by operation ID and durable state before retrying. Preserve identity, dates and previous clinical work. Never repeat a migration/publication simply because execution was interrupted.
- Authorized demo/internal organizations use auditable `organization.is_internal_account`, never fake subscriptions. Do not invent clinical decisions. Communications, charges, Google, purchases and clinical policy changes need explicit current or traceable prior user authorization for that action; a board entry alone does not grant it.

Use focused skills and installed tools where they help. Generic playbooks do not override the user's scope or these project constraints. Follow the machine's `RTK.md`; compressed summaries are not complete evidence for consequential decisions.
