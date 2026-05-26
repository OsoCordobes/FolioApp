# Post-Audit Deployment Runbook · 2026-05-26

**Purpose:** Sequenced steps to merge + deploy the fixes from the 2026-05-26 audit and the integral plan that followed it. Designed to be executed cold by the person who left to come back — no re-derivation needed.

**Estimated total time:** ~90 minutes of attention, spread across waits for deploys + email delivery checks.

---

## Pre-flight

1. Read the plan file at `~/.claude/plans/make-an-integral-plan-precious-charm.md` if you want context.
2. Confirm production health: `curl -sL https://<your-prod-url>/api/health | jq`
3. Open these tabs:
   - GitHub PRs: https://github.com/OsoCordobes/FolioApp/pulls
   - Vercel dashboard: project → Settings → Environment Variables
   - Supabase dashboard: SQL Editor + Auth → Settings (for SMTP later)
   - Cloudflare Turnstile: https://dash.cloudflare.com/?to=/:account/turnstile
   - Sentry: https://sentry.io (or create an account)
   - Upstash: https://upstash.com (or via Vercel Marketplace)

---

## Stage 1 · Observability (do this FIRST so every later fix is verifiable)

### 1.1 — Sentry

**Why first:** Without Sentry, you cannot see whether any later fix works in production. The W8 fail-closed flag is gated on Sentry being live for a reason — accidental misconfig would silently brick signups again.

1. Sign up at https://sentry.io (free tier is fine).
2. Create project: Platform = `Next.js`, name = `folio-app`.
3. Copy the DSN from **Project Settings → Client Keys**.
4. **User Settings → Auth Tokens → Create New Token** with `project:write` scope.
5. In Vercel → Project → Settings → Environment Variables, add to **Production**:
   - `NEXT_PUBLIC_SENTRY_DSN` = the DSN
   - `SENTRY_DSN` = the same DSN
   - `SENTRY_AUTH_TOKEN` = the auth token
   - `SENTRY_ORG` = your Sentry org slug
   - `SENTRY_PROJECT` = `folio-app`
6. **Redeploy production** (Vercel → Deployments → ⋯ → Redeploy on the current deployment).
7. **Verify:** `curl -sL https://<prod>/api/health | jq '.integrations.sentry'` → `true`.
8. **Smoke test:** add `throw new Error("sentry test " + Date.now())` to any Server Action you have running, deploy, trigger it, confirm the error appears in Sentry within 30s, then **revert the test code**.

### 1.2 — Turnstile (Cloudflare)

**Why second:** Required to unblock new signups (current 100% block of new accounts in prod).

1. Sign up at https://dash.cloudflare.com (free).
2. **Turnstile → Add Site:**
   - Site name: `folio-app`
   - Domain: production hostname (e.g., `folio.app`, `www.folio.app`). Add `*.vercel.app` if you want preview deploys to work.
   - Widget mode: **Managed** (Cloudflare chooses invisible vs interactive).
3. Copy the **Site Key** (public) and **Secret Key** (private).
4. In Vercel env vars (Production):
   - `NEXT_PUBLIC_TURNSTILE_SITE_KEY` = site key
   - `TURNSTILE_SECRET_KEY` = secret key
5. Redeploy production.
6. **Verify:** `curl -sL https://<prod>/api/health | jq '.integrations.turnstile'` → `true`.
7. **Smoke test:** open `/login` → "Crear cuenta" → form should show a captcha widget where there was nothing before. Complete a real signup with a throwaway email and confirm it succeeds → lands on `/onboarding`.

---

## Stage 2 · Merge code PRs

All four PRs were prepared off `master` and are independent. Merge in this order:

### 2.1 — PR #12 · M37 internal-account flag + soft-delete cascade + OAuth open-redirect

https://github.com/OsoCordobes/FolioApp/pull/12

1. Review the diff.
2. Squash-merge.
3. Wait for Vercel deploy to finish (~3–5 min).
4. **Apply the M37 migration in production:**
   ```bash
   psql "$POSTGRES_URL_NON_POOLING" \
     -f supabase/migrations/20260527000037_M37_organization_internal_flag.sql
   ```
   Verify with: `SELECT column_name FROM information_schema.columns WHERE table_name='organization' AND column_name='is_internal_account';` → 1 row.

5. **Flip the internal-account flag for any demo orgs.** First find the slugs:
   ```sql
   SELECT id, slug, nombre, created_at FROM organization ORDER BY created_at;
   ```
   Then for each demo org (Lorenzo's, etc.):
   ```sql
   UPDATE organization SET is_internal_account = true
   WHERE slug IN ('<lorenzo-slug>', '<other-demo-slug>');
   ```
   Confirm the audit row landed:
   ```sql
   SELECT action, payload, ts FROM audit_log
   WHERE resource_type='organization' AND action LIKE 'organization.internal_%'
   ORDER BY ts DESC LIMIT 10;
   ```

6. **Manual smoke:** log in as Lorenzo → should land on `/hoy` (not `/configuracion/billing`) → sidebar shows the "Cuenta interna" badge.

### 2.2 — PR #13 · M38 direct-SQL user lookup + provider-aware login

https://github.com/OsoCordobes/FolioApp/pull/13

1. Review.
2. Squash-merge. Wait for deploy.
3. **Apply M38:**
   ```bash
   psql "$POSTGRES_URL_NON_POOLING" \
     -f supabase/migrations/20260527000038_M38_user_lookup_rpcs.sql
   ```
4. **Sanity check the RPCs work:**
   ```sql
   SELECT public.find_user_id_by_email('lautaro@folio.app');
   SELECT public.user_providers_by_email('lautaro@folio.app');
   ```
   First should return a uuid (if you exist), second should return `["email"]` (or whatever providers are linked).

5. **Manual smoke** (provider-aware login): create a fresh user via Google OAuth (Continuar con Google flow). Sign out. On `/login`, type that email with any random password → expected error message: "Esta cuenta entra con Google. Probá 'Continuar con Google' arriba."

### 2.3 — PR #15 · Rate-limit fail-closed opt-in

https://github.com/OsoCordobes/FolioApp/pull/15

1. Review.
2. Squash-merge. Wait for deploy.
3. **Do NOT set `UPSTASH_FAIL_CLOSED=true` yet** — wait until Stage 3 (Upstash) is done. Until then, the flag is a no-op.
4. **Manual smoke:** signup still works (no behavior change yet).

### 2.4 — PR #14 · Verify-your-email opt-in banner

https://github.com/OsoCordobes/FolioApp/pull/14

1. Review.
2. Squash-merge. Wait for deploy.
3. **No infra needed.** The banner only activates when `email_confirmed_at` is null, which is essentially never under the current auto-confirm signup.
4. **Manual smoke (optional, dev-only):** in Supabase SQL Editor:
   ```sql
   -- Pick a throwaway test user — DO NOT do this on a real account.
   UPDATE auth.users SET email_confirmed_at = NULL WHERE email = 'e2e-test-XXXX@folio.app';
   ```
   Then log in as that user → banner appears in `/hoy`. Click "Enviar link" → email arrives (if Supabase has SMTP quota left for today; default ~30/day on free tier). Click the link → banner gone on next reload.

---

## Stage 3 · Rate-limit defense restoration (after all PRs merged + observability live)

### 3.1 — Upstash

1. Vercel dashboard → **Integrations → Browse Marketplace → Upstash**.
2. **Add Integration → folio-app project**. During provisioning, pick region **`sa-east-1`** (São Paulo) — co-locates with the Vercel `gru1` function region (see `vercel.json`).
3. Upstash auto-populates `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` into Vercel env. Confirm both are visible under Settings → Environment Variables (Production).
4. **Redeploy production.**
5. **Verify:** `curl -sL https://<prod>/api/health | jq '.integrations.upstash_redis'` → `true`.

### 3.2 — Flip the fail-closed opt-in

Only do this AFTER step 3.1 verifies live + Stage 1.1 Sentry is verified live.

1. In Vercel env vars (Production), add: `UPSTASH_FAIL_CLOSED` = `true`.
2. Redeploy.
3. **Verify the behavior:** from any IP, run a script that POSTs to `/api/auth/signout` then attempts 51 signups in a row (or simulate by switching network). The 51st should return `{ ok: false, error: "Demasiados intentos…" }`. (Skip if you'd rather just trust the unit tests for this — there are 5 cases pinning the dispatch matrix.)

### 3.3 — Kill-switch sanity

Optional but recommended for confidence:

1. In Vercel, temporarily remove one of the Upstash env vars (Production).
2. Redeploy.
3. `/api/health` → `upstash_redis: false`.
4. Try a signup → should return "Demasiados intentos" (fail-closed kicked in because keys are missing AND `UPSTASH_FAIL_CLOSED=true`).
5. Restore the env var, redeploy. Signups work again.

(You can also test this by tailing Sentry — the misconfig captures with the exact message from the code.)

---

## Stage 4 · Verification matrix

Run every line after Stage 3 is done. If anything fails, see the troubleshooting section below.

| Check | Expected | If different |
|---|---|---|
| `/api/health` → `integrations.sentry` | `true` | Re-check W1 |
| `/api/health` → `integrations.turnstile` | `true` | Re-check W2 |
| `/api/health` → `integrations.upstash_redis` | `true` | Re-check Stage 3.1 |
| Signup with new email → land on `/onboarding` | works | Open browser console; check Sentry for the actual error |
| Login as Lorenzo (internal account) → land on `/hoy` | works, sidebar shows "Cuenta interna" badge | Check the `UPDATE organization` ran; query `SELECT is_internal_account FROM organization WHERE slug='<lorenzo>'` |
| `curl '/api/auth/callback?redirect=//evil.com'` | Location header does NOT contain `evil.com` | Make sure PR #12 is actually deployed (`git log origin/master --oneline -5`) |
| Login with a Google-OAuth-only email + wrong password | specific Google error message | M38 might not be applied; re-check Stage 2.2 step 3 |
| Signup the 51st time from same IP within an hour | returns "Demasiados intentos…" | `UPSTASH_FAIL_CLOSED` not set, or Upstash keys missing |

---

## Troubleshooting

**"Signup still says 'No pude verificar el captcha'"**
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is missing or the deploy didn't pick up the new env. In Vercel → Deployments → confirm the latest deploy is post-env-add (Vercel marks redeploys; check the env var "last updated" timestamp vs the deploy timestamp).
- If both site key + secret are set but `/api/health` still shows `turnstile: false`, you set the variables in the wrong environment (Preview vs Production).

**"Lorenzo still gets redirected to billing"**
- `is_internal_account` wasn't actually flipped. Re-run the UPDATE in step 2.1 (5). Check the audit_log to confirm.
- M37 migration didn't apply. Run `\d organization` in psql — if `is_internal_account` column is absent, the migration was skipped.

**"PR #15 is merged but signups still work fine without rate-limit"**
- That's expected until you set `UPSTASH_FAIL_CLOSED=true` (Stage 3.2). The PR is a code-only opt-in; default behavior is unchanged.

**"PR #13 merged but the Google-only error message doesn't appear"**
- M38 RPCs not applied. Run the migration. Test the RPCs directly in SQL Editor (Stage 2.2 step 4).
- The user might actually have both providers linked. Check `auth.identities` for that user.

**"Signup is suddenly slower after merging PR #13"**
- Shouldn't happen; the new path is 2 round-trips max vs the old up-to-50. But if RPC fails repeatedly, it falls back to null and the caller treats as "no user" → signup creates a new one. Check Sentry for RPC failures.

**"I want to roll back the internal-account flag for an org"**
```sql
UPDATE organization SET is_internal_account = false WHERE slug = '<demo-slug>';
-- Trigger writes another audit_log row with action='organization.internal_flag_cleared'.
```

**"I want to roll back the Upstash fail-closed flip"**
- Unset `UPSTASH_FAIL_CLOSED` in Vercel env (or set to `false`). Redeploy. Behavior reverts to fail-open. Keys can stay configured — they'll just be used when present.

---

## What's NOT in this runbook (deliberately deferred)

- **DB latency investigation (W10)** — `db.latencyMs ≈ 1035ms` in production. Cause is likely Supabase region or pooling. This needs your investigation; the plan file has the decision tree.
- **Mandatory email verification on signup** — current auto-confirm is preserved by design. W9 banner activates for the day you flip it.
- **Multi-org membership edge cases** — `.maybeSingle()` on `member` lookup will fail for users with N>1 memberships. Not relevant until first multi-org customer.
- **AFIP / MercadoPago / WhatsApp integrations** — outside this audit's scope.

---

## Files modified (reference)

If you want to audit what each PR touched without opening GitHub:

```
PR #12 (M37):
  + supabase/migrations/20260527000037_M37_organization_internal_flag.sql
  + supabase/tests/12_M37_internal_flag_and_cascade.sql
  + tests/e2e/oauth-callback-open-redirect.spec.ts
  + tests/unit/onboarding-resume.test.ts
  M app/(app)/layout.tsx                         (billing gate respects flag)
  M app/api/auth/callback/route.ts                (safeRedirect)
  M components/sidebar.tsx                        (internal badge)
  M lib/db/active-context.ts                      (isInternalAccount field)
  M lib/db/onboarding-resume.ts                   (soft-delete branch)

PR #13 (M38):
  + supabase/migrations/20260527000038_M38_user_lookup_rpcs.sql
  M lib/auth/find-user-by-email.ts                (rpc + hydrate)
  M app/(public)/login/actions.ts                 (provider-aware error)
  M tests/unit/find-user-by-email.test.ts         (rewritten for new shape)

PR #14 (W9):
  + components/auth/email-verify-banner.tsx
  M app/(app)/layout.tsx                          (mounts banner)
  M app/(public)/login/actions.ts                 (requestEmailVerification action)
  M lib/db/session.ts                             (emailVerified field)

PR #15 (W8):
  M lib/security/rate-limit.ts                    (UPSTASH_FAIL_CLOSED gate)
  M .env.local.example                            (docs)
  + tests/unit/rate-limit-fail-closed.test.ts
```
