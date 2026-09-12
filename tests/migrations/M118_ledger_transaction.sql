-- psql regression, run on the synthetic M97 baseline BEFORE applying M118.
-- The production runner owns BEGIN and the ledger insert. A migration must
-- never commit that transaction before its canonical version is recorded.
\set ON_ERROR_STOP on
-- Hosted CI connects to a local published Docker port; PostgreSQL sees its
-- private bridge address. Permit that only in explicit GitHub Actions with a
-- loopback PGHOST, never as a general remote database exception.
\set m118_ci_bridge false
\getenv m118_actions GITHUB_ACTIONS
\getenv m118_host PGHOST
\if :{?m118_actions}
  \if :{?m118_host}
    SELECT :'m118_actions'='true' AND :'m118_host' IN ('localhost','127.0.0.1','::1') AS m118_ci_bridge \gset
  \endif
\endif
SELECT current_database() ~ '^folio_test($|_)'
  AND (coalesce(host(inet_server_addr()),'') IN ('127.0.0.1','::1')
    OR (:'m118_ci_bridge'::boolean AND inet_server_addr() <<= inet '172.16.0.0/12'))
  AND current_setting('server_version_num')::int BETWEEN 160000 AND 169999
  AND to_regnamespace('folio_billing_authority_private') IS NULL
  AND EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.suscripcion'::regclass AND polname='suscripcion_write_owner')
  AS m118_baseline_allowed \gset
\if :m118_baseline_allowed
\else
  \echo 'M118 transaction regression requires isolated PostgreSQL 16 baseline'
  \quit 1
\endif
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);
CREATE TEMP TABLE m118_prior_acl AS
 SELECT c.relacl::text AS acl,
   (SELECT jsonb_agg(jsonb_build_array(a.attname,a.attacl::text) ORDER BY a.attnum)
    FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns_acl
 FROM pg_class c WHERE c.oid='public.suscripcion'::regclass;

BEGIN;
\ir ../../supabase/migrations/20260912163934_M118_billing_authority.sql
-- Force the exact failure window: SQL succeeded, but ledger insertion fails.
\set ON_ERROR_STOP off
INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES(NULL,'M118 synthetic ledger failure');
\set ledger_sqlstate :SQLSTATE
\set ON_ERROR_STOP on
ROLLBACK;
SELECT :'ledger_sqlstate'='23502' AS expected_ledger_failure \gset
\if :expected_ledger_failure
\else
  \echo 'Expected a NOT NULL failure from the synthetic ledger insertion'
  \quit 1
\endif
DO $$ BEGIN
  IF to_regnamespace('folio_billing_authority_private') IS NOT NULL
    OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20260912163934')
    OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgname IN ('subscription_platform_write','subscription_platform_truncate','organization_platform_settings_guard'))
    OR NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.suscripcion'::regclass AND polname='suscripcion_write_owner')
    OR EXISTS(SELECT 1 FROM m118_prior_acl prior CROSS JOIN pg_class c
      WHERE c.oid='public.suscripcion'::regclass AND
      (c.relacl::text IS DISTINCT FROM prior.acl OR prior.columns_acl IS DISTINCT FROM
        (SELECT jsonb_agg(jsonb_build_array(a.attname,a.attacl::text) ORDER BY a.attnum)
         FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)))
  THEN RAISE EXCEPTION 'M118 escaped rollback before its ledger was recorded'; END IF;
END $$;
\echo 'PASS M118: failed ledger rolls back schema, triggers, policy and all table/column grants'
