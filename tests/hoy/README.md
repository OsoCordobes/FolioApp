# Walk-in arrival regression checks

This isolated hotfix starts at `2bfbe54137603e373a0fa2ab439d367dedf93415`.
The only runtime changes are `components/hoy/dashboard.tsx` and the pure
`isTurnoStatePredecessor` helper in `lib/turno-states.ts`. No migration,
dependency upgrade, environment change, or new synchronization hook is required.

## Reproduce

Install the unchanged lockfile with `pnpm install --frozen-lockfile`. The browser
check also needs the Chromium version used by the installed Playwright package
(install it separately with `pnpm exec playwright install chromium` if absent).
Run these commands **sequentially**, from the repository root:

```sh
node tests/hoy/run-isolated.mjs unit
node tests/hoy/run-isolated.mjs browser
node tests/hoy/run-isolated.mjs unit-all
node tests/hoy/run-isolated.mjs typecheck
node tests/hoy/run-isolated.mjs lint
node tests/hoy/run-isolated.mjs build
```

The wrapper creates a clean child environment with synthetic encryption keys and
loopback application endpoints. It blocks application `.env*` reads and outbound
Node socket connections; browser requests are limited to the fixture's loopback
server. It does not require an application environment file. Browser bundles and
the result manifest go into a fresh OS temporary directory. All patients are
synthetic; no screenshots, recordings, production pages, or clinical data are
used. Do not run the raw browser script against a live application.

## Evidence and scope

On the unchanged baseline the first regression test reproduced two server calls
for one arrival when React replayed a state updater. The pending-click test
reproduced four calls. After moving the action and notification out of the
updater, the original 25 focused tests passed.

Independent negative review added two cases where an actual payment from a
newer server snapshot was overwritten by a late close response. Both failed
before the additional guard and passed afterward, for successful and failed
payment responses. Final focused result: **27 passed**.

The browser suite uses the real Dashboard, appointment list, toast provider and
React StrictMode, with deferred fake server actions and a local HTTP server.
Its six scenarios run in both development and production React bundles:

- Double click, pending refresh, and a 12.5-second observation: one request and
  at most one arrival toast.
- Connection rejection: rollback, reconciliation refresh, and no success toast.
- Close accepted but payment rejected: keep the close, remove optimistic money,
  and show one payment error.
- Old snapshots after acknowledgement or a matching snapshot: keep the newer
  state while allowing arrival → attending → closed through the real controls.
- Cancellation observed during a pending arrival: a late acknowledgement does
  not undo cancellation or announce a false arrival.
- Concurrent appointments: each settles independently and the failed one can retry.

Observed results on this branch: **12 browser scenarios**, **1,574 complete unit
tests**, TypeScript check, complete ESLint check, and production build passed.
The unchanged telemetry dependencies emit external-package warnings during
build. Directory prerender queries fail against the deliberately unavailable
loopback backend and take their existing empty-result fallback. The build
finishes successfully; it is not evidence of a populated production directory.

These tests verify client concurrency and feedback; server actions are faked.
They do not certify live Auth, database writes, external providers, or a deployed
session. State-order protection follows the existing acyclic M91 transition
graph. Equal-state snapshots may refresh metadata; without a server revision,
this patch cannot order two different snapshots that have the same state.

The hotfix is prepared locally for review. Publication and deployment are
separate steps; no push, PR, merge, or deployment is performed by these checks.
