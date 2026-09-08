# Folio · Personal data access and account closure requests

This document describes the repository's personal account data flow and the M116 retirement contract for the legacy patient pseudonymization RPC. It does not establish that a migration has been applied in production or that legal compliance has been verified.

## Personal data access

**Entry points**: `/mis-datos` and `/configuracion/datos` → "Descargar JSON". Both render `OwnDataPage` from `components/configuracion/own-data-page.tsx`. The standalone `/mis-datos` route remains accessible outside the clinic billing gate, including when a subscription is suspended. It still requires authenticated access and the applicable MFA verification through `verifyMfaSession`; it is not a public download.

**Shared implementation**: `exportPersonalData()` in `lib/me/personal-export.ts` serves both `GET /api/me/export` and `exportMyDataAction()` in `app/(app)/configuracion/datos/actions.ts`.

**Included categories**:

- The user's own profile, with their name and surname decrypted for the download.
- Their membership history, including revoked or unaccepted memberships.
- Current organization settings only for organizations the user can currently access through RLS. Historical memberships do not grant access to current settings.
- Their own integration metadata, without credentials.
- Subscriptions only for accessible organizations where the user is a current OWNER.
- Sanitized invitations they sent or accepted, with ownership checks.

**Excluded categories**: patient identities and clinical records (including appointments and session notes), OAuth tokens and other secrets, certificates, other professionals' integrations, inaccessible organization settings, and personal records outside the explicitly listed categories. This is a personal account export, not a delivery of patient clinical records. The UI links to support to coordinate a separately authorized clinical delivery; this account flow and the RPC retirement introduce no replacement clinical export or deletion workflow.

**Delivery checks**:

1. Verify the authenticated user and MFA before reading data.
2. Read complete, paginated collections using explicit column projections and validate row ownership. Organization settings and subscription reads additionally use the user's RLS permissions.
3. Repeat the reads and identity checks to reject observed changes in data or permissions. Recheck memberships and accessible organization settings before returning the result.
4. Reject failed reads, decryption failures, changed scope, or an export larger than 4 MB instead of delivering a partial success. A failed applicable export audit write also prevents delivery.
5. Return pretty-printed JSON with `format_version: 2`, included/excluded categories and warnings, downloaded as `folio-export-<user-id>-<YYYY-MM-DD>.json`. The HTTP wrapper sends `Cache-Control: no-store`.

The repeated reads detect observed changes; they are not a transactional snapshot of the entire database. The payload identifies its stated access basis as Ley 25.326 art. 14. That metadata does not itself verify fulfillment of every legal access or portability obligation.

## Account closure requests and withdrawal

**Entry points**: the same pages → "Quiero solicitar la baja" → optional reason → "Registrar solicitud de baja". The confirmation explains that retention and authorized delivery need human review, and that neither the account nor clinical records will be deleted automatically.

**Request**: `requestAccountDeletionAction(reason?)` verifies the current session and MFA, then updates only that user's `profile.deletion_requested_at` and `profile.deletion_reason`. Success requires a returned row whose ID matches the verified user; an error, missing row or mismatched ID is a failure. The result is `status: "manual_review_required"`, not a scheduled deletion date.

**Pending state**: the UI shows "Solicitud pendiente de revisión" and its registration date. It makes no promise of automatic execution after 30 days or any other elapsed period. If the profile cannot be read, the page shows a retryable error rather than an empty successful state.

**Withdrawal**: "Cancelar solicitud (mantengo la cuenta)" calls `cancelAccountDeletionAction()`. It performs the same session/MFA and matching-row checks, clearing both request fields only on the verified user's profile. Successful requests and withdrawals revalidate both pages. Withdrawal clears the request marker; it does not reverse a deletion, since these actions perform none.

These markers record a request for human review. They do not assign a reviewer, implement a case-management queue, determine lawful retention, or execute account closure. The responsible clinical custodian and support process must resolve retention, continuity of access and authorized delivery before any separately approved closure process.

## Legacy account-purge endpoint

`GET /api/cron/account-purge` remains a bearer-token-protected compatibility endpoint using `CRON_SECRET`. It only counts profiles with a non-null `deletion_requested_at` and returns `mode: "review-only"`, `status: "manual_review_required"`, `automatic_purge: false`, and `pending_count`.

There is no account-purge schedule in `vercel.json`. The endpoint performs no profile, Auth, membership, organization or patient mutation and invokes no pseudonymization RPC. The legacy `ACCOUNT_PURGE_ENABLED` flag cannot enable deletion; even an old request or a value of `1` leaves this endpoint read-only. Query failures return an error, not a successful zero count. The repository configuration is not proof of the current production deployment or external scheduler settings.

## Legacy patient pseudonymization RPC retirement (M116)

The legacy signature is `public.pseudonimizar_paciente(uuid, text, boolean)`. Earlier migrations defined destructive behavior, including removing patient identity and related information. Keeping clinical rows after destroying their identity link is not treated here as proof of adequate retention or lawful erasure.

M116 is the additive retirement migration for that signature. Its contract is to preserve the function signature, replace its body with an unconditional SQLSTATE `42501` rejection before any mutation, and revoke execution from application roles and `PUBLIC`. This applies to both execution and dry-run arguments; no flag or role bypass re-enables the old body. Historical migrations remain append-only.

**Deployment requirement**: confirm M116 is applied in each target database before relying on this rejection. This document does not assert production application. It supplies no manual destructive SQL recipe and introduces no replacement patient deletion or clinical export workflow.

Historical `pseudonimizacion_event` records remain available subject to their existing permissions. A read-only inspection of past events is:

```sql
SELECT performed_at, performed_by, motivo
  FROM pseudonimizacion_event
 WHERE organization_id = '<org-uuid>'
 ORDER BY performed_at DESC;
```

Past events are historical evidence, not authorization to repeat the retired operation.

## Verification scope

Relevant repository checks include:

- `tests/unit/personal-export.test.ts`: shared v2 transport contract, complete collections, scope checks, exclusions and permission changes.
- `tests/unit/own-data-access.test.ts`: standalone access outside billing, authentication/MFA and scoped profile reads.
- `tests/unit/account-deletion-review-ui.test.ts`: human-review wording and successful matching-row updates for request/withdrawal.
- `tests/unit/own-data-transport.test.ts`: safe handling of transport failures and successful downloads.
- `tests/unit/account-purge-review-only.test.ts`: no mutation regardless of flag or request age, failed-count handling and no deployment cron entry.
- SQL retirement checks must verify M116's rejection, revoked grants and unchanged patient data, rather than expecting the former destructive outcome.

These checks do not substitute for a live smoke test or proof of production migration state. A smoke test with synthetic data should verify:

1. Sign in and complete applicable MFA; open `/mis-datos`, including with a suspended test subscription.
2. Download JSON from the page and `/api/me/export`; verify v2 personal categories and absence of patient clinical data and credentials.
3. Register a closure request; verify the pending-review state and absence of an execution date.
4. Withdraw it; confirm the marker clears on both pages after reload.
5. In an isolated test environment, confirm the legacy endpoint remains read-only with the old flag set and an old request date. Do not activate or simulate a production purge.
