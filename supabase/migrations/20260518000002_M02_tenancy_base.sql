-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M02 · Tenancy base (Organization, Profile, Member, Equipo)
-- ════════════════════════════════════════════════════════════════════════════
-- Define la jerarquía multi-tenant clinic-ready:
--   Organization (consultorio o clínica)
--    └─ Member (persona en la org, con role + alcance)
--        └─ Profile (auth.users 1:1)
--    └─ Equipo (departamento dentro de la clínica, estructural)
--    └─ DisponibilidadProfesional (horario por profesional, vigencia)
--    └─ ServicioProfesional (M:N member ↔ servicio, override de precio)
--
-- Roles (orden jerárquico, mayor → menor):
--   OWNER       fundador, ve TODO
--   DIRECTOR    gerencial, ve admin+finanzas (y clínica si es_colegiado)
--   PROFESIONAL atiende, ve su agenda y sus pacientes
--   COORDINADOR gestiona agendas (sin ver clínica)
--   ASISTENTE   recepción
--
-- RLS habilitada Y `FORCE`d desde el INSERT — el FORCE garantiza que el
-- owner del schema tampoco puede saltarse las policies (defensa contra
-- bugs en server actions con service_role_key).
--
-- Compliance: encriptación columnar sobre Profile.nombre/apellido con
-- pgsodium. SECURITY LABEL declara la intención; Supabase TCE encripta
-- al INSERT y desencripta al SELECT transparentemente.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Enums ─────────────────────────────────────────────────────────────────

CREATE TYPE role AS ENUM (
  'OWNER',
  'DIRECTOR',
  'PROFESIONAL',
  'COORDINADOR',
  'ASISTENTE'
);

CREATE TYPE alcance AS ENUM (
  'TODOS',
  'EQUIPO',
  'LISTA_PROFESIONALES'
);

CREATE TYPE condicion_iva AS ENUM (
  'MONOTRIBUTO',
  'RESPONSABLE_INSCRIPTO',
  'EXENTO'
);

-- ─── Organization ──────────────────────────────────────────────────────────

CREATE TABLE organization (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                     text UNIQUE NOT NULL,                  -- /book/[slug]
  nombre                   text NOT NULL,
  rubro                    text,                                  -- 'quiropraxia', 'kinesiología', etc.
  ciudad                   text,
  provincia                text,
  timezone                 text NOT NULL DEFAULT 'America/Argentina/Cordoba',
  moneda                   text NOT NULL DEFAULT 'ARS',
  acento_hex               text NOT NULL DEFAULT '#8A6722',
  tema                     text NOT NULL DEFAULT 'light',

  -- AFIP / facturación AR
  cuit                     text,
  razon_social             text,
  condicion_iva            condicion_iva NOT NULL DEFAULT 'MONOTRIBUTO',
  punto_venta_afip         integer,
  certificado_arca_cifrado bytea,                                -- pgsodium

  -- Compliance toggles (Ley 25.326)
  opt_out_analytics        boolean NOT NULL DEFAULT false,
  opt_out_public_listing   boolean NOT NULL DEFAULT false,

  deleted_at               timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT organization_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,62}[a-z0-9]$'),
  CONSTRAINT organization_cuit_format CHECK (cuit IS NULL OR cuit ~ '^[0-9]{11}$')
);

CREATE INDEX organization_slug_idx ON organization (slug);
CREATE INDEX organization_cuit_idx ON organization (cuit) WHERE cuit IS NOT NULL;
CREATE INDEX organization_deleted_at_idx ON organization (deleted_at);
CREATE INDEX organization_rubro_idx ON organization (rubro);

SECURITY LABEL FOR pgsodium ON COLUMN organization.certificado_arca_cifrado
  IS 'ENCRYPT WITH KEY ID null SECURITY INVOKER';

COMMENT ON TABLE organization IS
  'Folio · tenant raíz. Modo Consultorio = 1 org con 1 PROFESIONAL. Modo Clínica = 1 org con N PROFESIONAL + DIRECTOR + COORDINADOR + ASISTENTE.';
COMMENT ON COLUMN organization.opt_out_analytics IS
  'Si true, esta org no aparece en analytics anonimizados (F8). Default false; toggle en /configuracion.';

-- ─── Profile (1:1 con auth.users de Supabase) ──────────────────────────────

CREATE TABLE profile (
  id                  uuid PRIMARY KEY,                          -- = auth.users.id
  email               text UNIQUE NOT NULL,
  nombre_cifrado      bytea NOT NULL,                            -- pgsodium
  apellido_cifrado    bytea NOT NULL,                            -- pgsodium
  matricula           text,
  avatar_url          text,
  two_factor_enabled  boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()

  -- FK a auth.users la pongo en M03 cuando exista o vía supabase post-bootstrap.
  -- En tests pgTAP usamos profiles standalone.
);

SECURITY LABEL FOR pgsodium ON COLUMN profile.nombre_cifrado
  IS 'ENCRYPT WITH KEY ID null SECURITY INVOKER';
SECURITY LABEL FOR pgsodium ON COLUMN profile.apellido_cifrado
  IS 'ENCRYPT WITH KEY ID null SECURITY INVOKER';

COMMENT ON TABLE profile IS
  'Folio · perfil de usuario · 1:1 con auth.users (Supabase Auth). nombre/apellido cifrados con pgsodium TCE.';

-- ─── Equipo (estructural, UI viene en F12) ─────────────────────────────────

CREATE TABLE equipo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  nombre          text NOT NULL,
  color           text,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT equipo_nombre_len CHECK (length(nombre) BETWEEN 1 AND 60)
);
CREATE INDEX equipo_organization_idx ON equipo (organization_id);

COMMENT ON TABLE equipo IS
  'Folio · departamento dentro de una clínica (ej. "Quiropraxia", "Kinesiología"). UI en F12.';

-- ─── Member ────────────────────────────────────────────────────────────────

CREATE TABLE member (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  profile_id                  uuid NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
  role                        role NOT NULL DEFAULT 'PROFESIONAL',

  -- Clinic-ready: alcance fino para COORDINADOR / ASISTENTE limitados
  alcance                     alcance NOT NULL DEFAULT 'TODOS',
  profesionales_gestionados   text[] NOT NULL DEFAULT '{}',     -- member_ids cuando alcance=LISTA_PROFESIONALES
  equipo_id                   uuid REFERENCES equipo(id) ON DELETE SET NULL,
  es_colegiado                boolean NOT NULL DEFAULT false,    -- PROFESIONAL ejerciente vs admin puro

  invited_by_id               uuid REFERENCES profile(id) ON DELETE SET NULL,
  accepted_at                 timestamptz,
  deleted_at                  timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT member_unique_per_org UNIQUE (organization_id, profile_id),
  CONSTRAINT member_alcance_lista_requires_list
    CHECK (alcance <> 'LISTA_PROFESIONALES' OR cardinality(profesionales_gestionados) > 0),
  CONSTRAINT member_equipo_in_same_org
    CHECK (equipo_id IS NULL)  -- la verificación cross-org se hace por trigger (más abajo)
);

CREATE INDEX member_org_role_idx ON member (organization_id, role);
CREATE INDEX member_profile_idx ON member (profile_id);
CREATE INDEX member_org_deleted_idx ON member (organization_id, deleted_at);
CREATE INDEX member_equipo_idx ON member (equipo_id) WHERE equipo_id IS NOT NULL;

COMMENT ON TABLE member IS
  'Folio · persona en una org · join entre profile y organization con role + alcance + es_colegiado.';
COMMENT ON COLUMN member.es_colegiado IS
  'Solo aplica a role=PROFESIONAL o DIRECTOR. Marca al usuario como ejerciente (ve PHI). DIRECTOR no colegiado solo ve admin/finanzas.';

-- Trigger que valida que equipo_id pertenezca a la misma org. No se puede
-- expresar con un CHECK porque referencia otra tabla.
CREATE OR REPLACE FUNCTION member_validate_equipo_same_org()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.equipo_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM equipo
      WHERE id = NEW.equipo_id AND organization_id = NEW.organization_id
    ) THEN
      RAISE EXCEPTION 'member.equipo_id must reference an equipo in the same organization';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER member_equipo_same_org_guard
  BEFORE INSERT OR UPDATE OF equipo_id, organization_id ON member
  FOR EACH ROW EXECUTE FUNCTION member_validate_equipo_same_org();

-- ─── DisponibilidadProfesional (horario por profesional, con vigencia) ────

CREATE TABLE disponibilidad_profesional (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  member_id       uuid NOT NULL REFERENCES member(id) ON DELETE CASCADE,
  dia_semana      smallint NOT NULL,                             -- 0=domingo, 6=sábado
  hora_inicio     text NOT NULL,                                 -- "HH:MM" 24h
  hora_fin        text NOT NULL,
  activa          boolean NOT NULL DEFAULT true,
  vigencia_desde  date NOT NULL DEFAULT CURRENT_DATE,
  vigencia_hasta  date,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT disp_dia_valid CHECK (dia_semana BETWEEN 0 AND 6),
  CONSTRAINT disp_hora_format CHECK (
    hora_inicio ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND hora_fin ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  ),
  CONSTRAINT disp_orden CHECK (hora_inicio < hora_fin),
  CONSTRAINT disp_vigencia CHECK (vigencia_hasta IS NULL OR vigencia_hasta >= vigencia_desde)
);

CREATE INDEX disp_org_member_dia_idx ON disponibilidad_profesional (organization_id, member_id, dia_semana);

COMMENT ON TABLE disponibilidad_profesional IS
  'Folio · horario por profesional. Versionado por vigencia para cambios futuros sin perder historial.';

-- ─── ServicioProfesional (M:N member ↔ servicio, override de precio) ──────
-- Tabla declarada acá por integridad de tenancy; la FK al servicio se agrega
-- en M09 cuando exista la tabla servicio.

CREATE TABLE servicio_profesional (
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  servicio_id     uuid NOT NULL,                                -- FK en M09
  member_id       uuid NOT NULL REFERENCES member(id) ON DELETE CASCADE,
  precio_custom   integer,                                      -- override del precio del Servicio (centavos)
  duracion_custom integer,                                      -- override de duración (minutos)
  activo          boolean NOT NULL DEFAULT true,
  PRIMARY KEY (servicio_id, member_id)
);

CREATE INDEX servprof_org_idx ON servicio_profesional (organization_id);

-- ════════════════════════════════════════════════════════════════════════════
-- RLS — habilitar Y forzar en cada tabla tenant-scoped
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE organization                ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization                FORCE ROW LEVEL SECURITY;
ALTER TABLE profile                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile                     FORCE ROW LEVEL SECURITY;
ALTER TABLE member                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE member                      FORCE ROW LEVEL SECURITY;
ALTER TABLE equipo                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipo                      FORCE ROW LEVEL SECURITY;
ALTER TABLE disponibilidad_profesional  ENABLE ROW LEVEL SECURITY;
ALTER TABLE disponibilidad_profesional  FORCE ROW LEVEL SECURITY;
ALTER TABLE servicio_profesional        ENABLE ROW LEVEL SECURITY;
ALTER TABLE servicio_profesional        FORCE ROW LEVEL SECURITY;

-- ─── Policies · Organization ──────────────────────────────────────────────
-- Solo los Members de la org pueden leer su organización. OWNER puede
-- actualizar metadata.

CREATE POLICY org_select_own
  ON organization FOR SELECT
  USING (id IN (SELECT public.user_org_ids()));

CREATE POLICY org_update_owner
  ON organization FOR UPDATE
  USING (id IN (SELECT public.user_org_ids()) AND public.user_role_in(id) = 'OWNER')
  WITH CHECK (id IN (SELECT public.user_org_ids()) AND public.user_role_in(id) = 'OWNER');

-- INSERT no se permite vía RLS: nuevas orgs nacen vía signup flow (F3) con
-- service_role_key bypassing RLS. DELETE tampoco — usamos soft delete.

-- ─── Policies · Profile ──────────────────────────────────────────────────
-- Cada usuario ve solo su propio profile. NO se ve perfiles de otros aunque
-- compartan org (los nombres se obtienen vía `member` join donde el blind
-- index del Member es suficiente para mostrar UI).

CREATE POLICY profile_select_self
  ON profile FOR SELECT
  USING (id = auth.uid());

CREATE POLICY profile_update_self
  ON profile FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ─── Policies · Member ──────────────────────────────────────────────────
-- Los members de una org pueden ver a otros members de la misma org. Eso
-- permite mostrar el sidebar con la lista de profesionales de la clínica.
-- Solo OWNER puede invitar (INSERT) o cambiar roles (UPDATE).

CREATE POLICY member_select_same_org
  ON member FOR SELECT
  USING (organization_id IN (SELECT public.user_org_ids()));

CREATE POLICY member_insert_owner
  ON member FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) = 'OWNER'
  );

CREATE POLICY member_update_owner
  ON member FOR UPDATE
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) = 'OWNER'
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) = 'OWNER'
  );

-- ─── Policies · Equipo + DisponibilidadProfesional + ServicioProfesional ─
-- Lectura abierta dentro de la org. Escritura limitada a OWNER + DIRECTOR.

CREATE POLICY equipo_select_org
  ON equipo FOR SELECT
  USING (organization_id IN (SELECT public.user_org_ids()));

CREATE POLICY equipo_write_director
  ON equipo FOR ALL
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR')
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR')
  );

CREATE POLICY disp_select_org
  ON disponibilidad_profesional FOR SELECT
  USING (organization_id IN (SELECT public.user_org_ids()));

CREATE POLICY disp_write_self_or_admin
  ON disponibilidad_profesional FOR ALL
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND (
      public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR')
      OR member_id = public.user_member_id_in(organization_id)
    )
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND (
      public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR')
      OR member_id = public.user_member_id_in(organization_id)
    )
  );

CREATE POLICY servprof_select_org
  ON servicio_profesional FOR SELECT
  USING (organization_id IN (SELECT public.user_org_ids()));

CREATE POLICY servprof_write_admin
  ON servicio_profesional FOR ALL
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR')
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR')
  );

-- ════════════════════════════════════════════════════════════════════════════
-- Trigger genérico de updated_at
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;

CREATE TRIGGER organization_set_updated_at
  BEFORE UPDATE ON organization
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER profile_set_updated_at
  BEFORE UPDATE ON profile
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER member_set_updated_at
  BEFORE UPDATE ON member
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
