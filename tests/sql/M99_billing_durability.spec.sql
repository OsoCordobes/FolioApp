-- Actual RPC behavior, inside rollback-only synthetic fixtures.
begin;
insert into public.organization(id,slug,nombre,tipo) values('99000000-0000-0000-0000-000000000001','billing-durable-test','Billing test','INDEPENDIENTE');
insert into public.suscripcion(id,organization_id,mp_preapproval_id,payer_email,estado,monto_cents)
values('99000000-0000-0000-0000-000000000002','99000000-0000-0000-0000-000000000001','durable-test','synthetic@example.invalid','MOROSA',3000000);

create function pg_temp.charge(p_id text,p_state text,p_stamp text,p_amount integer default 3000000,p_currency text default 'ARS') returns jsonb language sql as $$
 select public.billing_record_charge(jsonb_build_object('providerSubscriptionId','durable-test','providerChargeId','ap-'||p_id,'amountCents',p_amount,'currency',p_currency,'attemptDate',p_stamp,'lastModified',p_stamp,'payment',jsonb_build_object('paymentId',p_id,'status',p_state)),10000000,2500000);
$$;

-- Outbox failure MUST roll back both preceding financial mutations.
create function pg_temp.reject_job() returns trigger language plpgsql as $$begin raise exception using errcode='23514',message='synthetic_outbox_failure'; end$$;
create trigger synthetic_reject_job before insert on public.billing_followup_job for each row execute function pg_temp.reject_job();
do $$begin
  begin perform pg_temp.charge('atomic','APROBADO','2026-09-08T10:00:00Z'); raise exception 'expected outbox failure';
  exception when check_violation then null; end;
  if exists(select 1 from public.cargo_suscripcion where mp_payment_id='atomic') then raise exception 'charge survived failed transaction'; end if;
  if (select estado from public.suscripcion where mp_preapproval_id='durable-test')<>'MOROSA' then raise exception 'state survived failed transaction'; end if;
end$$;
drop trigger synthetic_reject_job on public.billing_followup_job;

do $$declare r jsonb; begin
 r:=pg_temp.charge('atomic','APROBADO','2026-09-08T10:00:00Z');
 if r->>'estadoDespues'<>'ACTIVA' then raise exception 'retry failed to recover'; end if;
 r:=pg_temp.charge('atomic','APROBADO','2026-09-08T10:00:00Z');
 if (r->>'isNewCharge')::boolean then raise exception 'duplicate was inserted'; end if;
 if (select count(*) from public.billing_followup_job where subscription_id='99000000-0000-0000-0000-000000000002')<>1 then raise exception 'outbox not exactly one durable intent'; end if;
 -- Reordered rejection must not overwrite the newer approval.
 r:=pg_temp.charge('old-rejection','RECHAZADO','2026-09-08T09:00:00Z');
 if r->>'estadoDespues'<>'ACTIVA' then raise exception 'stale rejection won'; end if;
 -- Pending payment must be able to become approved using the same payment ID.
 perform pg_temp.charge('pending','PENDIENTE','2026-09-08T11:00:00Z');
 perform pg_temp.charge('new-rejection','RECHAZADO','2026-09-08T12:00:00Z');
 r:=pg_temp.charge('pending','APROBADO','2026-09-08T13:00:00Z');
 if r->>'estadoDespues'<>'ACTIVA' then raise exception 'pending settlement ignored'; end if;
 -- Refund wins; a later replay of approval cannot resurrect refunded payment.
 r:=pg_temp.charge('pending','REFUNDED','2026-09-08T14:00:00Z');
 if r->>'estadoDespues'<>'MOROSA' then raise exception 'refund ignored'; end if;
 r:=pg_temp.charge('pending','APROBADO','2026-09-08T15:00:00Z');
 if r->>'estadoDespues'<>'MOROSA' then raise exception 'refunded payment resurrected'; end if;
 r:=pg_temp.charge('wrong-currency','APROBADO','2026-09-08T16:00:00Z',3000000,'USD');
 if r->>'estadoDespues'<>'MOROSA' then raise exception 'wrong currency granted access'; end if;
 r:=pg_temp.charge('wrong-amount','APROBADO','2026-09-08T17:00:00Z',100,'ARS');
 if r->>'estadoDespues'<>'MOROSA' then raise exception 'underpayment granted access'; end if;
 perform public.billing_apply_subscription('{"providerSubscriptionId":"durable-test","status":"ACTIVA","lastModified":"2026-09-08T18:00:00Z","nextChargeDate":"2026-12-01T00:00:00Z"}');
 if (select estado from public.suscripcion where mp_preapproval_id='durable-test')<>'MOROSA' then raise exception 'reconcile erased delinquency'; end if;
 if (select proxima_cobro from public.suscripcion where mp_preapproval_id='durable-test') is not null then raise exception 'reconcile extended unpaid period'; end if;
 perform public.billing_apply_subscription('{"providerSubscriptionId":"durable-test","status":"CANCELADA","lastModified":"2026-09-08T19:00:00Z"}');
 r:=pg_temp.charge('late-rejection','RECHAZADO','2026-09-08T20:00:00Z');
 if r->>'estadoDespues'<>'CANCELADA' then raise exception 'charge reopened cancellation'; end if;
 perform public.billing_apply_subscription('{"providerSubscriptionId":"durable-test","status":"ACTIVA","lastModified":"2026-09-08T18:30:00Z"}');
 if (select estado from public.suscripcion where mp_preapproval_id='durable-test')<>'CANCELADA' then raise exception 'stale preapproval overwrote cancellation'; end if;
end$$;

-- Fair scheduling advances untouched subscriptions; claims cannot overlap.
update public.suscripcion set estado='ACTIVA',next_reconcile_at='2000-01-01',reconcile_lease_until=null where mp_preapproval_id='durable-test';
do $$declare r public.suscripcion%rowtype; receipt jsonb; begin
 select * into r from public.billing_claim_reconcile(1);
 if r.mp_preapproval_id <> 'durable-test' then raise exception 'oldest due subscription not claimed'; end if;
 if r.last_reconcile_checked_at is null or r.next_reconcile_at <= now() then raise exception 'unchanged subscription will starve later rows'; end if;
 if exists(select 1 from public.billing_claim_reconcile(50) where id=r.id) then raise exception 'lease claimed twice'; end if;
 receipt:=public.billing_claim_receipt('test-receipt','subscription_preapproval','durable-test');
 if receipt->>'status'<>'claimed' then raise exception 'receipt not durable'; end if;
 if public.billing_claim_receipt('test-receipt','subscription_preapproval','durable-test')->>'status'<>'busy' then raise exception 'receipt lease overlaps'; end if;
 update public.billing_webhook_receipt set lease_until=now()-interval '1 second' where event_key='test-receipt';
 if public.billing_claim_receipt('test-receipt','subscription_preapproval','durable-test')->>'status'<>'claimed' then raise exception 'incomplete receipt unreplayable'; end if;
 if has_function_privilege('authenticated','public.billing_record_charge(jsonb,integer,integer)','execute') then raise exception 'user can authorize payments'; end if;
 if has_table_privilege('authenticated','public.billing_followup_job','select') then raise exception 'user can read private jobs'; end if;
end$$;
rollback;
