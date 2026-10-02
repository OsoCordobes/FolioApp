# Joined adapter execution contract

Base M: `f643a230876c605ea94dd5af9bb3168a44b6bdce`; accepted module:
`fe22f977d154e57ef5f6d08f6d9eb3b8f77e84c4`. Both are preserved by merge.
The three accepted module blobs remain unchanged. This file supersedes the pending
ownership status in their historical README, which is preserved for review.

After complete candidate review and explicit authorization, one hosted execution:
workflow `folio-google-internal-proof.yml`, `proof_mode=public-booking-joined`,
`candidate_sha=<exact reviewed 40-character SHA>`. No push/dispatch is authorized
by this preparation. Install/setup and pinned Docker fetch happen before test
isolation; fixture/app/provider work happens after external I/O is denied.

The existing runner selects the dedicated project `folio_public_booking_joined_proof`.
The real bridge validator allows that exact name and still validates service,
labels, internal network, attachment, subnet and port. No schema/policy changes.
Fixture setup reuses verified MFA and the reviewed fake Google credentials, seeds
one independent internal organization, one member/service/integration and initial
patient, with no request or turn. Verified session cookies stay in process memory.

Next starts through existing `app-server.mjs` and `app-bootstrap.mjs` on
`http://127.0.0.1:4440`, API/DB through owned loopback bridges on 55421/55422. The
child receives a safe environment and preload; IPC workers and thread workers
inherit that bootstrap. The bootstrap blocks external Node I/O and `.env` reads.
Chromium receives the existing resolver flags and request/WebSocket route guard.
Existing Google adapter rewrites only its allowed Calendar/OAuth endpoints to
real loopback HTTP. No mail worker, cron, charges or real provider calls run.

The adapter refuses a previously occupied Next port, waits for real readiness,
and terminates the owned Linux process group, including dev workers. Cleanup is
required for success. Callback metadata describes the configured guarded runtime;
local propagation tests do not establish hosted Next/browser success.

Exactly one public UI submission and manual acceptance are performed. Calendar
checks the durable patient link; Hoy activates its real row and must navigate to
that same conversion patient. One intent and event are dispatched. The slot is
future today in the organization timezone; an impossible late-day run fails.
Captcha remains the existing absent-secret development policy, not a real
Turnstile certification. Single-owner professional attribution is implicit in UI
and correlated by durable IDs.

Only `folio-public-booking-joined-proof.json` is uploaded for this selector.
`finishJoinedReceipt` drops raw errors, env/config/cookies, bodies and nonfinite
identifiers. It requires five exact stages, the Hoy destination invariant, SHA/tree,
module/Next/backend cleanup and migration count before overall `passed=true`.
Failures retain a finite phase; partial observations stay visible. No automatic
retry or additional Google lifecycle matrix is part of this execution contract.
