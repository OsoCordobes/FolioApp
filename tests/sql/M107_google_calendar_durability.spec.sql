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
 SELECT count(*) INTO n FROM google_outbound_job WHERE turno_id=v_turn;
 IF n<>1 THEN RAISE EXCEPTION 'M107 missing transactional intention';END IF;
 SELECT * INTO job FROM google_claim_outbound(1,v_turn);
 IF job.lease_token IS NULL THEN RAISE EXCEPTION 'M107 missing outbound lease';END IF;
 IF EXISTS(SELECT 1 FROM google_claim_outbound(1,v_turn)) THEN RAISE EXCEPTION 'M107 overlapping outbound claims';END IF;
 UPDATE turno SET inicio=inicio+interval '1 hour' WHERE id=v_turn;
 SELECT google_finish_outbound(job.id,job.lease_token,true) INTO ok;
 IF NOT ok OR (SELECT status FROM google_outbound_job WHERE id=job.id)<>'pending' THEN RAISE EXCEPTION 'M107 superseded revision was lost';END IF;

 SELECT * INTO job FROM google_claim_outbound(1,v_turn);
 UPDATE google_outbound_job SET lease_until=now()-interval '1 second' WHERE id=job.id;
 IF google_finish_outbound(job.id,job.lease_token,true) THEN RAISE EXCEPTION 'M107 expired worker committed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM google_claim_outbound(1,v_turn)) THEN RAISE EXCEPTION 'M107 expired lease not recoverable'; END IF;
 BEGIN
  UPDATE turno SET inicio=inicio+interval '1 hour' WHERE id=v_turn;
  RAISE EXCEPTION 'synthetic rollback' USING ERRCODE='23514';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF EXISTS(SELECT 1 FROM google_outbound_job WHERE id=job.id AND desired_version<>job.desired_version) THEN RAISE EXCEPTION 'M107 intention escaped rollback'; END IF;
 SELECT google_claim_inbound(v_integration) INTO claim;
 IF claim->>'lease' IS NULL THEN RAISE EXCEPTION 'M107 missing inbound lease';END IF;
 IF google_claim_inbound(v_integration) IS NOT NULL THEN RAISE EXCEPTION 'M107 concurrent inbound claim';END IF;
 INSERT INTO bloqueo(organization_id,profesional_id,inicio,duracion_min,titulo,origen,gcal_event_id) VALUES(v_org,v_member,'2026-09-08T12:00:00Z',30,'legacy-private','google','existing');
 BEGIN
  PERFORM google_apply_snapshot(v_integration,(claim->>'lease')::uuid,'selected','America/Argentina/Cordoba','2026-09-08','2026-09-09','[{"gcal_event_id":"valid","inicio":"2026-09-08T13:00:00Z","duracion_min":30},{"gcal_event_id":"invalid","inicio":"2026-09-08T14:00:00Z","duracion_min":0}]');
  RAISE EXCEPTION 'M107 invalid row accepted';
 EXCEPTION WHEN check_violation THEN NULL;END;
 IF NOT EXISTS(SELECT 1 FROM bloqueo WHERE gcal_event_id='existing' AND organization_id=v_org) OR EXISTS(SELECT 1 FROM bloqueo WHERE gcal_event_id='valid' AND organization_id=v_org) THEN RAISE EXCEPTION 'M107 partial transaction applied';END IF;
 BEGIN
  PERFORM google_apply_snapshot(v_integration,(claim->>'lease')::uuid,'selected','America/Argentina/Cordoba','2026-09-08','2026-09-09',NULL);
  RAISE EXCEPTION 'M107 null snapshot accepted';
 EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN
  PERFORM google_apply_snapshot(v_integration,(claim->>'lease')::uuid,'wrong-calendar','America/Argentina/Cordoba','2026-09-08','2026-09-09','[]');
  RAISE EXCEPTION 'M107 foreign calendar accepted';
 EXCEPTION WHEN serialization_failure THEN NULL;END;
 PERFORM google_apply_snapshot(v_integration,(claim->>'lease')::uuid,'selected','America/Argentina/Cordoba','2026-09-08','2026-09-09','[{"gcal_event_id":"valid","inicio":"2026-09-08T13:00:00Z","duracion_min":30}]');
 IF EXISTS(SELECT 1 FROM bloqueo WHERE gcal_event_id='existing' AND organization_id=v_org) OR NOT EXISTS(SELECT 1 FROM bloqueo WHERE gcal_event_id='valid' AND titulo='Ocupado (Google Calendar)' AND organization_id=v_org) THEN RAISE EXCEPTION 'M107 full snapshot not applied';END IF;
 IF (SELECT google_next_sync_at>now() FROM integration WHERE id=v_integration) THEN RAISE EXCEPTION 'M107 dirty concurrent notification lost';END IF;

 IF google_commit_watch(v_integration,'wrong',NULL,'new','resource',repeat('s',40),now()+interval '1 day') THEN RAISE EXCEPTION 'M107 watch foreign scope'; END IF;
 IF NOT google_commit_watch(v_integration,'selected',NULL,'new','resource',repeat('s',40),now()+interval '1 day') THEN RAISE EXCEPTION 'M107 watch commit failed'; END IF;
 IF google_commit_watch(v_integration,'selected',NULL,'stale','resource',repeat('s',40),now()+interval '1 day') THEN RAISE EXCEPTION 'M107 stale watch overwrite'; END IF;
 IF (SELECT meta_json->>'watch_channel_id' FROM integration WHERE id=v_integration)<>'new' THEN RAISE EXCEPTION 'M107 prior watch lost'; END IF;
 UPDATE integration SET google_sync_lease_until=now()+interval '1 minute' WHERE id=v_integration;
 IF EXISTS(SELECT 1 FROM google_due_integrations(20,false) WHERE id=v_integration) THEN RAISE EXCEPTION 'M107 busy scope starves recovery'; END IF;
 UPDATE member SET deleted_at=now() WHERE id=v_member;
 IF EXISTS(SELECT 1 FROM google_due_integrations(20,true) WHERE id=v_integration) THEN RAISE EXCEPTION 'M107 inactive scope eligible'; END IF;
 IF google_claim_inbound(v_integration) IS NOT NULL THEN RAISE EXCEPTION 'M107 inactive inbound claim'; END IF;
 IF has_function_privilege('authenticated','public.google_claim_inbound(uuid,boolean)','EXECUTE') OR has_function_privilege('anon','public.google_claim_outbound(integer,uuid)','EXECUTE') THEN RAISE EXCEPTION 'M107 service RPC exposed';END IF;
END $$;
ROLLBACK;
