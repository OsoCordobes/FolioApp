-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M73 spec · instrumento_respuesta (tabla + lock + same-org + erasure)
-- ════════════════════════════════════════════════════════════════════════════
-- Verifica:
--   1. Columnas nuevas existen (id/org/paciente/sesion/instrumento_id/version/
--      respuestas_cifrado/score_total/banda/completado_por/created_at/updated_at/
--      locked_at).
--   2. completado_por inválido → CHECK instrumento_respuesta_completado_por_valido
--      falla; instrumento_version < 1 → CHECK falla.
--   3. same-org guard: paciente de otra org → el trigger
--      instrumento_respuesta_validate_same_org rechaza (coherencia
--      paciente↔respuesta). sesion de otro paciente → rechaza.
--   4. Lock: con locked_at seteado, un UPDATE de respuestas/score/banda →
--      prevent_locked_instrumento_respuesta_update falla; el propio setear
--      locked_at (NULL→now) acepta; un NO-OP post-lock acepta.
--   5. no_delete: DELETE directo bajo RLS está denegado (policy USING false) —
--      se verifica que la policy existe (RLS FORCE + DELETE policy false).
--   6. Erasure: pseudonimizar_paciente (service_role) borra las respuestas del
--      paciente y las cuenta en el jsonb de retorno (aun estando lockeadas —
--      la supresión legal prevalece sobre el lock; DELETE en SECURITY DEFINER).
--
-- Fixtures como superuser (bypass RLS), patrón M60/M63/M72 specs. auth.uid() =
-- NULL en este CI ⇒ la rama de erasure testeable es la service_role (set_config
-- del GUC de rol, como en M63). El aislamiento de tenant RLS entre dos usuarios
-- reales queda para el E2E con `supabase start`.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. columnas existen ──────────────────────────────────────────────────────
DO $$
DECLARE
  cols text[] := ARRAY[
    'id','organization_id','paciente_id','sesion_id','instrumento_id',
    'instrumento_version','respuestas_cifrado','score_total','banda',
    'completado_por','created_at','updated_at','locked_at'
  ];
  c text;
BEGIN
  FOREACH c IN ARRAY cols LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'instrumento_respuesta' AND column_name = c
    ) THEN
      RAISE EXCEPTION 'M73 spec FAIL: columna instrumento_respuesta.% ausente', c;
    END IF;
  END LOOP;
  RAISE NOTICE 'M73 spec OK (1/6): columnas presentes';
END $$;

-- ─── 2. CHECKs (completado_por, version) ──────────────────────────────────────
DO $$
DECLARE
  v_org   uuid := gen_random_uuid();
  v_pac   uuid := gen_random_uuid();
  v_caught boolean;
BEGIN
  INSERT INTO organization (id, slug, nombre)
    VALUES (v_org, 'm73-check-' || substr(md5(random()::text), 1, 12), 'M73 Check Spec');
  INSERT INTO paciente (id, organization_id) VALUES (v_pac, v_org);

  -- completado_por inválido → CHECK falla.
  v_caught := false;
  BEGIN
    INSERT INTO instrumento_respuesta
      (organization_id, paciente_id, instrumento_id, instrumento_version, completado_por)
      VALUES (v_org, v_pac, 'phq9.v1', 1, 'robot');
  EXCEPTION WHEN check_violation THEN v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M73 spec FAIL: completado_por inválido no fue bloqueado';
  END IF;

  -- instrumento_version < 1 → CHECK falla.
  v_caught := false;
  BEGIN
    INSERT INTO instrumento_respuesta
      (organization_id, paciente_id, instrumento_id, instrumento_version, completado_por)
      VALUES (v_org, v_pac, 'phq9.v1', 0, 'profesional');
  EXCEPTION WHEN check_violation THEN v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M73 spec FAIL: instrumento_version < 1 no fue bloqueado';
  END IF;

  RAISE NOTICE 'M73 spec OK (2/6): CHECKs de completado_por y version';
END $$;

-- ─── 3. same-org guard (paciente y sesión de otra org rechazan) ───────────────
DO $$
DECLARE
  v_orgA   uuid := gen_random_uuid();
  v_orgB   uuid := gen_random_uuid();
  v_pacA   uuid := gen_random_uuid();
  v_pacB   uuid := gen_random_uuid();
  v_caught boolean;
BEGIN
  INSERT INTO organization (id, slug, nombre)
    VALUES (v_orgA, 'm73-a-' || substr(md5(random()::text), 1, 12), 'M73 Org A'),
           (v_orgB, 'm73-b-' || substr(md5(random()::text), 1, 12), 'M73 Org B');
  INSERT INTO paciente (id, organization_id) VALUES (v_pacA, v_orgA), (v_pacB, v_orgB);

  -- respuesta con organization_id de A pero paciente de B → same_org_guard falla.
  v_caught := false;
  BEGIN
    INSERT INTO instrumento_respuesta
      (organization_id, paciente_id, instrumento_id, instrumento_version, completado_por)
      VALUES (v_orgA, v_pacB, 'phq9.v1', 1, 'profesional');
  EXCEPTION WHEN others THEN
    v_caught := true;
    IF sqlerrm NOT LIKE '%debe coincidir en org%' THEN
      RAISE EXCEPTION 'M73 spec FAIL: mensaje inesperado en same-org guard: %', sqlerrm;
    END IF;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M73 spec FAIL: paciente de otra org no fue rechazado';
  END IF;

  RAISE NOTICE 'M73 spec OK (3/6): same-org guard rechaza paciente cross-tenant';
END $$;

-- ─── 4. lock: post-lock ningún cambio de datos; el lock mismo acepta ──────────
DO $$
DECLARE
  v_org    uuid := gen_random_uuid();
  v_pac    uuid := gen_random_uuid();
  v_id     uuid := gen_random_uuid();
  v_caught boolean;
BEGIN
  INSERT INTO organization (id, slug, nombre)
    VALUES (v_org, 'm73-lock-' || substr(md5(random()::text), 1, 12), 'M73 Lock Spec');
  INSERT INTO paciente (id, organization_id) VALUES (v_pac, v_org);
  INSERT INTO instrumento_respuesta
    (id, organization_id, paciente_id, instrumento_id, instrumento_version,
     respuestas_cifrado, score_total, banda, completado_por)
    VALUES (v_id, v_org, v_pac, 'phq9.v1', 1, '\x01'::bytea, 9, 'leve', 'profesional');

  -- pre-lock: un UPDATE normal acepta.
  UPDATE instrumento_respuesta SET score_total = 10, banda = 'moderada' WHERE id = v_id;

  -- setear el lock (NULL → now) acepta.
  UPDATE instrumento_respuesta SET locked_at = now() WHERE id = v_id;

  -- NO-OP post-lock acepta (mismo valor).
  UPDATE instrumento_respuesta SET score_total = 10 WHERE id = v_id;

  -- post-lock: cambiar las respuestas → falla.
  v_caught := false;
  BEGIN
    UPDATE instrumento_respuesta SET respuestas_cifrado = '\x99'::bytea WHERE id = v_id;
  EXCEPTION WHEN others THEN
    v_caught := true;
    IF sqlerrm NOT LIKE '%Instrumento bloqueado%' THEN
      RAISE EXCEPTION 'M73 spec FAIL: lock guard mensaje inesperado: %', sqlerrm;
    END IF;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M73 spec FAIL: UPDATE de respuestas post-lock no fue bloqueado';
  END IF;

  -- post-lock: cambiar el score → falla.
  v_caught := false;
  BEGIN
    UPDATE instrumento_respuesta SET score_total = 99 WHERE id = v_id;
  EXCEPTION WHEN others THEN v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M73 spec FAIL: UPDATE de score_total post-lock no fue bloqueado';
  END IF;

  RAISE NOTICE 'M73 spec OK (4/6): lock inmutabiliza datos post-lock';
END $$;

-- ─── 5. RLS: FORCE + policy DELETE USING false presente ───────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'instrumento_respuesta' AND relrowsecurity = true AND relforcerowsecurity = true
  ) THEN
    RAISE EXCEPTION 'M73 spec FAIL: RLS no está ENABLE + FORCE en instrumento_respuesta';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'instrumento_respuesta' AND policyname = 'instrumento_respuesta_no_delete'
      AND cmd = 'DELETE' AND qual = 'false'
  ) THEN
    RAISE EXCEPTION 'M73 spec FAIL: falta la policy no_delete (DELETE USING false)';
  END IF;
  RAISE NOTICE 'M73 spec OK (5/6): RLS FORCE + no_delete policy';
END $$;

-- ─── 6. erasure: pseudonimizar_paciente borra respuestas (aun lockeadas) ──────
DO $$
DECLARE
  v_org    uuid := gen_random_uuid();
  v_ident  uuid := gen_random_uuid();
  v_pac    uuid := gen_random_uuid();
  v_res    jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  INSERT INTO organization (id, slug, nombre)
    VALUES (v_org, 'm73-erase-' || substr(md5(random()::text), 1, 12), 'M73 Erase Spec');
  INSERT INTO paciente_identidad
    (id, organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado, dni_hash, nombre_hash)
    VALUES (v_ident, v_org, '\x01'::bytea, '\x02'::bytea, '\x03'::bytea,
            repeat('e', 64), repeat('f', 64));
  INSERT INTO paciente (id, organization_id, identidad_id) VALUES (v_pac, v_org, v_ident);

  -- dos respuestas, una de ellas LOCKEADA (la erasure debe borrarla igual).
  INSERT INTO instrumento_respuesta
    (organization_id, paciente_id, instrumento_id, instrumento_version, score_total, banda, completado_por)
    VALUES (v_org, v_pac, 'phq9.v1', 1, 9, 'leve', 'profesional');
  INSERT INTO instrumento_respuesta
    (organization_id, paciente_id, instrumento_id, instrumento_version, score_total, banda, completado_por, locked_at)
    VALUES (v_org, v_pac, 'gad7.v1', 1, 12, 'moderada', 'paciente', now());

  -- dry-run reporta 2 a borrar.
  v_res := public.pseudonimizar_paciente(v_pac, 'M73 spec erasure dry-run', true);
  IF (v_res ->> 'instrumento_respuesta_a_borrar')::int <> 2 THEN
    RAISE EXCEPTION 'M73 spec FAIL: dry_run instrumento_respuesta_a_borrar = % (esperado 2)',
      v_res ->> 'instrumento_respuesta_a_borrar';
  END IF;

  -- ejecución real: borra las 2 (incluida la lockeada) y las cuenta.
  v_res := public.pseudonimizar_paciente(v_pac, 'M73 spec erasure real', false);
  IF (v_res ->> 'instrumento_respuesta_borrados')::int <> 2 THEN
    RAISE EXCEPTION 'M73 spec FAIL: instrumento_respuesta_borrados = % (esperado 2)',
      v_res ->> 'instrumento_respuesta_borrados';
  END IF;
  IF (SELECT count(*) FROM instrumento_respuesta WHERE paciente_id = v_pac) <> 0 THEN
    RAISE EXCEPTION 'M73 spec FAIL: quedaron respuestas tras la erasure';
  END IF;

  RAISE NOTICE 'M73 spec OK (6/6): erasure borra respuestas (aun lockeadas)';
END $$;
