# Integrate the published visual baseline into the launch candidate

**Goal:** Combine the published presentation at `28ab28a93798b09c2a4e092e9cceb0f163262f9e` with the reviewed reliability candidate at `2be6a61b49db709c24e38cdc1ba166e52ac5a3bc`, preserving both behavior and styling before close-caller UI implementation.

**Workspace:** Create an isolated `codex/reliability-visual-integration` branch and `folio-reliability-visual-integration` worktree. Do not modify master, other tasks, runtime services or production. Concurrent caller Task 1 remains in the main reliability worktree. Its eventual commit will be integrated before UI work.

**Prior review:** `.flow/launch-reliability/visual-integration-preflight.md` identifies 16 conflicts and behavioral requirements. Regenerate against the fixed actual inputs. Source changes introduced after the fixed published SHA are outside this integration checkpoint.

### Task 1: Resolve the semantic merge

- [ ] Create and verify the isolated worktree and merge the exact published SHA without publishing.
- [ ] Preserve server finance pagination, filtered/window-bound exports, exact cents, stale-response protection and confirmed-only settlement; incorporate published font tokens, layout and accessible scrolling.
- [ ] Preserve one frozen walk-in attempt, stable operation UUID, full exact retry payload, uncertain-state and duplicate/dismiss guards, submitted labels and agenda recovery URL. Incorporate visual markup without reverting that controller.
- [ ] Preserve both archive/reschedule CI checks, isolated runners, safe environment, SQL default-body checks and per-migration transactions, and all stronger creation recovery cases.
- [ ] Resolve the remaining presentation, clinical tool and test/config conflicts individually. Preserve clinical input/validation/keyboard behavior, isolation and published visual contracts. Do not use entire-file ours/theirs selection as a substitute for reviewing competing changes.
- [ ] Check conflict markers and diff, then types/lint/unit tests and focused isolated creation/reschedule/archive checks. Fix actual regressions. Use independent review of the resulting exact merge and evidence before returning it to the main candidate.

### Task 2: Reconcile with reviewed caller Task 1

- [ ] After both independent reviews pass, combine the integration checkpoint with caller Task 1 in the main reliability branch. Resolve shared action/types deliberately, preserve the exact SQL prerequisites and rerun checks justified by integration changes.
- [ ] Record the integrated SHA and remaining real-runtime/UI work. No production migration, deployment or release claim follows from this merge.
