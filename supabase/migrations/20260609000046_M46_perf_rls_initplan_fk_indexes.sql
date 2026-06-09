-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M46 · Performance — RLS initplan + índices de FKs
-- ════════════════════════════════════════════════════════════════════════════
-- Remediación del Supabase performance advisor (2026-06-09):
--
--   1. WARN auth_rls_initplan — 8 policies llamaban auth.uid() directo, que
--      Postgres re-evalúa POR FILA escaneada. Envolverlo en (select auth.uid())
--      lo promueve a InitPlan (una sola evaluación por query). Las policies se
--      recrean idénticas salvo ese wrap.
--   2. INFO unindexed_foreign_keys — 21 FKs sin índice de cobertura. Tablas
--      chicas hoy, pero los joins clínicos (sesion, documento_clinico, turno)
--      crecen lineal con el uso.
--
-- Decisiones explícitas (NO incluidas acá):
--   · multiple_permissive_policies — consolidar policies es refactor de
--     autorización con riesgo funcional; post-demo con suite pgTAP dedicada.
--   · unused_index — la DB es pre-launch: "unused" no es señal todavía.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Policies con (select auth.uid()) ──────────────────────────────────

-- profile
drop policy if exists profile_select_self on public.profile;
create policy profile_select_self on public.profile
  for select using (id = (select auth.uid()));

drop policy if exists profile_update_self on public.profile;
create policy profile_update_self on public.profile
  for update using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- catálogos compartidos
drop policy if exists cie10_select_authenticated on public.codigo_cie10;
create policy cie10_select_authenticated on public.codigo_cie10
  for select using ((select auth.uid()) is not null);

drop policy if exists obra_social_select_authenticated on public.obra_social;
create policy obra_social_select_authenticated on public.obra_social
  for select using ((select auth.uid()) is not null);

-- sesion
drop policy if exists sesion_select_clinical on public.sesion;
create policy sesion_select_clinical on public.sesion
  for select using (
    organization_id in (select user_org_ids())
    and can_read_clinical(organization_id)
    and (
      user_role_in(organization_id) = 'OWNER'
      or (
        user_role_in(organization_id) = 'DIRECTOR'
        and exists (
          select 1 from member
           where member.profile_id = (select auth.uid())
             and member.organization_id = sesion.organization_id
             and member.es_colegiado = true
        )
      )
      or exists (
        select 1 from turno t
         where t.id = sesion.turno_id
           and t.profesional_id = user_member_id_in(sesion.organization_id)
      )
    )
  );

-- seguro_profesional
drop policy if exists seguro_select_admin_or_self on public.seguro_profesional;
create policy seguro_select_admin_or_self on public.seguro_profesional
  for select using (
    organization_id in (select user_org_ids())
    and (
      user_role_in(organization_id) in ('OWNER', 'DIRECTOR')
      or profile_id = (select auth.uid())
    )
  );

drop policy if exists seguro_write_admin_or_self on public.seguro_profesional;
create policy seguro_write_admin_or_self on public.seguro_profesional
  for all using (
    organization_id in (select user_org_ids())
    and (
      user_role_in(organization_id) = 'OWNER'
      or profile_id = (select auth.uid())
    )
  )
  with check (
    organization_id in (select user_org_ids())
    and (
      user_role_in(organization_id) = 'OWNER'
      or profile_id = (select auth.uid())
    )
  );

-- paciente
drop policy if exists paciente_select_clinical on public.paciente;
create policy paciente_select_clinical on public.paciente
  for select using (
    organization_id in (select user_org_ids())
    and can_read_clinical(organization_id)
    and (
      user_role_in(organization_id) = 'OWNER'
      or (
        user_role_in(organization_id) = 'DIRECTOR'
        and exists (
          select 1 from member
           where member.profile_id = (select auth.uid())
             and member.organization_id = paciente.organization_id
             and member.es_colegiado = true
        )
      )
      or (
        user_role_in(organization_id) = 'PROFESIONAL'
        and (
          profesional_principal_id = user_member_id_in(organization_id)
          or profesional_attended_paciente(id, organization_id)
        )
      )
    )
    and (
      caja_fuerte_profesional is null
      or caja_fuerte_profesional = user_member_id_in(organization_id)
    )
  );

-- ─── 2. Índices de cobertura para FKs sin índice ──────────────────────────

create index if not exists alergia_verificada_por_idx                 on public.alergia (verificada_por);
create index if not exists cobertura_paciente_organization_idx        on public.cobertura_paciente (organization_id);
create index if not exists consentimiento_firmado_por_tutor_idx       on public.consentimiento (firmado_por_tutor_id);
create index if not exists contacto_emergencia_organization_idx       on public.contacto_emergencia (organization_id);
create index if not exists diagnostico_creado_por_idx                 on public.diagnostico (creado_por_id);
create index if not exists disponibilidad_profesional_member_idx      on public.disponibilidad_profesional (member_id);
create index if not exists documento_clinico_consentimiento_idx       on public.documento_clinico (consentimiento_id);
create index if not exists documento_clinico_subido_por_idx           on public.documento_clinico (subido_por_id);
create index if not exists integration_profesional_idx                on public.integration (profesional_id);
create index if not exists member_invited_by_idx                      on public.member (invited_by_id);
create index if not exists paciente_deleted_by_idx                    on public.paciente (deleted_by_id);
create index if not exists pedido_servicio_idx                        on public.pedido (servicio_id);
create index if not exists plantilla_consentimiento_reemplazado_idx   on public.plantilla_consentimiento (reemplazado_por);
create index if not exists pseudonimizacion_event_performed_by_idx    on public.pseudonimizacion_event (performed_by);
create index if not exists recordatorio_job_organization_idx          on public.recordatorio_job (organization_id);
create index if not exists seguro_profesional_profile_idx             on public.seguro_profesional (profile_id);
create index if not exists servicio_profesional_member_idx            on public.servicio_profesional (member_id);
create index if not exists sesion_locked_by_idx                       on public.sesion (locked_by_id);
create index if not exists sesion_enmienda_organization_idx           on public.sesion_enmienda (organization_id);
create index if not exists turno_servicio_idx                         on public.turno (servicio_id);
create index if not exists tutor_legal_organization_idx               on public.tutor_legal (organization_id);
