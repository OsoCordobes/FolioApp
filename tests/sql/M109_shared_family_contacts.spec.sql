BEGIN;
INSERT INTO organization(id,slug,nombre) VALUES
 ('10900000-0000-4000-8000-000000000001','m109-synthetic-family','Synthetic family');
INSERT INTO paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado,telefono_hash,dni_hash,fecha_nacimiento) VALUES
 ('10900000-0000-4000-8000-000000000011','10900000-0000-4000-8000-000000000001','\x01','\x02','\x03',repeat('a',64),repeat('b',64),'2015-01-01'),
 ('10900000-0000-4000-8000-000000000012','10900000-0000-4000-8000-000000000001','\x04','\x02','\x03',repeat('a',64),repeat('c',64),'2017-01-01'),
 ('10900000-0000-4000-8000-000000000013','10900000-0000-4000-8000-000000000001','\x05','\x02','\x03',repeat('a',64),NULL,'2021-01-01');
INSERT INTO paciente(organization_id,identidad_id) SELECT organization_id,id FROM paciente_identidad WHERE organization_id='10900000-0000-4000-8000-000000000001';
DO $$BEGIN
 IF to_regclass('public.paciente_identidad_telefono_unique_active') IS NOT NULL THEN RAISE EXCEPTION 'M109: historical unique phone index still present';END IF;
 IF (SELECT count(*) FROM paciente WHERE organization_id='10900000-0000-4000-8000-000000000001')<>3 THEN RAISE EXCEPTION 'M109: family members merged';END IF;
 IF EXISTS(SELECT 1 FROM paciente WHERE organization_id='10900000-0000-4000-8000-000000000001' AND cuenta_id IS NOT NULL) THEN RAISE EXCEPTION 'M109: contact granted portal identity';END IF;
 BEGIN
  INSERT INTO paciente_identidad(organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado,telefono_hash,dni_hash)
   VALUES('10900000-0000-4000-8000-000000000001','\x06','\x02','\x09',repeat('d',64),repeat('b',64));
  RAISE EXCEPTION 'M109: duplicate active DNI accepted';
 EXCEPTION WHEN unique_violation THEN NULL;END;
 IF to_regclass('public.paciente_identidad_org_telefono_search_idx') IS NULL THEN RAISE EXCEPTION 'M109: contact search index missing';END IF;
END$$;
ROLLBACK;
