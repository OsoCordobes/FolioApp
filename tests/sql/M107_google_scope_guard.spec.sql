BEGIN;
DO $$ DECLARE v_org uuid:='10700000-0000-4000-8000-000000000010'; v_user uuid:='10700000-0000-4000-8000-000000000001';v_member uuid:='10700000-0000-4000-8000-000000000011';v_patient uuid:='10700000-0000-4000-8000-000000000020';v_service uuid:='10700000-0000-4000-8000-000000000030';v_turn uuid:='10700000-0000-4000-8000-000000000040';v_integration uuid:='10700000-0000-4000-8000-000000000050';claim jsonb;job record;ok boolean;n int; BEGIN
 INSERT INTO organization(id,slug,nombre,timezone) VALUES(v_org,'m107-spec','Synthetic','America/Argentina/Cordoba');
 INSERT INTO auth.users(id,email) VALUES(v_user,'m107@spec.test');
 INSERT INTO profile(id,email,consent_pii_signed_at,consent_pii_text_version) VALUES(v_user,'m107@spec.test',now(),'v1');
 INSERT INTO member(id,organization_id,profile_id,role,es_colegiado,accepted_at) VALUES(v_member,v_org,v_user,'OWNER',true,now());
 INSERT INTO paciente(id,organization_id) VALUES(v_patient,v_org);
 INSERT INTO servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents) VALUES(v_service,v_org,'Synthetic','SEGUIMIENTO_ESTANDAR',30,100);
 INSERT INTO integration(id,organization_id,profesional_id,proveedor,access_token_cifrado,refresh_token_cifrado,meta_json) VALUES(v_integration,v_org,v_member,'GOOGLE_CALENDAR','\x01','\x02','{"calendar_id":"selected"}');
 INSERT INTO turno(id,organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents) VALUES(v_turn,v_org,v_patient,v_service,v_member,now()+interval '1 day',30,100);

 SELECT * INTO job FROM google_claim_outbound(1,v_turn);
 IF job.lease_token IS NULL THEN RAISE EXCEPTION 'fixture must be eligible before revocation'; END IF;
 IF NOT google_outbound_access(job.id,job.lease_token) OR NOT google_integration_access(v_integration) THEN RAISE EXCEPTION 'E2 active scope incorrectly rejected';END IF;
 UPDATE member SET deleted_at=now() WHERE id=v_member;
 IF google_outbound_access(job.id,job.lease_token) OR google_integration_access(v_integration) THEN RAISE EXCEPTION 'E2 revoked claim retained authority';END IF;
 UPDATE member SET deleted_at=NULL WHERE id=v_member;
 IF google_outbound_access(job.id,gen_random_uuid()) THEN RAISE EXCEPTION 'E2 foreign lease authorized';END IF;
 UPDATE google_outbound_job SET lease_until=now()-interval '1 second' WHERE id=job.id;
 IF google_outbound_access(job.id,job.lease_token) THEN RAISE EXCEPTION 'E2 expired lease authorized';END IF;
 IF has_function_privilege('authenticated','public.google_outbound_access(uuid,uuid)','EXECUTE') OR has_function_privilege('anon','public.google_integration_access(uuid)','EXECUTE') THEN RAISE EXCEPTION 'E2 scope service helper exposed';END IF;
 UPDATE google_outbound_job SET status='pending',lease_token=NULL,lease_until=NULL,available_at=now() WHERE id=job.id;
 UPDATE organization SET is_synthetic=true WHERE id=v_org;
 IF EXISTS(SELECT 1 FROM google_claim_outbound(1,v_turn)) THEN RAISE EXCEPTION 'E2 synthetic outbound scope allowed';END IF;
 IF EXISTS(SELECT 1 FROM google_due_integrations(20,false) WHERE id=v_integration) OR EXISTS(SELECT 1 FROM google_due_integrations(20,true) WHERE id=v_integration) THEN RAISE EXCEPTION 'E2 synthetic provider scope selected';END IF;
 IF google_claim_inbound(v_integration) IS NOT NULL THEN RAISE EXCEPTION 'E2 synthetic inbound scope allowed';END IF;
 IF google_commit_watch(v_integration,'selected',NULL,'new','resource',repeat('s',40),now()+interval '1 day') THEN RAISE EXCEPTION 'E2 synthetic watch accepted';END IF;
END $$;
ROLLBACK;
