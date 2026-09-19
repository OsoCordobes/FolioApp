-- Atomic provider observations; service-only invoker RPCs, no copied patient payloads.
alter table public.suscripcion
  add column charge_last_modified timestamptz,
  add column charge_last_payment_id text,
  add column next_reconcile_at timestamptz not null default now(),
  add column last_reconcile_checked_at timestamptz,
  add column reconcile_lease_until timestamptz,
  add column reconcile_lease_token uuid;
alter table public.cargo_suscripcion add column provider_last_modified timestamptz;
create index suscripcion_reconcile_due on public.suscripcion(next_reconcile_at, id) where mp_preapproval_id is not null;

create table public.billing_followup_job (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check(job_type in ('payment_failed','subscription_activated','subscription_reactivated','payment_review')),
  organization_id uuid not null references public.organization(id),
  subscription_id uuid not null references public.suscripcion(id),
  charge_id uuid references public.cargo_suscripcion(id),
  idempotency_key text not null unique,
  status text not null default 'pending' check(status in ('pending','leased','retryable','terminal','accepted','delivered')),
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid,
  attempts integer not null default 0 check(attempts >= 0),
  provider_id text,
  sanitized_error text check(length(sanitized_error) <= 100),
  created_at timestamptz not null default now()
);
alter table public.billing_followup_job enable row level security;
alter table public.billing_followup_job force row level security;
revoke all on public.billing_followup_job from public, anon, authenticated;
grant all on public.billing_followup_job to service_role;
create index billing_followup_due on public.billing_followup_job(available_at,id) where status in ('pending','retryable','leased');

create table public.billing_webhook_receipt (
  event_key text primary key,
  topic text not null,
  resource_id text not null,
  status text not null default 'pending' check(status in ('pending','processing','done')),
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid,
  attempts integer not null default 0,
  sanitized_error text check(length(sanitized_error) <= 100),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.billing_webhook_receipt enable row level security;
alter table public.billing_webhook_receipt force row level security;
revoke all on public.billing_webhook_receipt from public, anon, authenticated;
grant all on public.billing_webhook_receipt to service_role;

create function public.billing_record_charge(p_charge jsonb, p_clinic_base integer, p_clinic_seat integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  s public.suscripcion%rowtype; c public.cargo_suscripcion%rowtype;
  before_state public.estado_suscripcion; episode timestamptz;
  incoming public.estado_cargo := (p_charge->'payment'->>'status')::public.estado_cargo;
  stamp timestamptz := (p_charge->>'lastModified')::timestamptz;
  amount integer := (p_charge->>'amountCents')::integer;
  changed boolean := false; is_new boolean := false; valid_amount boolean; authoritative boolean;
  job text; warning text;
begin
  select * into s from public.suscripcion where mp_preapproval_id = p_charge->>'providerSubscriptionId' for update;
  if not found then raise exception using errcode='P0002',message='subscription_not_linked'; end if;
  before_state := s.estado; episode := s.morosa_desde;
  if p_charge->'payment' is not null and p_charge->'payment' <> 'null'::jsonb then
    if stamp is null then raise exception using errcode='22023',message='provider_timestamp_required'; end if;
    if amount is null or amount <= 0 or p_charge->>'currency' is null or incoming is null or nullif(p_charge->'payment'->>'paymentId','') is null or p_clinic_base <= 0 or p_clinic_seat <= 0 then raise exception using errcode='22023',message='invalid_charge_amount'; end if;
    select * into c from public.cargo_suscripcion where mp_payment_id=p_charge->'payment'->>'paymentId' for update;
    if found and c.suscripcion_id <> s.id then raise exception using errcode='22023',message='payment_subscription_mismatch'; end if;
    if c.id is null then
      insert into public.cargo_suscripcion(suscripcion_id,mp_payment_id,mp_authorized_payment_id,monto_cents,estado,fecha_intento,fecha_acreditacion,raw_payload,provider_last_modified)
      values(s.id,p_charge->'payment'->>'paymentId',p_charge->>'providerChargeId',amount,incoming,coalesce((p_charge->>'attemptDate')::timestamptz,stamp),case when incoming='APROBADO' then stamp end,'{}',stamp) returning * into c;
      is_new := true; changed := true;
    elsif c.provider_last_modified is null or stamp > c.provider_last_modified then
      -- A refund is terminal for this payment; stale approvals cannot undo it.
      changed := c.estado <> incoming and c.estado <> 'REFUNDED';
      update public.cargo_suscripcion set estado=case when changed then incoming else estado end,
        provider_last_modified=stamp, fecha_acreditacion=case when changed and incoming='APROBADO' then stamp else fecha_acreditacion end
      where id=c.id returning * into c;
    end if;
    valid_amount := p_charge->>'currency' = s.moneda and p_charge->>'currency' = 'ARS' and
      (amount >= s.monto_cents - 1 or (s.monto_cents >= p_clinic_base and amount >= p_clinic_base and (s.monto_cents-amount)%p_clinic_seat=0));
    if not valid_amount then warning := 'Monto o moneda inesperados; requiere revisión.'; end if;
    -- Compare provider timestamps inside the lock, never application read-then-write.
    authoritative := changed and (s.charge_last_modified is null or stamp > s.charge_last_modified)
      and (s.mp_last_modified is null or stamp >= s.mp_last_modified);
    if authoritative then
      if incoming='APROBADO' then
        s.ultimo_cobro_ts := stamp; s.ultimo_error := warning;
        if valid_amount and s.estado in ('MOROSA','PENDIENTE_ACTIVACION') then
          s.estado := 'ACTIVA'; s.morosa_desde := null;
          s.fecha_activacion := coalesce(s.fecha_activacion,stamp);
        end if;
      elsif incoming in ('RECHAZADO','REFUNDED') and s.estado not in ('CANCELADA','PAUSADA') and (incoming='RECHAZADO' or s.estado='ACTIVA') then
        s.estado := 'MOROSA'; s.morosa_desde := coalesce(s.morosa_desde,stamp);
        s.ultimo_error := case when incoming='REFUNDED' then 'Cobro reembolsado o revertido.' else 'Cobro rechazado por Mercado Pago.' end;
      end if;
      -- Pending observations must not suppress a later settled payment.
      if incoming <> 'PENDIENTE' then
        update public.suscripcion set estado=s.estado,morosa_desde=s.morosa_desde,ultimo_cobro_ts=s.ultimo_cobro_ts,
          ultimo_error=s.ultimo_error,fecha_activacion=s.fecha_activacion,charge_last_modified=stamp,charge_last_payment_id=c.mp_payment_id where id=s.id;
      end if;
      job := case when not valid_amount then 'payment_review'
        when incoming='RECHAZADO' then 'payment_failed'
        when before_state='MOROSA' and s.estado='ACTIVA' then 'subscription_reactivated'
        when before_state='PENDIENTE_ACTIVACION' and s.estado='ACTIVA' then 'subscription_activated' end;
      if job is not null then
        insert into public.billing_followup_job(job_type,organization_id,subscription_id,charge_id,idempotency_key)
        values(job,s.organization_id,s.id,c.id,'mp:'||c.mp_payment_id||':'||incoming::text||':'||job)
        on conflict(idempotency_key) do nothing;
      end if;
    end if;
  end if;
  return jsonb_build_object('cargo',case when c.id is null then null else jsonb_build_object('id',c.id,'mpPaymentId',c.mp_payment_id,'montoCents',c.monto_cents,'estado',c.estado,'fechaIntento',c.fecha_intento,'fechaAcreditacion',c.fecha_acreditacion) end,
    'isNewCharge',is_new,'estadoAntes',before_state,'estadoDespues',s.estado,'organizationId',s.organization_id,
    'payerEmail',s.payer_email,'montoMensualCents',s.monto_cents,'mpPreapprovalId',s.mp_preapproval_id,'morosaDesdeAntes',episode);
end $$;
revoke all on function public.billing_record_charge(jsonb,integer,integer) from public,anon,authenticated;
grant execute on function public.billing_record_charge(jsonb,integer,integer) to service_role;

create function public.billing_apply_subscription(p_info jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.suscripcion%rowtype; incoming public.estado_suscripcion; before_state public.estado_suscripcion;
  stamp timestamptz := (p_info->>'lastModified')::timestamptz; preserve_morosa boolean;
begin
  select * into s from public.suscripcion where mp_preapproval_id=p_info->>'providerSubscriptionId' for update;
  if not found then raise exception using errcode='P0002',message='subscription_not_linked'; end if;
  if stamp is null then raise exception using errcode='22023',message='provider_timestamp_required'; end if;
  if s.mp_last_modified is not null and stamp <= s.mp_last_modified then return null; end if;
  if s.charge_last_modified is not null and stamp < s.charge_last_modified then return null; end if;
  before_state := s.estado;
  incoming := (case when p_info->>'status'='PENDIENTE' then 'PENDIENTE_ACTIVACION' else p_info->>'status' end)::public.estado_suscripcion;
  preserve_morosa := s.estado='MOROSA' and incoming='ACTIVA';
  if preserve_morosa or (s.charge_last_modified is not null and stamp < s.charge_last_modified) then incoming := s.estado; end if;
  update public.suscripcion set estado=incoming,mp_last_modified=stamp,
    proxima_cobro=case when preserve_morosa then proxima_cobro else coalesce((p_info->>'nextChargeDate')::timestamptz,proxima_cobro) end,
    fecha_activacion=case when incoming='ACTIVA' then coalesce(fecha_activacion,stamp) else fecha_activacion end,
    fecha_cancelacion=case when incoming='CANCELADA' then coalesce(fecha_cancelacion,stamp) else fecha_cancelacion end
  where id=s.id returning * into s;
  if before_state='PENDIENTE_ACTIVACION' and s.estado='ACTIVA' then
    insert into public.billing_followup_job(job_type,organization_id,subscription_id,idempotency_key)
    values('subscription_activated',s.organization_id,s.id,'mp:'||s.mp_preapproval_id||':subscription_activated') on conflict(idempotency_key) do nothing;
  end if;
  return to_jsonb(s);
end $$;
revoke all on function public.billing_apply_subscription(jsonb) from public,anon,authenticated;
grant execute on function public.billing_apply_subscription(jsonb) to service_role;

create function public.billing_claim_reconcile(p_limit integer default 50) returns setof public.suscripcion
language sql security invoker set search_path='' as $$
  with picked as (
    select id from public.suscripcion where mp_preapproval_id is not null
      and estado in ('PENDIENTE_ACTIVACION','ACTIVA','MOROSA','PAUSADA')
      and next_reconcile_at <= now() and (reconcile_lease_until is null or reconcile_lease_until <= now())
    order by next_reconcile_at,id for update skip locked limit least(greatest(p_limit,1),50)
  ) update public.suscripcion s set last_reconcile_checked_at=now(),next_reconcile_at=now()+interval '24 hours',
      reconcile_lease_until=now()+interval '2 minutes',reconcile_lease_token=gen_random_uuid()
    from picked where s.id=picked.id returning s.*;
$$;
revoke all on function public.billing_claim_reconcile(integer) from public,anon,authenticated;
grant execute on function public.billing_claim_reconcile(integer) to service_role;

create function public.billing_claim_receipt(p_key text,p_topic text,p_resource text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.billing_webhook_receipt%rowtype;
begin
  insert into public.billing_webhook_receipt(event_key,topic,resource_id) values(p_key,p_topic,p_resource) on conflict do nothing;
  select * into r from public.billing_webhook_receipt where event_key=p_key for update;
  if r.topic<>p_topic or r.resource_id<>p_resource then raise exception 'receipt_identity_mismatch'; end if;
  if r.status='done' then return jsonb_build_object('status','done'); end if;
  if r.lease_until>now() then return jsonb_build_object('status','busy'); end if;
  update public.billing_webhook_receipt set status='processing',lease_until=now()+interval '1 minute',
    lease_token=gen_random_uuid(),attempts=attempts+1 where event_key=p_key returning * into r;
  return jsonb_build_object('status','claimed','token',r.lease_token);
end $$;
revoke all on function public.billing_claim_receipt(text,text,text) from public,anon,authenticated;
grant execute on function public.billing_claim_receipt(text,text,text) to service_role;

create function public.billing_claim_followups(p_limit integer default 20) returns setof public.billing_followup_job
language plpgsql security invoker set search_path='' as $$
begin
  update public.billing_followup_job set status='terminal',sanitized_error='attempts_exhausted',lease_token=null,lease_until=null
    where status in ('pending','retryable','leased') and attempts>=10 and (lease_until is null or lease_until<=now());
  return query with picked as (
    select id from public.billing_followup_job where status in ('pending','retryable','leased')
      and available_at <= now() and (lease_until is null or lease_until<=now()) and attempts<10
    order by available_at,id for update skip locked limit least(greatest(p_limit,1),50)
  ) update public.billing_followup_job j set status='leased',lease_until=now()+interval '2 minutes',
      lease_token=gen_random_uuid(),attempts=attempts+1 from picked where j.id=picked.id returning j.*;
end $$;
create function public.billing_finish_followup(p_id uuid,p_token uuid,p_status text,p_provider_id text default null,p_error text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if p_status not in ('retryable','terminal','accepted','delivered') then raise exception 'invalid_job_status'; end if;
  if p_error is not null and p_error !~ '^[a-z0-9_:-]{1,100}$' then raise exception 'unsanitized_error'; end if;
  update public.billing_followup_job set status=case when p_status='retryable' and attempts>=10 then 'terminal' else p_status end,
    provider_id=coalesce(p_provider_id,provider_id),sanitized_error=p_error,lease_until=null,lease_token=null,
    available_at=case when p_status='retryable' then now()+least(3600,power(2,attempts)::integer*30)*interval '1 second' else available_at end
    where id=p_id and lease_token=p_token and status='leased' and lease_until>now();
  return found;
end $$;
revoke all on function public.billing_claim_followups(integer) from public,anon,authenticated;
revoke all on function public.billing_finish_followup(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.billing_claim_followups(integer) to service_role;
grant execute on function public.billing_finish_followup(uuid,uuid,text,text,text) to service_role;

-- Provider mutation saga. One unresolved operation per org serializes create,
-- cancellation and price changes; uncertain POSTs are recovered by observation only.
create table public.billing_provider_operation (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organization(id),
 subscription_id uuid not null references public.suscripcion(id),
 kind text not null check(kind in ('create','amount','cancel')),
 amount_cents integer not null check(amount_cents>0),
 previous_preapproval_id text,
 provider_id text,
 status text not null default 'pending' check(status in ('pending','processing','uncertain','done','terminal')),
 phase text not null default 'pending' check(phase in ('pending','cancel_previous','create','amount','cancel')),
 idempotency_key uuid not null default gen_random_uuid() unique,
 available_at timestamptz not null default now(),
 lease_until timestamptz,
 lease_token uuid,
 attempts integer not null default 0,
 provider_write_started_at timestamptz,
 sanitized_error text,
 created_at timestamptz not null default now(),
 completed_at timestamptz
);
create unique index billing_provider_one_unresolved on public.billing_provider_operation(organization_id) where status in ('pending','processing','uncertain','terminal');
alter table public.billing_provider_operation enable row level security;
alter table public.billing_provider_operation force row level security;
revoke all on public.billing_provider_operation from public,anon,authenticated;
grant all on public.billing_provider_operation to service_role;

create function public.billing_reserve_operation(p_org uuid,p_kind text,p_amount integer,p_email text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.suscripcion%rowtype; op public.billing_provider_operation%rowtype;
begin
 perform 1 from public.organization where id=p_org for update;
 if not found then raise exception using errcode='P0002',message='organization_not_found'; end if;
 select * into op from public.billing_provider_operation where organization_id=p_org and status in ('pending','processing','uncertain','terminal');
 if found then
   if op.kind<>p_kind or op.status='terminal' then raise exception using errcode='23505',message='operation_requires_resolution'; end if;
   return to_jsonb(op);
 end if;
 select * into s from public.suscripcion where organization_id=p_org for update;
 if s.id is null and p_kind='create' then
   insert into public.suscripcion(organization_id,payer_email,monto_cents) values(p_org,p_email,p_amount) returning * into s;
 end if;
 if s.id is null then raise exception using errcode='P0002',message='subscription_not_found'; end if;
 if p_kind='create' and s.estado='ACTIVA' then raise exception using errcode='23505',message='subscription_already_active'; end if;
 if p_kind<>'create' and s.mp_preapproval_id is null then raise exception using errcode='23505',message='subscription_not_linked'; end if;
 insert into public.billing_provider_operation(organization_id,subscription_id,kind,amount_cents,previous_preapproval_id)
 values(p_org,s.id,p_kind,p_amount,s.mp_preapproval_id) returning * into op;
 return to_jsonb(op);
end $$;
create function public.billing_claim_operation(p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare op public.billing_provider_operation%rowtype;
begin
 select * into op from public.billing_provider_operation where id=p_id for update;
 if not found then return null; end if;
 if op.status='done' then return to_jsonb(op); end if;
 if op.status='terminal' or op.lease_until>now() then return null; end if;
 update public.billing_provider_operation set status='processing',lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',attempts=attempts+1
 where id=p_id returning * into op;
 return to_jsonb(op);
end $$;
create function public.billing_mark_operation_write(p_id uuid,p_token uuid,p_phase text) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 update public.billing_provider_operation set phase=p_phase,provider_write_started_at=now()
 where id=p_id and lease_token=p_token and lease_until>now() and status='processing';
 return found;
end $$;
create function public.billing_complete_operation(p_id uuid,p_token uuid,p_info jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare op public.billing_provider_operation%rowtype; s public.suscripcion%rowtype;
begin
 select * into op from public.billing_provider_operation where id=p_id and lease_token=p_token and lease_until>now() and status='processing' for update;
 if not found then raise exception using errcode='23505',message='operation_lease_lost'; end if;
 select * into s from public.suscripcion where id=op.subscription_id for update;
 if s.mp_preapproval_id is distinct from op.previous_preapproval_id then raise exception using errcode='23505',message='subscription_changed_during_operation'; end if;
 if op.kind<>'cancel' and (p_info->>'currency' is distinct from 'ARS' or (p_info->>'amountCents')::integer is distinct from op.amount_cents) then raise exception using errcode='22023',message='provider_amount_mismatch'; end if;
 if op.kind='create' then
   if p_info->>'externalReference' is distinct from 'folio_operation_'||op.id::text then raise exception 'provider_reference_mismatch'; end if;
   update public.suscripcion set mp_preapproval_id=p_info->>'providerSubscriptionId',monto_cents=op.amount_cents,
     estado=(case when p_info->>'status'='PENDIENTE' then 'PENDIENTE_ACTIVACION' else p_info->>'status' end)::public.estado_suscripcion,
     ultimo_error=null,fecha_cancelacion=null,morosa_desde=null,mp_last_modified=(p_info->>'lastModified')::timestamptz,
     charge_last_modified=null,charge_last_payment_id=null,next_reconcile_at=now(),
     proxima_cobro=(p_info->>'nextChargeDate')::timestamptz
   where id=s.id returning * into s;
 elsif p_info->>'providerSubscriptionId' is distinct from op.previous_preapproval_id then raise exception 'provider_subscription_mismatch';
 elsif op.kind='amount' then
   update public.suscripcion set monto_cents=op.amount_cents,next_reconcile_at=now() where id=s.id returning * into s;
 else
   if p_info->>'status' is distinct from 'CANCELADA' then raise exception 'provider_cancellation_unconfirmed'; end if;
   update public.suscripcion set estado='CANCELADA',fecha_cancelacion=coalesce(fecha_cancelacion,now()),mp_last_modified=(p_info->>'lastModified')::timestamptz
     where id=s.id returning * into s;
 end if;
 update public.billing_provider_operation set status='done',provider_id=p_info->>'providerSubscriptionId',lease_token=null,lease_until=null,completed_at=now(),sanitized_error=null where id=op.id;
 return to_jsonb(s);
end $$;
revoke all on function public.billing_reserve_operation(uuid,text,integer,text) from public,anon,authenticated;
revoke all on function public.billing_claim_operation(uuid) from public,anon,authenticated;
revoke all on function public.billing_mark_operation_write(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.billing_complete_operation(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.billing_reserve_operation(uuid,text,integer,text) to service_role;
grant execute on function public.billing_claim_operation(uuid) to service_role;
grant execute on function public.billing_mark_operation_write(uuid,uuid,text) to service_role;
grant execute on function public.billing_complete_operation(uuid,uuid,jsonb) to service_role;
