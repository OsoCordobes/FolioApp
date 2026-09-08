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
payment responses. Follow-up review made those checks assert the pending screen
as well, and added failures for a false debt notice and lost metadata/payment in
a predecessor snapshot. Final focused result: **29 passed**.

The browser suite uses the real Dashboard, appointment list, toast provider and
React StrictMode, with deferred fake server actions and a local HTTP server.
Its seven scenarios run in both development and production React bundles:

- Double click, pending refresh, and a 12.5-second observation: one request and
  at most one arrival toast.
- Connection rejection: rollback, reconciliation refresh, and no success toast.
- Close accepted but payment rejected: keep the close, remove optimistic money,
  and show one payment error.
- Same-state server payment and metadata become visible while the response is
  pending; a paid row does not lead to a false debt-created notice.
- Old snapshots after acknowledgement or a matching snapshot: keep the newer
  state while allowing arrival → attending → closed through the real controls.
- Cancellation observed during a pending arrival: a late acknowledgement does
  not undo cancellation or announce a false arrival.
- Concurrent appointments: each settles independently and the failed one can retry.

Observed results on this branch: **14 browser scenarios**, **1,576 complete unit
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
It also cannot reliably order payment information from a predecessor snapshot
received after an ACK against the ACK's optimistic receipt. Closure and payment
are separate writes: a closed snapshot without a payment may be an intermediate
read, and the response does not return a payment row or revision. The next
same-state refresh reconciles that data. Do not interpret an ACK as a versioned
financial snapshot or guaranteed insertion: the payment upsert can preserve an
existing row. No server/API expansion is included in this hotfix.

## Selective port into market-ready

Apply the following hunks to the shared branch; do not replace its Dashboard
file wholesale because the synchronization-status work has a separate owner.

| File | What to port | What to preserve |
| --- | --- | --- |
| `components/hoy/dashboard.tsx` | `PendingTransition`/`overlayPending`; pending map entry shape and delta creation; effect's strict predecessor overlay; ACK merge and real-payment guard; payment error and evidence-based debt notice | Shared imports/hooks/status UI for M111; its other changes |
| `tests/unit/hoy-transition-replay.test.ts` | Extended transition test signature and current-row type; the two pending/ACK payment cases, paid-row notice case, and predecessor metadata/payment case | Existing regression tests; adapt shared refresh-hook stub to M111's contract if necessary |
| `tests/hoy/browser.cjs` | Optional standalone reproducible browser harness, including the new pending-payment scenario | Do not copy generated temp bundles or results |
| `tests/hoy/run-isolated.mjs`, `tests/hoy/README.md` | Optional hotfix-specific verification wrapper and evidence | Shared global isolation/CI configuration |
| `lib/turno-states.ts` | Nothing new to port; the predecessor helper already exists in shared | Shared logging choices; do not replace the file with the hotfix version |

No migration, package/lockfile, recovery script, or environment file belongs in
this selective port. An independent reviewer reproduced payment regressions on
commit `4089e893` and passed four negative cases on the corrected tree, including
late success/failure, rollback with newer state, and a row removed by refresh.

The hotfix is prepared locally for review. Publication and deployment are
separate steps; no push, PR, merge, or deployment is performed by these checks.
