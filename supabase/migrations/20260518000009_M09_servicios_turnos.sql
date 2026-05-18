-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M09 · Operación (Servicios + Turnos + State Machine + Pagos + Pedidos)
-- ════════════════════════════════════════════════════════════════════════════
-- El corazón funcional de Folio. Tablas:
--
--   - Servicio        · catálogo de servicios del consultorio (Consulta inicial,
--                       Seguimiento, Pack 5 sesiones, etc.). tipo_canonico es
--                       crítico para analytics (M15) — categoría cross-org.
--   - Turno           · cita agendada. State machine: agendado → confirmado →
--                       en_sala → atendiendo → cerrado. Estados paralelos:
--                       no_asistio, cancelado, reagendado.
--   - Transicion      · log de cada cambio de estado (audit + analytics).
--   - Pago            · una fila por turno. método + estado + monto + ARCA AFIP
--                       fields (factura) + clinic-ready: splits de comisión.
--   - PostVisita      · memo opcional post-turno (WhatsApp / email / nada).
--   - Pedido          · booking entrante (web, WhatsApp, Instagram, teléfono).
--                       Puede convertirse en Turno con confirmación.
--   - Bloqueo         · evento personal (Google Calendar sync) que ocupa slot.
--
-- State machine se materializa como CHECK CONSTRAINT + trigger validador.
-- Las transiciones inválidas RAISE EXCEPTION (no se commitea la tx).
--
-- RLS de Turno tiene clinic-scoping fino: PROFESIONAL ve sus propios turnos,
-- DIRECTOR/OWNER ven todo, ASISTENTE/COORDINADOR según `alcance`.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Enums ─────────────────────────────────────────────────────────────────

CREATE TYPE tipo_servicio_canonico AS ENUM (
  'CONSULTA_INICIAL',
  'SEGUIMIENTO_ESTANDAR',
  'SEGUIMIENTO_EXTENDIDO',
  'PACK_SESIONES',
  'SERVICIO_ESPECIALIZADO'
);

CREATE TYPE estado_turno AS ENUM (
  'AGENDADO',
  'CONFIRMADO',
  'EN_SALA',
  'ATENDIENDO',
  'CERRADO',
  'NO_ASISTIO',
  'CANCELADO',
  'REAGENDADO'
);

CREATE TYPE origen_turno AS ENUM (
  'MANUAL',
  'BOOKING',
  'WALK_IN',
  'GOOGLE',
  'WHATSAPP'
);

CREATE TYPE metodo_pago AS ENUM (
  'EFECTIVO',
  'TRANSFERENCIA',
  'MERCADOPAGO',
  'TARJETA',
  'OBRA_SOCIAL',
  'OTRO'
);

CREATE TYPE estado_pago AS ENUM ('PENDIENTE', 'PAGADO', 'PARCIAL');

CREATE TYPE canal_pedido AS ENUM ('WEB', 'WHATSAPP', 'INSTAGRAM', 'TELEFONO');

CREATE TYPE estado_pedido AS ENUM (
  'PENDIENTE',
  'CONFIRMADO',
  'REAGENDADO',
  'RECHAZADO'
);

CREATE TYPE canal_post_visita AS ENUM ('WHATSAPP', 'EMAIL', 'SMS');

-- ─── Servicio ──────────────────────────────────────────────────────────────

CREATE TABLE servicio (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  nombre              text NOT NULL,
  tipo_canonico       tipo_servicio_canonico NOT NULL,          -- crítico para analytics
  duracion_min        smallint NOT NULL,
  precio_cents        integer NOT NULL,                         -- ARS centavos
  color               text,                                     -- hex opcional para badge
  para_nuevos         boolean NOT NULL DEFAULT false,
  es_paquete          boolean NOT NULL DEFAULT false,
  sesiones_paquete    smallint,
  activo              boolean NOT NULL DEFAULT true,
  deleted_at          timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT servicio_duracion_valid CHECK (duracion_min BETWEEN 5 AND 480),
  CONSTRAINT servicio_precio_positivo CHECK (precio_cents >= 0),
  CONSTRAINT servicio_paquete_consistency
    CHECK (es_paquete = false OR sesiones_paquete > 0)
);

CREATE INDEX servicio_org_activo_idx ON servicio (organization_id, activo) WHERE deleted_at IS NULL;
CREATE INDEX servicio_org_canonico_idx ON servicio (organization_id, tipo_canonico);

CREATE TRIGGER servicio_set_updated_at
  BEFORE UPDATE ON servicio FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Ahora que existe servicio, agregamos la FK que dejamos pendiente en M02.
ALTER TABLE servicio_profesional
  ADD CONSTRAINT servicio_profesional_servicio_fk
  FOREIGN KEY (servicio_id) REFERENCES servicio(id) ON DELETE CASCADE;

COMMENT ON TABLE servicio IS
  'Folio · catálogo de servicios del consultorio. tipo_canonico es la categoría cross-org para analytics (CONSULTA_INICIAL agrupa todos los nombres comerciales similares).';

-- ─── Turno ─────────────────────────────────────────────────────────────────

CREATE TABLE turno (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  paciente_id              uuid NOT NULL REFERENCES paciente(id) ON DELETE RESTRICT,
  servicio_id              uuid NOT NULL REFERENCES servicio(id) ON DELETE RESTRICT,
  profesional_id           uuid NOT NULL REFERENCES member(id) ON DELETE RESTRICT,

  inicio                   timestamptz NOT NULL,
  duracion_min             smallint NOT NULL,
  estado                   estado_turno NOT NULL DEFAULT 'AGENDADO',
  origen                   origen_turno NOT NULL DEFAULT 'MANUAL',
  precio_cents             integer NOT NULL,                    -- snapshot del precio al agendar

  -- Integraciones
  gcal_event_id            text,                                -- Google Calendar event id (F5)

  -- Sesión activa (cuando estado='ATENDIENDO')
  atendiendo_desde         timestamptz,
  duracion_real_min        smallint,                            -- al cerrar

  deleted_at               timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT turno_duracion_valid CHECK (duracion_min BETWEEN 5 AND 480),
  CONSTRAINT turno_precio_no_negativo CHECK (precio_cents >= 0),
  CONSTRAINT turno_atendiendo_consistency
    CHECK ((estado = 'ATENDIENDO') = (atendiendo_desde IS NOT NULL)),
  CONSTRAINT turno_duracion_real_solo_cerrado
    CHECK (duracion_real_min IS NULL OR estado IN ('CERRADO', 'NO_ASISTIO'))
);

CREATE INDEX turno_org_inicio_idx ON turno (organization_id, inicio);
CREATE INDEX turno_profesional_inicio_idx ON turno (profesional_id, inicio);
CREATE INDEX turno_paciente_idx ON turno (paciente_id, inicio DESC);
CREATE INDEX turno_estado_inicio_idx ON turno (organization_id, estado, inicio);
CREATE INDEX turno_gcal_idx ON turno (gcal_event_id) WHERE gcal_event_id IS NOT NULL;

CREATE TRIGGER turno_set_updated_at
  BEFORE UPDATE ON turno FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Validar que paciente, servicio y profesional pertenezcan a la misma org.
CREATE OR REPLACE FUNCTION turno_validate_same_org()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM paciente WHERE id = NEW.paciente_id AND organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'turno.paciente_id must be in the same organization';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM servicio WHERE id = NEW.servicio_id AND organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'turno.servicio_id must be in the same organization';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM member WHERE id = NEW.profesional_id AND organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'turno.profesional_id must be a member of the same organization';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER turno_same_org_guard
  BEFORE INSERT OR UPDATE OF paciente_id, servicio_id, profesional_id, organization_id ON turno
  FOR EACH ROW EXECUTE FUNCTION turno_validate_same_org();

COMMENT ON TABLE turno IS
  'Folio · turno (cita) · state machine: AGENDADO→CONFIRMADO→EN_SALA→ATENDIENDO→CERRADO. Paralelos terminales: NO_ASISTIO, CANCELADO, REAGENDADO.';

-- ─── Transicion (state machine log) ───────────────────────────────────────

CREATE TABLE transicion (
  id              bigserial PRIMARY KEY,
  turno_id        uuid NOT NULL REFERENCES turno(id) ON DELETE CASCADE,
  from_estado     estado_turno,                                 -- NULL si es el INSERT inicial
  to_estado       estado_turno NOT NULL,
  ts              timestamptz NOT NULL DEFAULT now(),
  actor_id        uuid REFERENCES member(id) ON DELETE SET NULL,
  trigger_origin  text NOT NULL DEFAULT 'manual',               -- 'manual' | 'auto' | 'webhook' | 'walk_in'

  CONSTRAINT transicion_trigger_origin_valid
    CHECK (trigger_origin IN ('manual', 'auto', 'webhook', 'walk_in', 'system'))
);

CREATE INDEX transicion_turno_idx ON transicion (turno_id, ts);
CREATE INDEX transicion_actor_idx ON transicion (actor_id, ts DESC) WHERE actor_id IS NOT NULL;

COMMENT ON TABLE transicion IS
  'Folio · log de cambios de estado de un turno. Append-only (no UPDATE ni DELETE). Cada INSERT/UPDATE de turno.estado dispara una fila aquí (trigger en M12).';

-- Trigger genera transición automáticamente al INSERT/UPDATE de turno.estado.
CREATE OR REPLACE FUNCTION turno_record_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  prev_estado estado_turno;
BEGIN
  IF TG_OP = 'INSERT' THEN
    prev_estado := NULL;
  ELSE
    prev_estado := OLD.estado;
    IF prev_estado = NEW.estado THEN
      RETURN NEW;                                    -- sin cambio, no transición
    END IF;
    -- Validar transición permitida
    IF NOT (
      (prev_estado = 'AGENDADO'   AND NEW.estado IN ('CONFIRMADO', 'CANCELADO', 'REAGENDADO', 'NO_ASISTIO'))
      OR (prev_estado = 'CONFIRMADO' AND NEW.estado IN ('EN_SALA', 'NO_ASISTIO', 'CANCELADO', 'REAGENDADO'))
      OR (prev_estado = 'EN_SALA'    AND NEW.estado IN ('ATENDIENDO', 'CANCELADO'))
      OR (prev_estado = 'ATENDIENDO' AND NEW.estado = 'CERRADO')
      OR (prev_estado = 'NO_ASISTIO' AND NEW.estado = 'REAGENDADO')
    ) THEN
      RAISE EXCEPTION 'Invalid turno transition: % → %', prev_estado, NEW.estado;
    END IF;
  END IF;
  INSERT INTO transicion (turno_id, from_estado, to_estado, ts, actor_id, trigger_origin)
  VALUES (NEW.id, prev_estado, NEW.estado, now(),
          public.user_member_id_in(NEW.organization_id),
          coalesce(current_setting('folio.transition_origin', true), 'manual'));
  RETURN NEW;
END
$$;

CREATE TRIGGER turno_transition_log
  AFTER INSERT OR UPDATE OF estado ON turno
  FOR EACH ROW EXECUTE FUNCTION turno_record_transition();

-- ─── Pago ──────────────────────────────────────────────────────────────────

CREATE TABLE pago (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  turno_id                        uuid NOT NULL UNIQUE REFERENCES turno(id) ON DELETE CASCADE,
  monto_cents                     integer NOT NULL,
  metodo                          metodo_pago NOT NULL,
  estado                          estado_pago NOT NULL DEFAULT 'PENDIENTE',
  pagado_ts                       timestamptz,
  notas                           text,

  -- AFIP / ARCA (factura electrónica)
  factura_afip_numero             text,                         -- CAE / número de comprobante
  factura_afip_pdf_path           text,                         -- Supabase Storage

  -- Clinic-ready: split de comisión profesional/clínica (UI en F12)
  comision_clinica_cents          integer,
  liquidado_profesional_cents     integer,
  liquidado_en                    timestamptz,
  liquidacion_id                  uuid,                         -- FK futura a tabla Liquidacion (F12)

  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pago_monto_positivo CHECK (monto_cents >= 0),
  CONSTRAINT pago_consistency
    CHECK ((estado = 'PAGADO') = (pagado_ts IS NOT NULL)),
  CONSTRAINT pago_comision_no_negativa
    CHECK (comision_clinica_cents IS NULL OR comision_clinica_cents >= 0),
  CONSTRAINT pago_liquidacion_consistency
    CHECK ((liquidado_en IS NULL) = (liquidado_profesional_cents IS NULL))
);

CREATE INDEX pago_estado_idx ON pago (estado, pagado_ts);
CREATE INDEX pago_liquidado_idx ON pago (liquidado_en) WHERE liquidado_en IS NOT NULL;

CREATE TRIGGER pago_set_updated_at
  BEFORE UPDATE ON pago FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE pago IS
  'Folio · pago de un turno · 1:1 con turno. Pre-pago implícito: el turno en agenda ya está cobrado (estado=PAGADO). Cierre del turno suma a recaudación. Clinic-ready: comisión y liquidación profesional/clínica.';

-- ─── PostVisita ────────────────────────────────────────────────────────────

CREATE TABLE post_visita (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  turno_id             uuid NOT NULL UNIQUE REFERENCES turno(id) ON DELETE CASCADE,
  memo_cifrado         bytea NOT NULL,                         -- AES-256-GCM app-side
  enviada_canal        canal_post_visita,
  enviada_ts           timestamptz,
  programada_ts        timestamptz,                            -- envío diferido (F9 cron)

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT post_visita_envio_consistency
    CHECK ((enviada_canal IS NULL) = (enviada_ts IS NULL))
);

CREATE INDEX post_visita_pendiente_idx
  ON post_visita (programada_ts)
  WHERE enviada_ts IS NULL AND programada_ts IS NOT NULL;

CREATE TRIGGER post_visita_set_updated_at
  BEFORE UPDATE ON post_visita FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE post_visita IS
  'Folio · memo post-turno enviado al paciente (WhatsApp/email/SMS). Encriptado app-side. programada_ts permite envío diferido (default: +2h después del cierre — F9).';

-- ─── Pedido (booking entrante multi-canal) ────────────────────────────────

CREATE TABLE pedido (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  canal               canal_pedido NOT NULL,
  estado              estado_pedido NOT NULL DEFAULT 'PENDIENTE',

  -- Datos del solicitante (cifrados — puede no ser paciente registrado todavía)
  nombre_cifrado      bytea NOT NULL,
  telefono_cifrado    bytea,
  email_cifrado       bytea,
  paciente_id         uuid REFERENCES paciente(id) ON DELETE SET NULL,  -- si ya existe

  -- Slot solicitado
  fecha_propuesta     timestamptz,
  duracion_min        smallint NOT NULL,
  servicio_id         uuid REFERENCES servicio(id) ON DELETE SET NULL,
  motivo_cifrado      bytea,
  precio_cents        integer,

  -- Tracking
  recibido_ts         timestamptz NOT NULL DEFAULT now(),
  confirmado_ts       timestamptz,
  rechazado_motivo    text,
  contra_propuesta    jsonb,                                     -- {fecha, hora} si el consultorio sugiere otro slot

  CONSTRAINT pedido_estado_consistency
    CHECK (
      (estado <> 'CONFIRMADO' OR confirmado_ts IS NOT NULL)
      AND (estado <> 'RECHAZADO' OR rechazado_motivo IS NOT NULL)
    ),
  CONSTRAINT pedido_duracion_valid CHECK (duracion_min BETWEEN 5 AND 480)
);

CREATE INDEX pedido_org_estado_idx ON pedido (organization_id, estado, recibido_ts DESC);
CREATE INDEX pedido_paciente_idx ON pedido (paciente_id) WHERE paciente_id IS NOT NULL;
CREATE INDEX pedido_pendiente_idx ON pedido (organization_id, recibido_ts DESC)
  WHERE estado = 'PENDIENTE';

COMMENT ON TABLE pedido IS
  'Folio · booking entrante. canal indica origen (WEB del link público, WHATSAPP/INSTAGRAM scrapeo, TELEFONO ingresado manual). Se convierte a Turno al confirmar.';

-- ─── Bloqueo (Google Calendar sync) ───────────────────────────────────────

CREATE TABLE bloqueo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  profesional_id  uuid NOT NULL REFERENCES member(id) ON DELETE CASCADE,
  inicio          timestamptz NOT NULL,
  duracion_min    smallint NOT NULL,
  titulo          text,
  origen          text NOT NULL DEFAULT 'google',               -- 'google' | 'manual'
  gcal_event_id   text,

  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bloqueo_duracion_valid CHECK (duracion_min BETWEEN 5 AND 1440),
  CONSTRAINT bloqueo_origen_valid CHECK (origen IN ('google', 'manual'))
);

CREATE INDEX bloqueo_org_inicio_idx ON bloqueo (organization_id, inicio);
CREATE INDEX bloqueo_profesional_idx ON bloqueo (profesional_id, inicio);
CREATE INDEX bloqueo_gcal_idx ON bloqueo (gcal_event_id) WHERE gcal_event_id IS NOT NULL;

COMMENT ON TABLE bloqueo IS
  'Folio · evento personal del profesional (de Google Calendar o manual). Ocupa slot, no es turno. Sin paciente asociado.';

-- ════════════════════════════════════════════════════════════════════════════
-- RLS
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE servicio       ENABLE ROW LEVEL SECURITY;
ALTER TABLE servicio       FORCE  ROW LEVEL SECURITY;
ALTER TABLE turno          ENABLE ROW LEVEL SECURITY;
ALTER TABLE turno          FORCE  ROW LEVEL SECURITY;
ALTER TABLE transicion     ENABLE ROW LEVEL SECURITY;
ALTER TABLE transicion     FORCE  ROW LEVEL SECURITY;
ALTER TABLE pago           ENABLE ROW LEVEL SECURITY;
ALTER TABLE pago           FORCE  ROW LEVEL SECURITY;
ALTER TABLE post_visita    ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_visita    FORCE  ROW LEVEL SECURITY;
ALTER TABLE pedido         ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedido         FORCE  ROW LEVEL SECURITY;
ALTER TABLE bloqueo        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bloqueo        FORCE  ROW LEVEL SECURITY;

-- ─── Servicio ──────────────────────────────────────────────────────────────
CREATE POLICY servicio_select_org
  ON servicio FOR SELECT
  USING (organization_id IN (SELECT public.user_org_ids()));

CREATE POLICY servicio_write_admin
  ON servicio FOR ALL
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR')
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR')
  );

-- ─── Turno: clinic-scoped fine-grained ────────────────────────────────────
-- OWNER y DIRECTOR ven todos los turnos.
-- PROFESIONAL ve sus propios turnos (profesional_id = mi member_id).
-- COORDINADOR/ASISTENTE ven los turnos según `alcance` del member.

CREATE POLICY turno_select_clinic_scoped
  ON turno FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND (
      public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR')
      OR profesional_id = public.user_member_id_in(organization_id)
      OR public.user_has_scope_over(organization_id, profesional_id)
    )
  );

CREATE POLICY turno_insert_admin
  ON turno FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR', 'PROFESIONAL', 'COORDINADOR', 'ASISTENTE')
  );

CREATE POLICY turno_update_scoped
  ON turno FOR UPDATE
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND (
      public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR')
      OR profesional_id = public.user_member_id_in(organization_id)
      OR public.user_has_scope_over(organization_id, profesional_id)
    )
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
  );

CREATE POLICY turno_no_delete ON turno FOR DELETE USING (false);

-- ─── Transicion: read si puede ver el turno ───────────────────────────────
CREATE POLICY transicion_select_scoped
  ON transicion FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM turno t WHERE t.id = transicion.turno_id)
  );
-- INSERT solo via trigger (con SECURITY DEFINER bypassea RLS automáticamente).
CREATE POLICY transicion_no_direct_insert ON transicion FOR INSERT WITH CHECK (false);
CREATE POLICY transicion_no_update ON transicion FOR UPDATE USING (false);
CREATE POLICY transicion_no_delete ON transicion FOR DELETE USING (false);

-- ─── Pago ──────────────────────────────────────────────────────────────────
CREATE POLICY pago_select_admin
  ON pago FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM turno t
      WHERE t.id = pago.turno_id
        -- la policy de turno ya filtra por scope
    )
  );

CREATE POLICY pago_write_admin
  ON pago FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM turno t
      WHERE t.id = pago.turno_id
        AND public.user_role_in(t.organization_id) IN ('OWNER', 'DIRECTOR', 'PROFESIONAL', 'ASISTENTE')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM turno t
      WHERE t.id = pago.turno_id
        AND public.user_role_in(t.organization_id) IN ('OWNER', 'DIRECTOR', 'PROFESIONAL', 'ASISTENTE')
    )
  );

-- ─── PostVisita: clínica (memo puede tener PHI) ──────────────────────────
CREATE POLICY post_visita_select_clinical
  ON post_visita FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM turno t
      WHERE t.id = post_visita.turno_id
        AND public.can_read_clinical(t.organization_id)
    )
  );

CREATE POLICY post_visita_write_clinical
  ON post_visita FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM turno t
      WHERE t.id = post_visita.turno_id
        AND public.can_read_clinical(t.organization_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM turno t
      WHERE t.id = post_visita.turno_id
        AND public.can_read_clinical(t.organization_id)
    )
  );

-- ─── Pedido: admin de la org ──────────────────────────────────────────────
CREATE POLICY pedido_select_admin
  ON pedido FOR SELECT
  USING (organization_id IN (SELECT public.user_org_ids()));

CREATE POLICY pedido_write_admin
  ON pedido FOR ALL
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR', 'PROFESIONAL', 'COORDINADOR', 'ASISTENTE')
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
  );

-- ─── Bloqueo: admin de la org ─────────────────────────────────────────────
CREATE POLICY bloqueo_select_org
  ON bloqueo FOR SELECT
  USING (organization_id IN (SELECT public.user_org_ids()));

CREATE POLICY bloqueo_write_admin
  ON bloqueo FOR ALL
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND (
      public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR')
      OR profesional_id = public.user_member_id_in(organization_id)
    )
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
  );

-- ─── Sesion FK pending (M10 creará la tabla sesion) ───────────────────────
-- documento_clinico.sesion_id queda sin FK hasta M10. Lo agregamos allá.
