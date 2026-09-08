-- Additive, disabled until the compatible UI/writer has deployed. No age or
-- population here constitutes clinical validation. Historical rows are untouched.
CREATE SCHEMA IF NOT EXISTS folio_instrument_private;
REVOKE ALL ON SCHEMA folio_instrument_private FROM PUBLIC, anon, authenticated;
CREATE TABLE folio_instrument_private.population_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  enabled_at timestamptz,
  enabled_by text,
  rollout_reason text
);
INSERT INTO folio_instrument_private.population_policy(singleton) VALUES(true);
REVOKE ALL ON ALL TABLES IN SCHEMA folio_instrument_private FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.enable_instrument_population_policy(p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 12 AND 200 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='instrument_population_rollout_reason_required';
  END IF;
  UPDATE folio_instrument_private.population_policy
    SET enabled_at=clock_timestamp(),enabled_by=session_user,rollout_reason=p_reason
    WHERE singleton AND enabled_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.enable_instrument_population_policy(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enable_instrument_population_policy(text) TO service_role;

ALTER TABLE public.instrumento_respuesta ADD COLUMN population_policy_version text;

CREATE FUNCTION public.instrument_population_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_dob date;
  v_reference date;
  v_today date := (statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba')::date;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM folio_instrument_private.population_policy WHERE enabled_at IS NOT NULL) THEN
    RETURN NEW;
  END IF;
  -- Preserve an exact historical application (including the original snapshot).
  -- Locking/unlocking is still governed by M73; this guard never weakens it.
  IF TG_OP='UPDATE' AND ROW(NEW.organization_id,NEW.paciente_id,NEW.sesion_id,
      NEW.instrumento_id,NEW.instrumento_version,NEW.respuestas_cifrado,NEW.score_total,NEW.banda,NEW.created_at)
      IS NOT DISTINCT FROM ROW(OLD.organization_id,OLD.paciente_id,OLD.sesion_id,
      OLD.instrumento_id,OLD.instrumento_version,OLD.respuestas_cifrado,OLD.score_total,OLD.banda,OLD.created_at) THEN
    NEW.population_policy_version:=OLD.population_policy_version;
    RETURN NEW;
  END IF;
  SELECT i.fecha_nacimiento INTO v_dob
    FROM public.paciente p JOIN public.paciente_identidad i ON i.id=p.identidad_id
    WHERE p.id=NEW.paciente_id AND p.organization_id=NEW.organization_id
      AND p.deleted_at IS NULL AND i.deleted_at IS NULL;
  IF NEW.sesion_id IS NULL THEN
    -- The caller cannot claim an invented application date to change eligibility.
    v_reference:=v_today;
  ELSE
    SELECT (t.inicio AT TIME ZONE 'America/Argentina/Cordoba')::date INTO v_reference
      FROM public.sesion s JOIN public.turno t ON t.id=s.turno_id
      WHERE s.id=NEW.sesion_id AND s.paciente_id=NEW.paciente_id
        AND s.organization_id=NEW.organization_id;
  END IF;
  IF v_dob IS NULL OR v_reference IS NULL OR v_dob>v_today OR v_dob>v_reference
      OR extract(year FROM age(v_reference,v_dob))<18 THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='instrument_population_not_eligible';
  END IF;
  NEW.population_policy_version:='adult-only-pending-validation.v1';
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.instrument_population_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER instrumento_respuesta_population_guard BEFORE INSERT OR UPDATE
  ON public.instrumento_respuesta FOR EACH ROW EXECUTE FUNCTION public.instrument_population_guard();

COMMENT ON FUNCTION public.enable_instrument_population_policy(text) IS
 'M105: service-only irreversible rollout enablement after deploying compatible narrative-preserving UI. Reason must contain no clinical data.';
COMMENT ON COLUMN public.instrumento_respuesta.population_policy_version IS
 'Operational population restriction at write time, not proof of clinical validation. Null for historical/pre-rollout records.';
