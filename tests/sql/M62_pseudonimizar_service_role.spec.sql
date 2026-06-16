-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M62 spec · pseudonimizar_paciente acepta service_role (cron de purga)
-- ════════════════════════════════════════════════════════════════════════════
-- Regresión que esto guarda: M60/M61 reescribieron el cuerpo de la proc a
-- partir de M25 y perdieron la rama service_role que M45 había agregado para el
-- cron /api/cron/account-purge (que invoca con el cliente service-role, sin JWT
-- de usuario → auth.uid() = NULL). Sin esa rama la proc abortaba con "requiere
-- auth.uid()" y la purga post-grace de 30 días (Ley 25.326 art. 16) nunca corría.
--
-- Verifica:
--   1. service_role + dry_run NO lanza y reporta actor_role = 'service_role'
--      con los conteos de lo que borraría (3 tablas de PII).
--   2. service_role + ejecución real NO lanza, borra identidad + intake +
--      contactos + tutores, marca pseudonimizado_en, y graba el
--      pseudonimizacion_event con performed_by = NULL (no hay actor humano).
--   3. SIN service_role y sin auth.uid() (anon) la proc SIGUE rechazando con
--      "requiere auth.uid()" — el guard no se aflojó para todos.
--
-- En este CI los stubs definen auth.uid() := NULL y
-- auth.role() := current_setting('request.jwt.claim.role', true), así que la
-- identidad service_role se simula con set_config de ese GUC (tal como hace el
-- JWT del service client en prod). Fixtures como superuser (bypass RLS), patrón
-- de los specs M30/M49/M50/M55. auth.uid() = NULL impide simular el camino
-- OWNER/DIRECTOR acá (eso queda para el test E2E con `supabase start`).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. service_role + dry_run: no lanza, no muta ─────────────────────────────
DO $$
DECLARE
  v_org       uuid := gen_random_uuid();
  v_ident     uuid := gen_random_uuid();
  v_pac       uuid := gen_random_uuid();
  v_res       jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- fixtures: org + identidad (con blind-index hashes de 64 chars) + paciente +
  -- PII de terceros (contacto, tutor) + intake avanzado.
  INSERT INTO organization (id, slug, nombre)
    VALUES (v_org, 'm62-dry-' || substr(md5(random()::text), 1, 12), 'M62 Service Role Spec (dry)');
  INSERT INTO paciente_identidad
    (id, organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado, dni_hash, nombre_hash)
    VALUES (v_ident, v_org, '\x01'::bytea, '\x02'::bytea, '\x03'::bytea,
            repeat('a', 64), repeat('b', 64));
  INSERT INTO paciente (id, organization_id, identidad_id)
    VALUES (v_pac, v_org, v_ident);
  INSERT INTO contacto_emergencia (organization_id, paciente_id, nombre_cifrado, telefono_cifrado, vinculo)
    VALUES (v_org, v_pac, '\x01'::bytea, '\x02'::bytea, 'CONYUGE');
  INSERT INTO tutor_legal (organization_id, paciente_id, nombre_cifrado, numero_doc_cifrado, telefono_cifrado, vinculo)
    VALUES (v_org, v_pac, '\x01'::bytea, '\x02'::bytea, '\x03'::bytea, 'MADRE');
  INSERT INTO paciente_intake_avanzado (organization_id, paciente_id, especialidad)
    VALUES (v_org, v_pac, 'psicologia');

  -- llamada service-role en dry-run: NO debe lanzar.
  v_res := public.pseudonimizar_paciente(v_pac, 'M62 spec service_role dry-run', true);

  IF v_res ->> 'actor_role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'M62 spec FAIL: dry_run actor_role = % (esperado service_role)', v_res ->> 'actor_role';
  END IF;
  IF (v_res ->> 'dry_run')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'M62 spec FAIL: dry_run flag != true';
  END IF;
  IF (v_res ->> 'contactos_emergencia_a_borrar')::int <> 1
     OR (v_res ->> 'tutores_legales_a_borrar')::int <> 1
     OR (v_res ->> 'intake_avanzado_a_borrar')::int <> 1 THEN
    RAISE EXCEPTION 'M62 spec FAIL: conteos dry_run inesperados: %', v_res;
  END IF;

  -- dry_run NO debe haber mutado nada.
  IF (SELECT count(*) FROM paciente_identidad WHERE id = v_ident) <> 1
     OR (SELECT count(*) FROM contacto_emergencia WHERE paciente_id = v_pac) <> 1
     OR (SELECT count(*) FROM tutor_legal WHERE paciente_id = v_pac) <> 1
     OR (SELECT count(*) FROM paciente_intake_avanzado WHERE paciente_id = v_pac) <> 1
     OR (SELECT pseudonimizado_en FROM paciente WHERE id = v_pac) IS NOT NULL
     OR (SELECT count(*) FROM pseudonimizacion_event WHERE paciente_id = v_pac) <> 0 THEN
    RAISE EXCEPTION 'M62 spec FAIL: dry_run mutó datos';
  END IF;

  RAISE NOTICE 'M62 spec OK (1/3): service_role dry_run no lanza y no muta';
END $$;

-- ─── 2. service_role + ejecución real: borra todo, no lanza ───────────────────
DO $$
DECLARE
  v_org       uuid := gen_random_uuid();
  v_ident     uuid := gen_random_uuid();
  v_pac       uuid := gen_random_uuid();
  v_res       jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  INSERT INTO organization (id, slug, nombre)
    VALUES (v_org, 'm62-real-' || substr(md5(random()::text), 1, 12), 'M62 Service Role Spec (real)');
  INSERT INTO paciente_identidad
    (id, organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado, dni_hash, nombre_hash)
    VALUES (v_ident, v_org, '\x01'::bytea, '\x02'::bytea, '\x03'::bytea,
            repeat('c', 64), repeat('d', 64));
  INSERT INTO paciente (id, organization_id, identidad_id)
    VALUES (v_pac, v_org, v_ident);
  INSERT INTO contacto_emergencia (organization_id, paciente_id, nombre_cifrado, telefono_cifrado, vinculo)
    VALUES (v_org, v_pac, '\x01'::bytea, '\x02'::bytea, 'CONYUGE');
  INSERT INTO tutor_legal (organization_id, paciente_id, nombre_cifrado, numero_doc_cifrado, telefono_cifrado, vinculo)
    VALUES (v_org, v_pac, '\x01'::bytea, '\x02'::bytea, '\x03'::bytea, 'MADRE');
  INSERT INTO paciente_intake_avanzado (organization_id, paciente_id, especialidad)
    VALUES (v_org, v_pac, 'cardiologia');

  -- ejecución real con service_role: NO debe lanzar.
  v_res := public.pseudonimizar_paciente(v_pac, 'M62 spec service_role real run', false);

  IF v_res ->> 'actor_role' IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'M62 spec FAIL: real actor_role = % (esperado service_role)', v_res ->> 'actor_role';
  END IF;
  IF (v_res ->> 'contactos_emergencia_borrados')::int <> 1
     OR (v_res ->> 'tutores_legales_borrados')::int <> 1
     OR (v_res ->> 'intake_avanzado_borrados')::int <> 1 THEN
    RAISE EXCEPTION 'M62 spec FAIL: conteos de borrado inesperados: %', v_res;
  END IF;

  -- todas las tablas de PII vaciadas para el paciente.
  IF (SELECT count(*) FROM paciente_identidad WHERE id = v_ident) <> 0 THEN
    RAISE EXCEPTION 'M62 spec FAIL: paciente_identidad no borrada';
  END IF;
  IF (SELECT count(*) FROM contacto_emergencia WHERE paciente_id = v_pac) <> 0 THEN
    RAISE EXCEPTION 'M62 spec FAIL: contacto_emergencia no borrado';
  END IF;
  IF (SELECT count(*) FROM tutor_legal WHERE paciente_id = v_pac) <> 0 THEN
    RAISE EXCEPTION 'M62 spec FAIL: tutor_legal no borrado';
  END IF;
  IF (SELECT count(*) FROM paciente_intake_avanzado WHERE paciente_id = v_pac) <> 0 THEN
    RAISE EXCEPTION 'M62 spec FAIL: paciente_intake_avanzado no borrado';
  END IF;
  IF (SELECT identidad_id FROM paciente WHERE id = v_pac) IS NOT NULL
     OR (SELECT pseudonimizado_en FROM paciente WHERE id = v_pac) IS NULL THEN
    RAISE EXCEPTION 'M62 spec FAIL: paciente no quedó pseudonimizado';
  END IF;

  -- el audit-trail se grabó, con performed_by NULL (no hay actor humano).
  IF (SELECT count(*) FROM pseudonimizacion_event WHERE paciente_id = v_pac AND performed_by IS NULL) <> 1 THEN
    RAISE EXCEPTION 'M62 spec FAIL: pseudonimizacion_event no grabado con performed_by NULL';
  END IF;

  RAISE NOTICE 'M62 spec OK (2/3): service_role real run borra todo sin lanzar';
END $$;

-- ─── 3. sin service_role y sin auth.uid() (anon) SIGUE rechazando ─────────────
DO $$
DECLARE
  v_caught boolean := false;
BEGIN
  -- explícitamente NO service_role: auth.role() devuelve '' (GUC vacío).
  PERFORM set_config('request.jwt.claim.role', '', true);
  BEGIN
    PERFORM public.pseudonimizar_paciente(gen_random_uuid(), 'anon no deberia poder', true);
  EXCEPTION WHEN others THEN
    v_caught := true;
    IF sqlerrm NOT LIKE '%requiere auth.uid()%' THEN
      RAISE EXCEPTION 'M62 spec FAIL: anon rechazado con mensaje inesperado: %', sqlerrm;
    END IF;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M62 spec FAIL: anon (sin auth.uid() ni service_role) NO fue rechazado';
  END IF;

  RAISE NOTICE 'M62 spec OK (3/3): anon sin auth.uid() sigue rechazado';
END $$;
