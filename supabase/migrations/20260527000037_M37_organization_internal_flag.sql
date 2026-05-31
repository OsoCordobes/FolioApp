-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M37 · organization.is_internal_account + soft-delete cascade
-- ════════════════════════════════════════════════════════════════════════════
-- Two related concerns ship together because both touch organization lifecycle:
--
-- 1. is_internal_account flag
--    Demo / internal / test tenants must not be locked out by the billing gate
--    in (app)/layout.tsx when their 7-day grace period expires. Pre-M37 the
--    workaround was inserting fake suscripcion rows; that poisoned the audit
--    trail and made it hard to tell real customers from internal accounts.
--    The flag is auditable (trigger logs every flip) and visible in the UI
--    (sidebar badge — see components/sidebar.tsx).
--
-- 2. Cascade soft-delete to member rows
--    Pre-M37, if an organization was soft-deleted (deleted_at IS NOT NULL)
--    but its member rows still had deleted_at IS NULL, the owner would hit
--    an infinite redirect loop:
--      /hoy  →  (app)/layout sees not_found, redirects to /onboarding
--      /onboarding → getOnboardingResumeState also sees not_found, redirects
--                    back to /hoy
--    Audit (2026-05-26) flagged this as HIGH severity. The application-side
--    fix lives in lib/db/onboarding-resume.ts; this trigger is defense in
--    depth so the orphan state cannot arise in the first place.
--
-- Both changes are additive and safe to apply on a live database.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Column: organization.is_internal_account ──────────────────────────

ALTER TABLE organization
  ADD COLUMN is_internal_account boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN organization.is_internal_account IS
  'true = demo/internal/test tenant. (app)/layout.tsx skips the billing gate when set. Audited via tg_audit_organization_internal_flag. Only mutable via service-role.';

CREATE INDEX organization_is_internal_idx
  ON organization (is_internal_account)
  WHERE is_internal_account = true;

-- ─── 2. Audit trigger for is_internal_account flips ───────────────────────
--
-- The existing audit_log_trigger() in M12 assumes NEW.organization_id exists
-- on the audited row. For organization itself that's NEW.id, not
-- NEW.organization_id — so we need a small custom trigger that maps it.
-- Scope: only fires when is_internal_account actually changes (UPDATE OF).

CREATE OR REPLACE FUNCTION public.audit_organization_internal_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id   uuid;
  v_actor_role text;
BEGIN
  -- Guard: only act on real changes (no-op UPDATEs shouldn't audit).
  IF NEW.is_internal_account IS NOT DISTINCT FROM OLD.is_internal_account THEN
    RETURN NEW;
  END IF;

  v_actor_id := auth.uid();
  IF v_actor_id IS NOT NULL THEN
    SELECT role::text INTO v_actor_role
    FROM member
    WHERE profile_id = v_actor_id AND organization_id = NEW.id
    LIMIT 1;
  END IF;

  INSERT INTO audit_log (
    organization_id, actor_id, actor_role,
    action, resource_type, resource_id, payload, ts
  ) VALUES (
    NEW.id,
    v_actor_id,
    v_actor_role,
    CASE WHEN NEW.is_internal_account
         THEN 'organization.internal_flag_set'
         ELSE 'organization.internal_flag_cleared'
    END,
    'organization',
    NEW.id::text,
    jsonb_build_object(
      'before', OLD.is_internal_account,
      'after',  NEW.is_internal_account
    ),
    now()
  );

  RETURN NEW;
END
$$;

CREATE TRIGGER tg_audit_organization_internal_flag
  AFTER UPDATE OF is_internal_account ON organization
  FOR EACH ROW EXECUTE FUNCTION audit_organization_internal_flag();

COMMENT ON FUNCTION public.audit_organization_internal_flag IS
  'M37 · records every is_internal_account flip in audit_log. Fires AFTER UPDATE OF the column only.';

-- ─── 3. Cascade soft-delete from organization to member ───────────────────

CREATE OR REPLACE FUNCTION public.cascade_soft_delete_org_members()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only act on the transition NULL → NOT NULL. Re-soft-deleting (same value)
  -- and un-deleting (NOT NULL → NULL) are out of scope on purpose: undelete
  -- is a manual operation that needs human review anyway.
  IF NEW.deleted_at IS NOT NULL
     AND (OLD.deleted_at IS NULL OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at) THEN
    UPDATE member
       SET deleted_at = NEW.deleted_at
     WHERE organization_id = NEW.id
       AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER tg_cascade_soft_delete_org_members
  AFTER UPDATE OF deleted_at ON organization
  FOR EACH ROW EXECUTE FUNCTION cascade_soft_delete_org_members();

COMMENT ON FUNCTION public.cascade_soft_delete_org_members IS
  'M37 · when organization.deleted_at flips from NULL to a timestamp, propagate the same timestamp to all of its members. Prevents the orphan-membership infinite-redirect loop (audit 2026-05-26).';

-- ─── 4. Backfill any existing orphans ─────────────────────────────────────
-- If any org has deleted_at set but its members don't, fix them now so the
-- trigger doesn't have to retroactively cover bad rows. Bounded by org count.

UPDATE member m
   SET deleted_at = o.deleted_at
  FROM organization o
 WHERE m.organization_id = o.id
   AND o.deleted_at IS NOT NULL
   AND m.deleted_at IS NULL;
