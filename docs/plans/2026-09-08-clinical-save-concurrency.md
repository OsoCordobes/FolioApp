# C2 — clinical save and close

Approved scope: persistent revision and actor-scoped idempotency, atomic
save/optional start/close, current MFA/clinical role/appointment assignment,
preservation of locked originals and explicit human conflict recovery.

Observed gaps: optional timestamp CAS; creation has no expected version; close
does not send a version and writes/closes separately; React state alone is not a
same-frame mutex; SSR refresh changes the version under a retained local draft;
network exceptions leave ambiguous state and concurrent edits can be lost on exit.

M106 adds a monotonic bigint revision and private operation receipts without
clinical plaintext. Creation expects revision zero explicitly. The RPC locks the
appointment and session, rechecks current authorization, validates the expected
revision and a strict column allowlist, and commits the session, revision,
receipt and optional close/lock together. Receipt lookup is scoped to current
actor, organization, appointment, patient, intent and request digest before a
result can be returned. Missing/mismatched revisions never mean overwrite.

The migration initially leaves direct-write enforcement off for staged rollout.
Activation after compatible code deploy closes direct mutation paths. A close
from the scheduling workflow only locks existing persisted session content;
it cannot manufacture or overwrite a clinical draft. Client-controlled GUCs do
not grant a bypass. New public privileged RPCs assert current MFA explicitly.

The client owns a revision associated with the acknowledged baseline, not the
latest SSR props. A ref mutex serializes operations. Uncertain retries reuse the
original operation and snapshot; edits during a request remain dirty after its
acknowledgment. Conflicts block automatic retries and preserve the draft for
comparison/copy/export before explicit reload. Close never starts while another
operation is pending, and a late local edit prevents automatic navigation even
if the server close succeeded. No automatic clinical merge or browser persistent
plaintext cache is introduced.

Verification: synthetic SQL tests plus two actual PostgreSQL clients racing saves,
close and interrupted transactions, operation retry and foreign-receipt denial;
pure coordinator tests and actual React handler tests. Full clean migration
replay, unit suite and typecheck. Real Supabase Auth/Storage validation remains
blocked separately; no production or Docker actions.
