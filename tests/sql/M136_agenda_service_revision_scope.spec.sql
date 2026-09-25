-- A service edit changes both its catalog revision and agenda exactly once.
-- The old updated_at deliberately differs from the update's timestamp.
BEGIN;
INSERT INTO public.organization(id,slug,nombre,is_internal_account,updated_at)
VALUES('13600000-0000-4000-8000-000000000010','m136-agenda','Synthetic agenda',true,'2020-01-01T00:00:00Z');
DO $$
DECLARE agenda_before bigint; catalog_before bigint; agenda_after bigint;
BEGIN
 SELECT value INTO agenda_before FROM folio_agenda_private.revision
   WHERE organization_id='13600000-0000-4000-8000-000000000010';
 SELECT onboarding_services_revision INTO catalog_before FROM public.organization
   WHERE id='13600000-0000-4000-8000-000000000010';
 INSERT INTO public.servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents)
 VALUES('13600000-0000-4000-8000-000000000020','13600000-0000-4000-8000-000000000010',
   'Synthetic service','CONSULTA_INICIAL',30,100);
 SELECT value INTO agenda_after FROM folio_agenda_private.revision
   WHERE organization_id='13600000-0000-4000-8000-000000000010';
 IF agenda_after IS DISTINCT FROM agenda_before+1 THEN
  RAISE EXCEPTION 'M136: service insert duplicated agenda invalidation';
 END IF;
 IF (SELECT onboarding_services_revision FROM public.organization
     WHERE id='13600000-0000-4000-8000-000000000010') IS DISTINCT FROM catalog_before+1 THEN
  RAISE EXCEPTION 'M136: service insert did not revise catalog';
 END IF;
 IF (SELECT updated_at FROM public.organization
     WHERE id='13600000-0000-4000-8000-000000000010') <= '2020-01-01T00:00:00Z'::timestamptz THEN
  RAISE EXCEPTION 'M136: expected updated_at touch was absent';
 END IF;
 DELETE FROM public.servicio WHERE id='13600000-0000-4000-8000-000000000020';
 SELECT value INTO agenda_before FROM folio_agenda_private.revision
   WHERE organization_id='13600000-0000-4000-8000-000000000010';
 IF agenda_before IS DISTINCT FROM agenda_after+1 THEN
  RAISE EXCEPTION 'M136: service delete duplicated agenda invalidation';
 END IF;
 UPDATE public.organization SET nombre='Synthetic renamed'
   WHERE id='13600000-0000-4000-8000-000000000010';
 SELECT value INTO agenda_after FROM folio_agenda_private.revision
   WHERE organization_id='13600000-0000-4000-8000-000000000010';
 IF agenda_after IS DISTINCT FROM agenda_before+1 THEN
  RAISE EXCEPTION 'M136: organization change stopped invalidating agenda';
 END IF;
 INSERT INTO folio_onboarding_services_private.authority(tx,organization_id)
 VALUES(txid_current(),'13600000-0000-4000-8000-000000000010');
 UPDATE public.organization
   SET nombre='Synthetic renamed again',
       onboarding_services_revision=onboarding_services_revision+1
   WHERE id='13600000-0000-4000-8000-000000000010';
 DELETE FROM folio_onboarding_services_private.authority
   WHERE tx=txid_current() AND organization_id='13600000-0000-4000-8000-000000000010';
 IF (SELECT value FROM folio_agenda_private.revision
     WHERE organization_id='13600000-0000-4000-8000-000000000010') IS DISTINCT FROM agenda_after+1 THEN
  RAISE EXCEPTION 'M136: real change alongside revision was hidden';
 END IF;
END $$;
ROLLBACK;
