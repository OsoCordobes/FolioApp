begin;
insert into public.organization(id,slug,nombre,tipo) values('99000000-0000-0000-0000-000000000011','billing-saga-test','Billing saga','INDEPENDIENTE');
do $$declare op jsonb; again jsonb; claim jsonb; token uuid; result jsonb; begin
 op:=public.billing_reserve_operation('99000000-0000-0000-0000-000000000011','create',3000000,'synthetic@example.invalid');
 again:=public.billing_reserve_operation('99000000-0000-0000-0000-000000000011','create',4000000,'synthetic@example.invalid');
 if op->>'id'<>again->>'id' or (again->>'amount_cents')::integer<>3000000 then raise exception 'concurrent request replaced immutable operation'; end if;
 begin
  perform public.billing_reserve_operation('99000000-0000-0000-0000-000000000011','cancel',3000000);
  raise exception 'parallel mutation accepted';
 exception when unique_violation then null; end;
 claim:=public.billing_claim_operation((op->>'id')::uuid);
 token:=(claim->>'lease_token')::uuid;
 if public.billing_claim_operation((op->>'id')::uuid) is not null then raise exception 'operation lease overlaps'; end if;
 if public.billing_mark_operation_write((op->>'id')::uuid,gen_random_uuid(),'create') then raise exception 'foreign lease wrote'; end if;
 if not public.billing_mark_operation_write((op->>'id')::uuid,token,'create') then raise exception 'phase not durable'; end if;
 begin
  perform public.billing_complete_operation((op->>'id')::uuid,token,jsonb_build_object('providerSubscriptionId','saga-provider','currency','USD','amountCents',3000000,'externalReference','folio_operation_'||(op->>'id'),'status','PENDIENTE','lastModified','2026-09-08T20:00:00Z'));
  raise exception 'invalid provider currency accepted';
 exception when invalid_parameter_value then null; end;
 if (select mp_preapproval_id from public.suscripcion where organization_id='99000000-0000-0000-0000-000000000011') is not null then raise exception 'invalid completion partly applied'; end if;
 result:=public.billing_complete_operation((op->>'id')::uuid,token,jsonb_build_object('providerSubscriptionId','saga-provider','currency','ARS','amountCents',3000000,'externalReference','folio_operation_'||(op->>'id'),'status','PENDIENTE','lastModified','2026-09-08T20:00:00Z'));
 if result->>'mp_preapproval_id'<>'saga-provider' then raise exception 'provider not linked'; end if;
 if (select status from public.billing_provider_operation where id=(op->>'id')::uuid)<>'done' then raise exception 'completed provider operation left pending'; end if;
 -- A later price operation has a distinct persistent identity, even A -> B -> A.
 op:=public.billing_reserve_operation('99000000-0000-0000-0000-000000000011','amount',4000000);
 claim:=public.billing_claim_operation((op->>'id')::uuid);token:=(claim->>'lease_token')::uuid;
 perform public.billing_mark_operation_write((op->>'id')::uuid,token,'amount');
 perform public.billing_complete_operation((op->>'id')::uuid,token,'{"providerSubscriptionId":"saga-provider","currency":"ARS","amountCents":4000000,"status":"ACTIVA","lastModified":"2026-09-08T21:00:00Z"}');
 again:=public.billing_reserve_operation('99000000-0000-0000-0000-000000000011','amount',3000000);
 if op->>'idempotency_key'=again->>'idempotency_key' then raise exception 'price cycle reused old operation'; end if;
 claim:=public.billing_claim_operation((again->>'id')::uuid);
 perform public.billing_mark_operation_write((again->>'id')::uuid,(claim->>'lease_token')::uuid,'amount');
 update public.billing_provider_operation set lease_until=now()-interval '1 second' where id=(again->>'id')::uuid;
 claim:=public.billing_claim_operation((again->>'id')::uuid);
 if claim->>'phase'<>'amount' or (claim->>'attempts')::integer<>2 then raise exception 'crash lost uncertain mutation evidence'; end if;
 if has_function_privilege('authenticated','public.billing_reserve_operation(uuid,text,integer,text)','execute') then raise exception 'unprivileged provider mutation'; end if;
end$$;
rollback;
