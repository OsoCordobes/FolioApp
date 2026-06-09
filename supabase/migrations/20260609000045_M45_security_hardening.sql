-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M45 · Security hardening (advisor remediation pre-launch)
-- ════════════════════════════════════════════════════════════════════════════
-- Cierra los hallazgos del Supabase security advisor verificados contra prod
-- el 2026-06-09:
--
--   1. ERROR rls_disabled_in_public — las 13 particiones de audit_log tenían
--      RLS deshabilitado Y grants completos (arwdDxtm) para anon/authenticated:
--      cualquier cliente API podía leer/escribir/borrar el audit trail vía los
--      endpoints PostgREST de cada partición (la RLS del padre solo aplica a
--      queries que entran por el padre). Ley 26.529 exige integridad del log.
--   2. Las funciones que crean particiones futuras (M12/M28) ahora habilitan
--      RLS y revocan grants en cada partición nueva — sin esto, el cron
--      mensual reabriría el agujero.
--   3. WARN anon_security_definer_function_executable — TODAS las funciones
--      SECURITY DEFINER eran ejecutables por anon (incluso las que M28 había
--      revocado: drift en prod). Se aplica matriz de mínimo privilegio:
--        · service_role only — purga/mantenimiento de audit, bootstrap de
--          signup, lookups sobre auth.users, hmac_blind (sin caller en app).
--        · authenticated — helpers de RLS y operaciones de paciente que ya
--          validan auth.uid() + rol internamente.
--        · trigger functions — revocadas de todos los roles API (solo corren
--          como triggers).
--   4. ERROR security_definer_view — integration_active pasa a
--      security_invoker (PG15+): respeta la RLS del usuario que consulta.
--   5. WARN function_search_path_mutable — se fija search_path en las 4
--      funciones que no lo tenían.
--   6. WARN public_bucket_allows_listing — se elimina la policy SELECT amplia
--      de org-logos: el bucket es público y sirve objetos por URL pública sin
--      necesidad de policy; la policy solo habilitaba ENUMERAR archivos.
--   7. Fix funcional: pseudonimizar_paciente exigía auth.uid(), pero el cron
--      /api/cron/account-purge la invoca con service_role (auth.uid() = NULL)
--      → la purga Ley 25.326 art. 16 nunca podía completarse. Se agrega el
--      camino service_role (performed_by queda NULL, motivo lo documenta).
--
-- NO automatizable por SQL (acciones de operador, ver PR):
--   · Auth leaked-password protection (dashboard → Auth → Passwords).
--   · ALTER DATABASE ... SET folio.hmac_key (debe igualar FOLIO_ENC_HMAC_KEY).
--   · Mover pg_trgm/btree_gist al schema extensions (requiere recrear índices;
--     posponer post-demo).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. RLS + revoke en todas las particiones existentes de audit_log ─────

do $$
declare
  r record;
begin
  for r in
    select c.relname
      from pg_inherits i
      join pg_class p on p.oid = i.inhparent
      join pg_class c on c.oid = i.inhrelid
      join pg_namespace n on n.oid = p.relnamespace
     where n.nspname = 'public' and p.relname = 'audit_log'
  loop
    execute format('alter table public.%I enable row level security', r.relname);
    -- Sin policies propias: deny-all para anon/authenticated en acceso
    -- directo. service_role (BYPASSRLS) y las queries vía el padre (policies
    -- del padre) siguen funcionando.
    execute format('revoke all on public.%I from anon, authenticated', r.relname);
  end loop;
end
$$;

-- ─── 2. Las funciones de mantenimiento sellan las particiones nuevas ──────

-- M12 · backfill manual.
create or replace function audit_log_ensure_future_partitions(months_ahead integer default 3)
returns void language plpgsql security definer set search_path = public as $$
declare
  start_date date;
  end_date   date;
  part_name  text;
  i          integer;
begin
  for i in 0..months_ahead loop
    start_date := date_trunc('month', current_date)::date + (i || ' months')::interval;
    end_date   := start_date + interval '1 month';
    part_name  := format('audit_log_%s', to_char(start_date, 'YYYY_MM'));
    begin
      execute format(
        'create table if not exists %I partition of audit_log for values from (%L) to (%L)',
        part_name, start_date, end_date
      );
    exception
      when duplicate_table then null;
    end;
    -- M45: sellar la partición (idempotente — aplica también a preexistentes).
    execute format('alter table %I enable row level security', part_name);
    execute format('revoke all on %I from anon, authenticated', part_name);
  end loop;
end
$$;

-- M28 · wrapper estable para el cron mensual.
create or replace function audit_log_run_maintenance(p_months_ahead int default 6)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before     int;
  v_after      int;
  v_orphans    bigint;
  v_failures   jsonb := '[]'::jsonb;
  v_start_date date;
  v_end_date   date;
  v_part_name  text;
  v_i          int;
begin
  if p_months_ahead < 1 or p_months_ahead > 24 then
    raise exception 'audit_log_run_maintenance: months_ahead must be 1..24, got %', p_months_ahead;
  end if;

  select count(*) into v_before
    from pg_tables
    where tablename ~ '^audit_log_[0-9]{4}_[0-9]{2}$';

  for v_i in 0..p_months_ahead loop
    v_start_date := (date_trunc('month', current_date)::date + (v_i || ' months')::interval)::date;
    v_end_date   := (v_start_date + interval '1 month')::date;
    v_part_name  := format('audit_log_%s', to_char(v_start_date, 'YYYY_MM'));
    begin
      execute format(
        'create table if not exists %I partition of audit_log for values from (%L) to (%L)',
        v_part_name, v_start_date, v_end_date
      );
      -- M45: sellar la partición (RLS on + sin grants directos para roles API).
      execute format('alter table %I enable row level security', v_part_name);
      execute format('revoke all on %I from anon, authenticated', v_part_name);
    exception when others then
      v_failures := v_failures || jsonb_build_array(
        jsonb_build_object(
          'partition', v_part_name,
          'sqlstate',  sqlstate,
          'message',   sqlerrm
        )
      );
    end;
  end loop;

  select count(*) into v_after
    from pg_tables
    where tablename ~ '^audit_log_[0-9]{4}_[0-9]{2}$';

  select count(*) into v_orphans from only audit_log_default;

  return jsonb_build_object(
    'months_ahead',              p_months_ahead,
    'partitions_before',         v_before,
    'partitions_after',          v_after,
    'created',                   v_after - v_before,
    'failures',                  v_failures,
    'failure_count',             jsonb_array_length(v_failures),
    'default_partition_orphans', v_orphans,
    'ts',                        now()
  );
end
$$;

-- ─── 3. Matriz de mínimo privilegio sobre funciones SECURITY DEFINER ──────

-- 3a. service_role only — operaciones privilegiadas sin guard interno o
--     llamadas exclusivamente con el service client (verificado por grep:
--     login/actions.ts, onboarding/actions.ts, lib/auth/find-user-by-email.ts,
--     api/cron/*).
revoke all on function public.audit_log_purge_expired(integer)                              from public, anon, authenticated;
revoke all on function public.audit_log_run_maintenance(integer)                            from public, anon, authenticated;
revoke all on function public.audit_log_ensure_future_partitions(integer)                   from public, anon, authenticated;
revoke all on function public.bootstrap_org_atomic(uuid, text, text, text, text, text)      from public, anon, authenticated;
revoke all on function public.find_user_id_by_email(text)                                   from public, anon, authenticated;
revoke all on function public.user_providers_by_email(text)                                 from public, anon, authenticated;
revoke all on function public.hmac_blind(text)                                              from public, anon, authenticated;
grant execute on function public.audit_log_purge_expired(integer)                           to service_role;
grant execute on function public.audit_log_run_maintenance(integer)                         to service_role;
grant execute on function public.audit_log_ensure_future_partitions(integer)                to service_role;
grant execute on function public.bootstrap_org_atomic(uuid, text, text, text, text, text)   to service_role;
grant execute on function public.find_user_id_by_email(text)                                to service_role;
grant execute on function public.user_providers_by_email(text)                              to service_role;
grant execute on function public.hmac_blind(text)                                           to service_role;

-- 3b. authenticated + service_role — helpers de RLS (los evalúan las policies
--     con los privilegios del rol que consulta) y operaciones de paciente con
--     guard interno (auth.uid() + rol). anon queda afuera: ningún flujo
--     público toca estas tablas con el rol anon (el booking corre server-side
--     con service_role).
revoke all on function public.user_org_ids()                                    from public, anon;
revoke all on function public.user_role_in(uuid)                                from public, anon;
revoke all on function public.user_member_id_in(uuid)                           from public, anon;
revoke all on function public.can_read_admin(uuid)                              from public, anon;
revoke all on function public.can_read_clinical(uuid)                           from public, anon;
revoke all on function public.user_has_scope_over(uuid, uuid)                   from public, anon;
revoke all on function public.has_caja_fuerte_blocking_access(uuid, uuid)       from public, anon;
revoke all on function public.paciente_es_pseudonimizado(uuid)                  from public, anon;
revoke all on function public.paciente_tiene_alergias_severas(uuid)             from public, anon;
revoke all on function public.profesional_attended_paciente(uuid, uuid)         from public, anon;
revoke all on function public.soft_delete_paciente(uuid, text)                  from public, anon;
revoke all on function public.restore_paciente(uuid)                            from public, anon;
revoke all on function public.pseudonimizar_paciente(uuid, text, boolean)       from public, anon;
revoke all on function public.pseudonimizar_member(text, boolean)               from public, anon;
grant execute on function public.user_org_ids()                                 to authenticated, service_role;
grant execute on function public.user_role_in(uuid)                             to authenticated, service_role;
grant execute on function public.user_member_id_in(uuid)                        to authenticated, service_role;
grant execute on function public.can_read_admin(uuid)                           to authenticated, service_role;
grant execute on function public.can_read_clinical(uuid)                        to authenticated, service_role;
grant execute on function public.user_has_scope_over(uuid, uuid)                to authenticated, service_role;
grant execute on function public.has_caja_fuerte_blocking_access(uuid, uuid)    to authenticated, service_role;
grant execute on function public.paciente_es_pseudonimizado(uuid)               to authenticated, service_role;
grant execute on function public.paciente_tiene_alergias_severas(uuid)          to authenticated, service_role;
grant execute on function public.profesional_attended_paciente(uuid, uuid)      to authenticated, service_role;
grant execute on function public.soft_delete_paciente(uuid, text)               to authenticated, service_role;
grant execute on function public.restore_paciente(uuid)                         to authenticated, service_role;
grant execute on function public.pseudonimizar_paciente(uuid, text, boolean)    to authenticated, service_role;
grant execute on function public.pseudonimizar_member(text, boolean)            to authenticated, service_role;

-- 3c. Trigger functions — nunca se invocan por RPC; correr como trigger no
--     requiere EXECUTE del caller.
revoke all on function public.audit_log_trigger()                    from public, anon, authenticated, service_role;
revoke all on function public.audit_log_trigger_profile()            from public, anon, authenticated, service_role;
revoke all on function public.audit_log_trigger_self_org()           from public, anon, authenticated, service_role;
revoke all on function public.audit_organization_internal_flag()     from public, anon, authenticated, service_role;
revoke all on function public.cascade_soft_delete_org_members()      from public, anon, authenticated, service_role;

-- ─── 4. integration_active respeta la RLS del invocador ───────────────────

alter view public.integration_active set (security_invoker = true);

-- ─── 5. search_path fijo en funciones que no lo tenían ────────────────────

alter function public.prevent_sesion_enmienda_mutation() set search_path = public;
alter function public.set_updated_at() set search_path = public;
alter function public.turno_tstzrange(timestamptz, int) set search_path = public;
alter function analytics.metrica_k_min(text) set search_path = public;

-- ─── 6. org-logos: público por URL, sin listado ────────────────────────────
-- El bucket es public=true: los objetos se sirven por
-- /storage/v1/object/public/org-logos/... sin policy. La policy SELECT amplia
-- solo habilitaba listar/enumerar todos los logos vía la Storage API.

drop policy if exists "org-logos public read" on storage.objects;

-- ─── 7. pseudonimizar_paciente: camino service_role para el cron de purga ─

create or replace function public.pseudonimizar_paciente(
  p_paciente_id uuid,
  p_motivo      text,
  p_dry_run     boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id            uuid;
  v_actor_id          uuid;
  v_actor_member_id   uuid;
  v_identidad_id      uuid;
  v_actor_role        text;
  v_is_service        boolean;
  v_nombre_hash       text;
  v_dni_hash          text;
begin
  v_actor_id   := auth.uid();
  -- M45: el cron /api/cron/account-purge invoca con service_role (sin JWT de
  -- usuario). Antes esto abortaba con "requiere auth.uid()" y la purga post
  -- grace de 30 días (Ley 25.326 art. 16) nunca corría.
  v_is_service := v_actor_id is null and coalesce(auth.role(), '') = 'service_role';
  if v_actor_id is null and not v_is_service then
    raise exception 'pseudonimizar_paciente: requiere auth.uid()';
  end if;
  if p_motivo is null or length(trim(p_motivo)) < 3 then
    raise exception 'pseudonimizar_paciente: motivo requerido (>= 3 caracteres)';
  end if;

  select p.organization_id, p.identidad_id
    into v_org_id, v_identidad_id
    from paciente p
   where p.id = p_paciente_id;
  if v_org_id is null then
    raise exception 'pseudonimizar_paciente: paciente % no existe', p_paciente_id;
  end if;

  if v_is_service then
    v_actor_role := 'service_role';
  else
    select role, id into v_actor_role, v_actor_member_id
      from member
     where profile_id = v_actor_id
       and organization_id = v_org_id
       and deleted_at is null;
    if v_actor_role not in ('OWNER', 'DIRECTOR') then
      raise exception 'pseudonimizar_paciente: rol % no autorizado. Solo OWNER/DIRECTOR.', v_actor_role;
    end if;
  end if;

  -- Capturar los blind-index hashes ANTES de borrar (audit trail M25).
  if v_identidad_id is not null then
    select nombre_hash, dni_hash
      into v_nombre_hash, v_dni_hash
      from paciente_identidad
     where id = v_identidad_id;
  end if;

  if p_dry_run then
    return jsonb_build_object(
      'paciente_id', p_paciente_id,
      'organization_id', v_org_id,
      'actor_role', v_actor_role,
      'motivo', p_motivo,
      'dry_run', true,
      'identidad_id', v_identidad_id,
      'would_record_event', v_dni_hash is not null and v_nombre_hash is not null
    );
  end if;

  if v_dni_hash is not null and v_nombre_hash is not null then
    insert into pseudonimizacion_event
      (organization_id, paciente_id, dni_sha256, nombre_sha256, performed_by, motivo)
    values
      (v_org_id, p_paciente_id, v_dni_hash, v_nombre_hash, v_actor_id, p_motivo);
  end if;

  if v_identidad_id is not null then
    delete from paciente_identidad where id = v_identidad_id;
  end if;

  update paciente
     set identidad_id      = null,
         pseudonimizado_en = now()
   where id = p_paciente_id;

  return jsonb_build_object(
    'paciente_id', p_paciente_id,
    'organization_id', v_org_id,
    'actor_role', v_actor_role,
    'motivo', p_motivo,
    'dry_run', false,
    'identidad_id_borrada', v_identidad_id,
    'pseudonimizacion_event_recorded', v_dni_hash is not null
  );
end
$$;

comment on function public.pseudonimizar_paciente(uuid, text, boolean) is
  'Folio M13/M25/M45 · pseudonimiza un paciente (borra identidad, conserva hashes en pseudonimizacion_event). Callers: UI (OWNER/DIRECTOR, valida membership) y cron account-purge (service_role, performed_by NULL).';
