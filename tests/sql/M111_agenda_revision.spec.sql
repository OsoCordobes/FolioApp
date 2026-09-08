BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.m111_uid',true),'')::uuid $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT '{"aal":"aal1"}'::jsonb $$;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('11100000-0000-4000-8000-000000000001','m111@spec.invalid',now());
INSERT INTO profile(id,email,consent_pii_signed_at,consent_pii_text_version)
 VALUES('11100000-0000-4000-8000-000000000001','m111@spec.invalid',now(),'v1');
INSERT INTO organization(id,slug,nombre,is_internal_account) VALUES
 ('11100000-0000-4000-8000-000000000010','m111-own','Synthetic agenda',true),
 ('11100000-0000-4000-8000-000000000011','m111-other','Synthetic other',true);
INSERT INTO member(id,organization_id,profile_id,role,accepted_at) VALUES
 ('11100000-0000-4000-8000-000000000020','11100000-0000-4000-8000-000000000010','11100000-0000-4000-8000-000000000001','OWNER',now());
INSERT INTO paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado) VALUES
 ('11100000-0000-4000-8000-000000000030','11100000-0000-4000-8000-000000000010','\x01','\x02','\x03');
INSERT INTO paciente(id,organization_id,identidad_id) VALUES
 ('11100000-0000-4000-8000-000000000031','11100000-0000-4000-8000-000000000010','11100000-0000-4000-8000-000000000030');
INSERT INTO servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents) VALUES
 ('11100000-0000-4000-8000-000000000040','11100000-0000-4000-8000-000000000010','Synthetic service','CONSULTA_INICIAL',30,100);
INSERT INTO turno(id,organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents,estado) VALUES
 ('11100000-0000-4000-8000-000000000050','11100000-0000-4000-8000-000000000010','11100000-0000-4000-8000-000000000031','11100000-0000-4000-8000-000000000040','11100000-0000-4000-8000-000000000020','2026-09-09T13:00:00Z',30,100,'CONFIRMADO');
SELECT set_config('test.m111_uid','11100000-0000-4000-8000-000000000001',true);
DO $$BEGIN
 IF public.read_agenda_revision('11100000-0000-4000-8000-000000000010') !~ '^[0-9]+:[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
  RAISE EXCEPTION 'M111: marker cannot detect local midnight without a write';
 END IF;
END$$;
DO $$DECLARE previous_token text; next_token text; third_token text; BEGIN
 UPDATE organization SET timezone='America/Argentina/Cordoba' WHERE id='11100000-0000-4000-8000-000000000010';
 previous_token:=folio_agenda_private.revision_at('11100000-0000-4000-8000-000000000010','2026-09-09 02:59:59.999+00');
 next_token:=folio_agenda_private.revision_at('11100000-0000-4000-8000-000000000010','2026-09-09 03:00:00+00');
 third_token:=folio_agenda_private.revision_at('11100000-0000-4000-8000-000000000010','2026-09-09 12:00:00+00');
 IF split_part(previous_token,':',2)<>'2026-09-08' OR split_part(next_token,':',2)<>'2026-09-09'
  OR previous_token=next_token OR next_token<>third_token
  OR split_part(previous_token,':',1)<>split_part(next_token,':',1) THEN
  RAISE EXCEPTION 'M111: Cordoba midnight did not change only the local date';
 END IF;
 IF public.read_agenda_revision('11100000-0000-4000-8000-000000000010') IS DISTINCT FROM
  folio_agenda_private.revision_at('11100000-0000-4000-8000-000000000010',CURRENT_TIMESTAMP) THEN
  RAISE EXCEPTION 'M111: public RPC did not use database clock';
 END IF;
 UPDATE organization SET timezone='Asia/Tokyo' WHERE id='11100000-0000-4000-8000-000000000010';
 IF split_part(folio_agenda_private.revision_at('11100000-0000-4000-8000-000000000010','2026-09-08 15:00:00+00'),':',2)<>'2026-09-09' THEN
  RAISE EXCEPTION 'M111: organization timezone ignored';
 END IF;
 UPDATE organization SET timezone='America/Argentina/Cordoba' WHERE id='11100000-0000-4000-8000-000000000010';
END$$;
DO $$DECLARE before_value bigint; other_value bigint; after_value bigint; second_value bigint; temp_id uuid; BEGIN
 before_value:=split_part(public.read_agenda_revision('11100000-0000-4000-8000-000000000010'),':',1)::bigint;
 SELECT value INTO other_value FROM folio_agenda_private.revision WHERE organization_id='11100000-0000-4000-8000-000000000011';
 UPDATE turno SET estado='EN_SALA' WHERE id='11100000-0000-4000-8000-000000000050';
 after_value:=split_part(public.read_agenda_revision('11100000-0000-4000-8000-000000000010'),':',1)::bigint;
 IF after_value<=before_value THEN RAISE EXCEPTION 'M111: committed transition invisible';END IF;
 IF (SELECT value FROM folio_agenda_private.revision WHERE organization_id='11100000-0000-4000-8000-000000000011')<>other_value THEN RAISE EXCEPTION 'M111: unrelated organization invalidated';END IF;
 before_value:=after_value;
 INSERT INTO pago(turno_id,monto_cents,metodo,estado,pagado_ts) VALUES('11100000-0000-4000-8000-000000000050',100,'EFECTIVO','PAGADO',now());
 IF split_part(public.read_agenda_revision('11100000-0000-4000-8000-000000000010'),':',1)::bigint<=before_value THEN RAISE EXCEPTION 'M111: payment invisible';END IF;
 before_value:=split_part(public.read_agenda_revision('11100000-0000-4000-8000-000000000010'),':',1)::bigint;
 BEGIN
  UPDATE servicio SET nombre='Rolled back' WHERE id='11100000-0000-4000-8000-000000000040';
  RAISE EXCEPTION USING ERRCODE='Z0111',MESSAGE='synthetic rollback';
 EXCEPTION WHEN SQLSTATE 'Z0111' THEN NULL;END;
 IF split_part(public.read_agenda_revision('11100000-0000-4000-8000-000000000010'),':',1)::bigint<>before_value THEN RAISE EXCEPTION 'M111: revision survives rollback';END IF;
 UPDATE paciente_identidad SET telefono_cifrado='\x04' WHERE id='11100000-0000-4000-8000-000000000030';
 IF split_part(public.read_agenda_revision('11100000-0000-4000-8000-000000000010'),':',1)::bigint<=before_value THEN RAISE EXCEPTION 'M111: identity edit invisible';END IF;
 before_value:=split_part(public.read_agenda_revision('11100000-0000-4000-8000-000000000010'),':',1)::bigint;
 INSERT INTO organization(id,slug,nombre,is_internal_account) VALUES('11100000-0000-4000-8000-000000000012','m111-second','Synthetic second membership',true);
 INSERT INTO member(organization_id,profile_id,role,accepted_at) VALUES('11100000-0000-4000-8000-000000000012','11100000-0000-4000-8000-000000000001','OWNER',now());
 second_value:=split_part(public.read_agenda_revision('11100000-0000-4000-8000-000000000012'),':',1)::bigint;
 UPDATE profile SET nombre_cifrado='\x05' WHERE id='11100000-0000-4000-8000-000000000001';
 IF split_part(public.read_agenda_revision('11100000-0000-4000-8000-000000000010'),':',1)::bigint<=before_value THEN RAISE EXCEPTION 'M111: professional display name invisible';END IF;
 IF split_part(public.read_agenda_revision('11100000-0000-4000-8000-000000000012'),':',1)::bigint<>second_value+1 THEN RAISE EXCEPTION 'M111: second profile membership invisible or duplicate increment';END IF;
 IF (SELECT value FROM folio_agenda_private.revision WHERE organization_id='11100000-0000-4000-8000-000000000011')<>other_value THEN RAISE EXCEPTION 'M111: profile invalidated unrelated organization';END IF;
 before_value:=split_part(public.read_agenda_revision('11100000-0000-4000-8000-000000000010'),':',1)::bigint;
 INSERT INTO sesion(organization_id,turno_id,paciente_id,soap_s_cifrado) VALUES
 ('11100000-0000-4000-8000-000000000010','11100000-0000-4000-8000-000000000050','11100000-0000-4000-8000-000000000031','\x01');
 IF split_part(public.read_agenda_revision('11100000-0000-4000-8000-000000000010'),':',1)::bigint<=before_value THEN RAISE EXCEPTION 'M111: saved post-visit invisible';END IF;
 before_value:=split_part(public.read_agenda_revision('11100000-0000-4000-8000-000000000010'),':',1)::bigint;
 UPDATE sesion SET soap_s_cifrado='\x02' WHERE turno_id='11100000-0000-4000-8000-000000000050';
 IF split_part(public.read_agenda_revision('11100000-0000-4000-8000-000000000010'),':',1)::bigint<>before_value+1 THEN RAISE EXCEPTION 'M111: post-visit edit invisible or double increment';END IF;
 DELETE FROM sesion WHERE turno_id='11100000-0000-4000-8000-000000000050';
 IF split_part(public.read_agenda_revision('11100000-0000-4000-8000-000000000010'),':',1)::bigint<>before_value+2 THEN RAISE EXCEPTION 'M111: post-visit deletion invisible';END IF;
 before_value:=split_part(public.read_agenda_revision('11100000-0000-4000-8000-000000000010'),':',1)::bigint;
 INSERT INTO servicio(organization_id,nombre,tipo_canonico,duracion_min,precio_cents) VALUES('11100000-0000-4000-8000-000000000010','Synthetic removable','CONSULTA_INICIAL',30,100) RETURNING id INTO temp_id;
 DELETE FROM servicio WHERE id=temp_id;
 IF split_part(public.read_agenda_revision('11100000-0000-4000-8000-000000000010'),':',1)::bigint<>before_value+2 THEN RAISE EXCEPTION 'M111: service insert/delete lost increment';END IF;
 before_value:=split_part(public.read_agenda_revision('11100000-0000-4000-8000-000000000010'),':',1)::bigint;
 DELETE FROM pago WHERE turno_id='11100000-0000-4000-8000-000000000050';
 IF split_part(public.read_agenda_revision('11100000-0000-4000-8000-000000000010'),':',1)::bigint<>before_value+1 THEN RAISE EXCEPTION 'M111: payment deletion invisible';END IF;
 before_value:=split_part(public.read_agenda_revision('11100000-0000-4000-8000-000000000010'),':',1)::bigint;
 INSERT INTO suscripcion(organization_id,payer_email,estado) VALUES('11100000-0000-4000-8000-000000000010','billing@spec.invalid','ACTIVA');
 IF split_part(public.read_agenda_revision('11100000-0000-4000-8000-000000000010'),':',1)::bigint<>before_value+1 THEN RAISE EXCEPTION 'M111: subscription creation invisible';END IF;
 UPDATE suscripcion SET estado='CANCELADA' WHERE organization_id='11100000-0000-4000-8000-000000000010';
 IF split_part(public.read_agenda_revision('11100000-0000-4000-8000-000000000010'),':',1)::bigint<>before_value+2 THEN RAISE EXCEPTION 'M111: subscription revocation invisible';END IF;
 DELETE FROM suscripcion WHERE organization_id='11100000-0000-4000-8000-000000000010';
 IF split_part(public.read_agenda_revision('11100000-0000-4000-8000-000000000010'),':',1)::bigint<>before_value+3 THEN RAISE EXCEPTION 'M111: subscription removal invisible';END IF;
 IF (SELECT count(*) FROM pg_trigger WHERE tgname='folio_agenda_change' AND NOT tgisinternal)<>13 THEN RAISE EXCEPTION 'M111: agenda dependency missing';END IF;
END$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
SET LOCAL ROLE authenticated;
DO $$BEGIN
 IF public.read_agenda_revision('11100000-0000-4000-8000-000000000010') !~ '^[0-9]+:[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'M111: invalid marker';END IF;
 BEGIN PERFORM public.read_agenda_revision('11100000-0000-4000-8000-000000000011'); RAISE EXCEPTION 'M111: foreign organization allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.read_agenda_revision(NULL); RAISE EXCEPTION 'M111: null organization allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM 1 FROM folio_agenda_private.revision; RAISE EXCEPTION 'M111: raw private counters readable'; EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 IF has_function_privilege('anon','public.read_agenda_revision(uuid)','EXECUTE') THEN RAISE EXCEPTION 'M111: anonymous read granted';END IF;
 BEGIN PERFORM folio_agenda_private.revision_at('11100000-0000-4000-8000-000000000010','2026-09-09 03:00:00+00');
  RAISE EXCEPTION 'M111: clock override exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END$$;
RESET ROLE;
SELECT set_config('test.m111_uid','',true);
SET LOCAL ROLE authenticated;
DO $$BEGIN
 BEGIN PERFORM public.read_agenda_revision('11100000-0000-4000-8000-000000000010'); RAISE EXCEPTION 'M111: missing user allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END$$;
RESET ROLE;
SELECT set_config('test.m111_uid','11100000-0000-4000-8000-000000000001',true);
UPDATE organization SET deleted_at=now() WHERE id='11100000-0000-4000-8000-000000000010';
SET LOCAL ROLE authenticated;
DO $$BEGIN
 BEGIN PERFORM public.read_agenda_revision('11100000-0000-4000-8000-000000000010'); RAISE EXCEPTION 'M111: revoked organization allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END$$;
RESET ROLE;
UPDATE organization SET deleted_at=NULL WHERE id='11100000-0000-4000-8000-000000000010';
UPDATE member SET accepted_at=NULL,invited_by_id=profile_id WHERE id='11100000-0000-4000-8000-000000000020';
SET LOCAL ROLE authenticated;
DO $$BEGIN
 BEGIN PERFORM public.read_agenda_revision('11100000-0000-4000-8000-000000000010'); RAISE EXCEPTION 'M111: pending invitation allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END$$;
RESET ROLE;
UPDATE member SET accepted_at=now(),invited_by_id=NULL WHERE id='11100000-0000-4000-8000-000000000020';
UPDATE member SET deleted_at=now() WHERE id='11100000-0000-4000-8000-000000000020';
SET LOCAL ROLE authenticated;
DO $$BEGIN
 BEGIN PERFORM public.read_agenda_revision('11100000-0000-4000-8000-000000000010'); RAISE EXCEPTION 'M111: revoked membership allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END$$;
RESET ROLE;
UPDATE member SET deleted_at=NULL WHERE id='11100000-0000-4000-8000-000000000020';
UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=now();
SET LOCAL ROLE authenticated;
DO $$BEGIN
 BEGIN PERFORM public.read_agenda_revision('11100000-0000-4000-8000-000000000010'); RAISE EXCEPTION 'M111: MFA bypass'; EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END$$;
ROLLBACK;
