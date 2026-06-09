-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M49 · Clinic mode — organization.tipo + member invitations
-- ════════════════════════════════════════════════════════════════════════════
-- Folio nació como producto de consultorio solo (1 org, 1 PROFESIONAL OWNER).
-- El modelo de datos multi-tenant (role, alcance, member, equipo,
-- disponibilidad_profesional por member) YA es clinic-ready desde M01/M02,
-- pero faltaban dos piezas para habilitar el "modo clínica" en producto:
--
--   1. Distinguir explícitamente una org INDEPENDIENTE (consultorio de un solo
--      profesional) de una CLINICA (Director + N médicos + secretaría). El
--      onboarding ramifica según esto y la UI decide qué selectores mostrar.
--
--   2. Un flujo de INVITACIÓN por email: el Director invita a médicos y
--      secretarias; cada invitado crea su cuenta y completa su propio perfil +
--      horario. Las columnas member.invited_by_id / accepted_at existían pero
--      no había forma de crear un member ANTES de que el invitado tuviera un
--      auth.users (profile es 1:1 con auth.users). De ahí esta tabla puente:
--      la invitación vive por (org, email, role) con un token; al aceptar
--      (ya autenticado vía el link del email) se materializa el member.
--
-- Append-only / portabilidad: esta migración solo agrega tipos, una columna
-- con DEFAULT (backfill implícito a INDEPENDIENTE para orgs existentes) y una
-- tabla nueva con sus policies. No referencia tablas creadas en migraciones
-- posteriores, así que no necesita `set check_function_bodies = off`.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Tipo de organización ────────────────────────────────────────────────

CREATE TYPE organizacion_tipo AS ENUM ('INDEPENDIENTE', 'CLINICA');

ALTER TABLE organization
  ADD COLUMN tipo organizacion_tipo NOT NULL DEFAULT 'INDEPENDIENTE';

COMMENT ON COLUMN organization.tipo IS
  'M49 · INDEPENDIENTE = consultorio de un solo profesional (OWNER). CLINICA = '
  'org con Director + N médicos + secretaría. Orgs previas backfill a '
  'INDEPENDIENTE. El onboarding ramifica según este valor.';

-- ─── 2. Estado de invitación ────────────────────────────────────────────────

CREATE TYPE invitacion_estado AS ENUM (
  'PENDIENTE',
  'ACEPTADA',
  'REVOCADA',
  'EXPIRADA'
);

-- ─── 3. Tabla member_invitation ─────────────────────────────────────────────
-- Una invitación pendiente por (org, email). El token crudo viaja en el link
-- del email; en la DB solo guardamos `token_hash` = sha256 hex del token
-- (calculado por la app con node:crypto, replicado por accept_member_invitation
-- con pgcrypto digest()). Nunca se persiste ni se expone el token crudo.

CREATE TABLE member_invitation (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  email                     text NOT NULL,
  role                      role NOT NULL DEFAULT 'PROFESIONAL',
  es_colegiado              boolean NOT NULL DEFAULT false,
  alcance                   alcance NOT NULL DEFAULT 'TODOS',
  profesionales_gestionados text[] NOT NULL DEFAULT '{}',
  equipo_id                 uuid REFERENCES equipo(id) ON DELETE SET NULL,

  token_hash                text NOT NULL,                         -- sha256 hex del token crudo
  estado                    invitacion_estado NOT NULL DEFAULT 'PENDIENTE',

  invited_by_member_id      uuid REFERENCES member(id) ON DELETE SET NULL,
  expires_at                timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at               timestamptz,
  accepted_by_profile_id    uuid REFERENCES profile(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT member_invitation_email_format
    CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT member_invitation_alcance_lista_requires_list
    CHECK (alcance <> 'LISTA_PROFESIONALES' OR cardinality(profesionales_gestionados) > 0)
);

-- token_hash es la clave de lookup del accept → único.
CREATE UNIQUE INDEX member_invitation_token_hash_idx
  ON member_invitation (token_hash);

-- Solo una invitación PENDIENTE por (org, email) a la vez. Reinvitar revoca o
-- reusa la previa (lógica en lib/db/members.ts).
CREATE UNIQUE INDEX member_invitation_pending_unique
  ON member_invitation (organization_id, lower(email))
  WHERE estado = 'PENDIENTE';

CREATE INDEX member_invitation_org_idx   ON member_invitation (organization_id);
CREATE INDEX member_invitation_email_idx ON member_invitation (lower(email));

COMMENT ON TABLE member_invitation IS
  'M49 · invitación de equipo por email. Materializa un member al aceptar '
  '(accept_member_invitation). token_hash = sha256 hex; el token crudo solo '
  'vive en el link del email.';

ALTER TABLE member_invitation ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_invitation FORCE ROW LEVEL SECURITY;

CREATE TRIGGER member_invitation_set_updated_at
  BEFORE UPDATE ON member_invitation
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 4. Policies ────────────────────────────────────────────────────────────
-- Solo OWNER/DIRECTOR de la org gestionan invitaciones. El INVITADO todavía no
-- es member de la org, así que NO ve la fila vía RLS: acepta vía la RPC
-- SECURITY DEFINER `accept_member_invitation`, que valida el token y el email.

CREATE POLICY member_invitation_select_admin
  ON member_invitation FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR')
  );

CREATE POLICY member_invitation_insert_admin
  ON member_invitation FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR')
    AND invited_by_member_id = public.user_member_id_in(organization_id)
  );

CREATE POLICY member_invitation_update_admin
  ON member_invitation FOR UPDATE
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR')
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR')
  );

-- ─── 5. RPC: preview de invitación (para la página de aceptación) ───────────
-- Devuelve datos NO sensibles de una invitación pendiente para mostrar
-- "Te invitaron a {clínica} como {rol}". No materializa nada. Callable por
-- authenticated (el invitado ya inició sesión vía el link del email).

CREATE OR REPLACE FUNCTION public.get_invitation_preview(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_inv  member_invitation%ROWTYPE;
  v_org  organization%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RETURN NULL;
  END IF;

  v_hash := encode(digest(p_token, 'sha256'), 'hex');

  SELECT * INTO v_inv FROM member_invitation WHERE token_hash = v_hash;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_org FROM organization WHERE id = v_inv.organization_id;

  RETURN jsonb_build_object(
    'organization_id',   v_inv.organization_id,
    'organization_name', v_org.nombre,
    'email',             v_inv.email,
    'role',              v_inv.role,
    'es_colegiado',      v_inv.es_colegiado,
    'estado',            v_inv.estado,
    'expired',           (v_inv.expires_at < now())
  );
END
$$;

-- ─── 6. RPC: aceptar invitación (materializa profile + member) ──────────────
-- Atómica e idempotente. Valida que el email de la sesión coincide con el de
-- la invitación, crea el profile mínimo si falta y el member con role/alcance
-- de la invitación, marca la invitación ACEPTADA. Mirror de bootstrap_org_atomic.

CREATE OR REPLACE FUNCTION public.accept_member_invitation(
  p_token                       text,
  p_consent_ip                  text DEFAULT NULL,
  p_consent_user_agent          text DEFAULT NULL,
  p_consent_legal_text_version  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_email     text;
  v_hash      text;
  v_inv       member_invitation%ROWTYPE;
  v_member_id uuid;
  v_inviter   uuid;
  v_now       timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'accept_member_invitation: requiere sesión autenticada';
  END IF;
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RAISE EXCEPTION 'accept_member_invitation: token vacío';
  END IF;

  v_hash := encode(digest(p_token, 'sha256'), 'hex');

  -- Lock para evitar doble aceptación concurrente.
  SELECT * INTO v_inv FROM member_invitation WHERE token_hash = v_hash FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'accept_member_invitation: invitación no encontrada'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Email de la sesión debe coincidir con el invitado.
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  IF v_email IS NULL OR lower(v_email) <> lower(v_inv.email) THEN
    RAISE EXCEPTION 'accept_member_invitation: el email de la sesión no coincide con la invitación';
  END IF;

  -- Idempotencia: ya aceptada por este usuario → devolver su membership.
  IF v_inv.estado = 'ACEPTADA' AND v_inv.accepted_by_profile_id = v_uid THEN
    SELECT id INTO v_member_id
      FROM member
      WHERE organization_id = v_inv.organization_id
        AND profile_id = v_uid
        AND deleted_at IS NULL;
    RETURN jsonb_build_object(
      'organization_id', v_inv.organization_id,
      'member_id',       v_member_id,
      'role',            v_inv.role,
      'created',         false
    );
  END IF;

  IF v_inv.estado <> 'PENDIENTE' THEN
    RAISE EXCEPTION 'accept_member_invitation: la invitación no está pendiente (estado %)', v_inv.estado;
  END IF;

  -- Expiry: levantar excepción (la transacción hace rollback completo, así que
  -- NO intentamos marcar EXPIRADA acá — ese UPDATE se perdería en el rollback).
  -- El estado EXPIRADA lo materializa el listado/barrido en lib/db/members.ts
  -- comparando expires_at < now().
  IF v_inv.expires_at < v_now THEN
    RAISE EXCEPTION 'accept_member_invitation: la invitación expiró';
  END IF;

  -- Profile mínimo (nombre/apellido se completan en el self-setup del invitado;
  -- M26 hizo nullable nombre_cifrado/apellido_cifrado). El invitado es un
  -- profesional cuya PII procesa Folio → debe firmar consentimiento al aceptar
  -- (Ley 25.326 art. 14; el CHECK profile_consent_signed_required lo exige).
  -- Si el profile ya existía (usuario de Folio invitado a otra org) NO se
  -- re-firma: ya consintió en su signup original (ON CONFLICT DO NOTHING).
  INSERT INTO profile (
    id, email, nombre_cifrado, apellido_cifrado,
    consent_pii_signed_at, consent_pii_text_version, consent_pii_ip, consent_pii_user_agent
  )
  VALUES (
    v_uid, v_email, NULL, NULL,
    v_now,
    COALESCE(p_consent_legal_text_version, 'invitation-accept'),
    NULLIF(p_consent_ip, '')::inet,
    p_consent_user_agent
  )
  ON CONFLICT (id) DO NOTHING;

  -- invited_by_id de member referencia profile(id); traducimos el member id.
  SELECT profile_id INTO v_inviter
    FROM member WHERE id = v_inv.invited_by_member_id;

  -- Member: crea o revive (si fue dado de baja) con el rol/alcance de la invitación.
  INSERT INTO member (
    organization_id, profile_id, role, es_colegiado, alcance,
    profesionales_gestionados, equipo_id, invited_by_id, accepted_at
  )
  VALUES (
    v_inv.organization_id, v_uid, v_inv.role, v_inv.es_colegiado, v_inv.alcance,
    v_inv.profesionales_gestionados, v_inv.equipo_id, v_inviter, v_now
  )
  ON CONFLICT (organization_id, profile_id) DO UPDATE SET
    role                      = EXCLUDED.role,
    es_colegiado              = EXCLUDED.es_colegiado,
    alcance                   = EXCLUDED.alcance,
    profesionales_gestionados = EXCLUDED.profesionales_gestionados,
    equipo_id                 = EXCLUDED.equipo_id,
    deleted_at                = NULL,
    accepted_at               = COALESCE(member.accepted_at, v_now),
    updated_at                = v_now
  RETURNING id INTO v_member_id;

  UPDATE member_invitation
     SET estado = 'ACEPTADA',
         accepted_at = v_now,
         accepted_by_profile_id = v_uid,
         updated_at = v_now
   WHERE id = v_inv.id;

  RETURN jsonb_build_object(
    'organization_id', v_inv.organization_id,
    'member_id',       v_member_id,
    'role',            v_inv.role,
    'created',         true
  );
END
$$;

-- ─── 7. Grants (matriz de mínimo privilegio, ver M45) ───────────────────────
-- Ambas RPC las invoca el usuario autenticado (el invitado), no service_role.

REVOKE ALL ON FUNCTION public.get_invitation_preview(text)                   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_member_invitation(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invitation_preview(text)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_member_invitation(text, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.accept_member_invitation IS
  'M49 · materializa profile+member desde una invitación pendiente para '
  'auth.uid(). Idempotente; valida email de sesión vs invitación. authenticated only.';
COMMENT ON FUNCTION public.get_invitation_preview IS
  'M49 · datos no sensibles de una invitación por token (org, rol, estado) '
  'para la pantalla de aceptación. authenticated only.';
