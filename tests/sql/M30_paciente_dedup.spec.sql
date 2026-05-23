-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M30 spec · patient dedup via partial UNIQUE
-- ════════════════════════════════════════════════════════════════════════════
-- Verifica:
--   1. Column telefono_hash existe.
--   2. Old UNIQUE constraint removido, partial UNIQUE indexes presentes.
--   3. Duplicado de DNI activo en misma org → bloqueado.
--   4. Duplicado de TELEFONO activo en misma org → bloqueado.
--   5. Soft-deleted + nuevo activo con mismo DNI → permitido (slot libre).
--   6. Dos rows con NULL dni AND NULL telefono → permitido (legacy walk-ins
--      pre-Phase 4.2 server action change).
--   7. Cross-org no se bloquea (mismo DNI en orgs diferentes → permitido).
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_org_a uuid := gen_random_uuid();
  v_org_b uuid := gen_random_uuid();
  v_id1   uuid;
  v_id2   uuid;
  v_caught boolean;
BEGIN
  -- ── 1. column telefono_hash existe
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'paciente_identidad' AND column_name = 'telefono_hash'
  ) THEN
    RAISE EXCEPTION 'M30 spec FAIL: telefono_hash column ausente';
  END IF;

  -- ── 2. partial UNIQUE indexes presentes
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename='paciente_identidad' AND indexname='paciente_identidad_dni_unique_active'
  ) THEN
    RAISE EXCEPTION 'M30 spec FAIL: partial UNIQUE on dni_hash ausente';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename='paciente_identidad' AND indexname='paciente_identidad_telefono_unique_active'
  ) THEN
    RAISE EXCEPTION 'M30 spec FAIL: partial UNIQUE on telefono_hash ausente';
  END IF;

  -- ── Fixtures: 2 orgs sin profile/member (insert directo, RLS bypass como superuser)
  INSERT INTO organization (id, slug, nombre, timezone)
    VALUES (v_org_a, 'm30-a', 'M30 spec A', 'America/Argentina/Buenos_Aires');
  INSERT INTO organization (id, slug, nombre, timezone)
    VALUES (v_org_b, 'm30-b', 'M30 spec B', 'America/Argentina/Buenos_Aires');

  -- ── 3. duplicado DNI activo en misma org → bloqueado
  INSERT INTO paciente_identidad (organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado, dni_hash)
    VALUES (v_org_a, '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea, 'spec-dni-1')
    RETURNING id INTO v_id1;
  BEGIN
    INSERT INTO paciente_identidad (organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado, dni_hash)
      VALUES (v_org_a, '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea, 'spec-dni-1');
    v_caught := false;
  EXCEPTION WHEN unique_violation THEN
    v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M30 spec FAIL: duplicado de DNI activo no fue bloqueado';
  END IF;

  -- ── 4. duplicado TELEFONO activo en misma org → bloqueado
  INSERT INTO paciente_identidad (organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado, telefono_hash)
    VALUES (v_org_a, '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea, 'spec-tel-1');
  BEGIN
    INSERT INTO paciente_identidad (organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado, telefono_hash)
      VALUES (v_org_a, '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea, 'spec-tel-1');
    v_caught := false;
  EXCEPTION WHEN unique_violation THEN
    v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'M30 spec FAIL: duplicado de TELEFONO activo no fue bloqueado';
  END IF;

  -- ── 5. soft-delete + nuevo activo con mismo DNI → permitido
  UPDATE paciente_identidad SET deleted_at = now() WHERE id = v_id1;
  INSERT INTO paciente_identidad (organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado, dni_hash)
    VALUES (v_org_a, '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea, 'spec-dni-1');

  -- ── 6. NULL dni + NULL telefono → 2 rows permitidas
  INSERT INTO paciente_identidad (organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado)
    VALUES (v_org_a, '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea);
  INSERT INTO paciente_identidad (organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado)
    VALUES (v_org_a, '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea);

  -- ── 7. mismo DNI en org distinta → permitido
  INSERT INTO paciente_identidad (organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado, dni_hash)
    VALUES (v_org_b, '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea, 'spec-dni-1');

  -- Cleanup
  DELETE FROM paciente_identidad WHERE organization_id IN (v_org_a, v_org_b);
  DELETE FROM organization WHERE id IN (v_org_a, v_org_b);

  RAISE NOTICE 'M30 spec PASS';
END $$;
