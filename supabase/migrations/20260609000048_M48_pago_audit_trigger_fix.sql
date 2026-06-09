-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M48 · pago_audit: la tabla pago no tiene organization_id
-- ════════════════════════════════════════════════════════════════════════════
-- Bug encontrado en el smoke test E2E pre-demo (2026-06-09): TODO insert en
-- `pago` — por cualquier rol, incluso service_role — abortaba con
--
--   record "new" has no field "organization_id"
--   CONTEXT: audit_log_trigger() line 20
--
-- M12 colgó el trigger genérico `audit_log_trigger()` (que lee
-- NEW.organization_id) sobre `pago`, pero pago se relaciona con la org vía
-- turno_id (no tiene columna organization_id). Resultado: registrar un cobro
-- era imposible desde el día uno — /finanzas siempre en $0.
--
-- Fix: variante del trigger que resuelve la org a través del turno.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function audit_log_trigger_via_turno()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_action        text;
  v_resource_id   text;
  v_turno_id      uuid;
  v_org_id        uuid;
  v_actor_id      uuid;
  v_actor_role    text;
  v_payload       jsonb;
begin
  v_action := tg_table_name || '.' || lower(tg_op);

  if tg_op = 'DELETE' then
    v_resource_id := old.id::text;
    v_turno_id    := old.turno_id;
    v_payload     := to_jsonb(old);
  else
    v_resource_id := new.id::text;
    v_turno_id    := new.turno_id;
    if tg_op = 'UPDATE' then
      v_payload := jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new));
    else
      v_payload := to_jsonb(new);
    end if;
  end if;

  select organization_id into v_org_id from turno where id = v_turno_id;

  v_actor_id := auth.uid();
  if v_actor_id is not null and v_org_id is not null then
    select role::text into v_actor_role
      from member
     where profile_id = v_actor_id and organization_id = v_org_id
     limit 1;
  end if;

  insert into audit_log (
    organization_id, actor_id, actor_role,
    action, resource_type, resource_id, payload, ts
  ) values (
    v_org_id, v_actor_id, v_actor_role,
    v_action, tg_table_name, v_resource_id, v_payload, now()
  );

  if tg_op = 'DELETE' then return old; else return new; end if;
end
$$;

revoke all on function audit_log_trigger_via_turno() from public, anon, authenticated, service_role;

drop trigger if exists pago_audit on pago;
create trigger pago_audit
  after insert or update on pago
  for each row execute function audit_log_trigger_via_turno();

comment on function audit_log_trigger_via_turno() is
  'Folio M48 · audit trigger para tablas sin organization_id propia que cuelgan de turno (pago). Resuelve la org vía turno_id e inserta en audit_log igual que audit_log_trigger().';
