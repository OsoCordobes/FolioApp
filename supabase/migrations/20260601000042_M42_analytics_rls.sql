-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M42 · Analytics fact-table RLS backstop (defense-in-depth)
-- ════════════════════════════════════════════════════════════════════════════
-- Hallazgo auditoría H-RLS-1: tres fact tables de `analytics` NO tienen row-level
-- security habilitada:
--
--   - analytics.org_metrics_monthly  (snapshot mensual por org, keyed by org_id;
--                                      revenue / no-show / pacientes por org)
--   - analytics.cohort_benchmarks    (percentiles pre-calculados por cohort)
--   - analytics.insight_templates    (plantillas de copy)
--
-- Hoy son seguras SÓLO por accidente: el rol `authenticated` no tiene ningún
-- GRANT sobre ellas (M15:188-196 sólo concede SELECT sobre `org_insights_cache`
-- y `geo_regions`). Pero sin RLS habilitada NO hay backstop: un único GRANT
-- accidental (p.ej. un `GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO
-- authenticated` agregado por descuido en una migración futura) expondría las
-- métricas de TODAS las orgs a CUALQUIER usuario autenticado, sin filtro de
-- tenancy. `org_metrics_monthly` es el riesgo más grave: filtra revenue y
-- no-show rate cruzados por org_id.
--
-- Fix (defense-in-depth · "deny by default"): habilitar + forzar RLS en las tres
-- tablas SIN agregar ninguna policy de SELECT para `authenticated`. Con RLS
-- habilitada y sin policy, todo acceso de un rol no-owner / no-BYPASSRLS queda
-- denegado por defecto — la garantía pasa de "depende de que nadie haga un GRANT"
-- a "estructuralmente denegado aunque exista el GRANT". Replica exactamente el
-- patrón de `analytics.org_insights_cache` (M15:134-135), que SÍ tiene
-- ENABLE + FORCE; la diferencia es que aquellas tablas NO se exponen al cliente,
-- por lo que deliberadamente NO llevan policy.
--
-- ── Por qué la pipeline / service_role NO se rompe con FORCE RLS ─────────────
-- La pipeline (M16, reescrita en M29 y M35) corre 100% dentro de funciones
-- `SECURITY DEFINER` (analytics.refresh_org_metrics / refresh_cohort_benchmarks
-- / render_insights / compute_org_insights / refresh_all). El único GRANT EXECUTE
-- es a `service_role` sobre refresh_all (M16:536); las internas se ejecutan como
-- el OWNER del schema (M16:537-538).
--
--   1. `service_role` en Supabase es un rol BYPASSRLS. RLS — habilitada o
--      forzada — NUNCA aplica a roles BYPASSRLS. El endpoint cron
--      (/api/analytics/refresh) que invoca refresh_all vía service_role no se ve
--      afectado.
--   2. `FORCE ROW LEVEL SECURITY` sólo cambia el comportamiento para el OWNER de
--      la tabla (normalmente exento de su propia RLS). NO afecta a otros roles ni
--      a roles BYPASSRLS. Las funciones SECURITY DEFINER corren como el owner del
--      schema `analytics` (= owner de estas tablas), que también es BYPASSRLS en
--      el stack de Supabase (postgres/supabase_admin). Por lo tanto los
--      DELETE/INSERT/SELECT internos de la pipeline siguen pasando.
--   3. No existe ninguna lectura de estas tres tablas por el rol `authenticated`
--      en code paths legítimos: el cliente sólo lee `org_insights_cache`
--      (la única tabla con policy) y `geo_regions`. Verificado: ningún GRANT a
--      `authenticated` sobre las tres tablas en M15/M16/M29/M35.
--
-- Conclusión: habilitar + forzar RLS aquí es puramente aditivo y no rompe ningún
-- writer/reader legítimo. Es un backstop que elimina la dependencia de "no GRANT
-- por accidente".
--
-- ── Idempotencia ────────────────────────────────────────────────────────────
-- `ENABLE/FORCE ROW LEVEL SECURITY` es seguro de re-ejecutar (no falla si ya
-- está habilitado/forzado). La migración no crea policies, así que no hay
-- `CREATE POLICY` que guardar. `to_regclass` guards evitan error si (en algún
-- entorno parcial) la tabla no existiera todavía.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF to_regclass('analytics.org_metrics_monthly') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE analytics.org_metrics_monthly ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE analytics.org_metrics_monthly FORCE ROW LEVEL SECURITY';
  END IF;

  IF to_regclass('analytics.cohort_benchmarks') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE analytics.cohort_benchmarks ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE analytics.cohort_benchmarks FORCE ROW LEVEL SECURITY';
  END IF;

  IF to_regclass('analytics.insight_templates') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE analytics.insight_templates ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE analytics.insight_templates FORCE ROW LEVEL SECURITY';
  END IF;
END $$;

-- Sin CREATE POLICY a propósito: deny-by-default. Estas tablas NO se exponen al
-- cliente. La pipeline (service_role / SECURITY DEFINER, ambos BYPASSRLS / owner)
-- sigue accediendo sin restricción. Si en el futuro se necesitara exponer alguna
-- al cliente, agregar una policy explícita acotada por tenancy
-- (p.ej. org_id IN (SELECT public.user_org_ids())) — nunca un GRANT abierto.

COMMENT ON TABLE analytics.org_metrics_monthly IS
  'Fact table: snapshot mensual de cada org. Sin PII/PHI. Granularidad mensual para cohort >= k. M42: RLS ENABLE+FORCE sin policy (deny-by-default, no expuesta al cliente; pipeline accede vía service_role/SECURITY DEFINER).';
COMMENT ON TABLE analytics.cohort_benchmarks IS
  'Percentiles pre-calculados por cohort. Solo se inserta si n_orgs >= 5 (>= 10 para monetarias). NO se expone al cliente; solo se usa server-side para resolver insights. M42: RLS ENABLE+FORCE sin policy (deny-by-default).';
COMMENT ON TABLE analytics.insight_templates IS
  'Plantillas de copy en español para insights. V1 usa reglas SQL sin LLM. Sustitución de %s = ámbito (Córdoba / Centro / AR). M42: RLS ENABLE+FORCE sin policy (deny-by-default).';
