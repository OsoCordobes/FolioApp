-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M14 · Vistas convenientes (lectura optimizada)
-- ════════════════════════════════════════════════════════════════════════════
-- Vistas que joins comunes para queries de la app, respetando RLS de las
-- tablas base. Las vistas heredan los policies de las tablas referenciadas
-- (security_invoker=true).
--
--   - paciente_completo        · JOIN PII + PHI. Usado por la ficha del
--                                paciente cuando el usuario tiene
--                                can_read_clinical.
--   - paciente_directorio_lite · solo PII + último turno + próximo turno.
--                                Usado por la lista /pacientes — accesible
--                                a ASISTENTE (PII).
--   - turno_extendido          · JOIN turno + paciente + servicio + pago.
--                                Para la grilla del calendario y dashboard.
--   - sesion_con_enmiendas     · sesion + array de enmiendas. Para audit y
--                                vista cronológica de la HC.
--
-- security_invoker=true: la vista respeta la RLS del usuario que la consulta
-- (no la del owner de la vista). Esto es lo que queremos: ASISTENTE consulta
-- paciente_directorio_lite y solo ve PII (Paciente está oculto por RLS
-- pero las columnas en la vista son de PacienteIdentidad → permitidas).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── paciente_directorio_lite ─────────────────────────────────────────────
-- Vista para /pacientes (directorio). Combina PII de paciente_identidad +
-- últimos turnos (sin tocar PHI). Accesible a todos los roles.

CREATE OR REPLACE VIEW paciente_directorio_lite
WITH (security_invoker = true)
AS
SELECT
  p.id                    AS paciente_id,
  p.organization_id,
  p.tipo                  AS tipo_paciente,
  p.tags,
  p.deleted_at,
  p.pseudonimizado_en,
  p.profesional_principal_id,
  pi.id                   AS identidad_id,
  pi.fecha_nacimiento,
  pi.sexo_biologico,
  pi.domicilio_ciudad,
  pi.domicilio_provincia,
  pi.nombre_hash,
  pi.dni_hash,
  -- Cifrados (la app desencripta del client)
  pi.nombre_cifrado,
  pi.apellido_cifrado,
  pi.telefono_cifrado,
  pi.email_cifrado,
  -- Último turno
  (SELECT max(t.inicio) FROM turno t
    WHERE t.paciente_id = p.id
      AND t.estado IN ('CERRADO', 'NO_ASISTIO'))            AS ultima_visita,
  -- Próximo turno
  (SELECT min(t.inicio) FROM turno t
    WHERE t.paciente_id = p.id
      AND t.estado IN ('AGENDADO', 'CONFIRMADO', 'EN_SALA')
      AND t.inicio > now())                                 AS proximo_turno,
  -- Total sesiones cerradas
  (SELECT count(*) FROM turno t
    WHERE t.paciente_id = p.id AND t.estado = 'CERRADO')   AS sesiones_completadas,
  p.created_at,
  p.updated_at
FROM paciente p
LEFT JOIN paciente_identidad pi ON pi.id = p.identidad_id;

COMMENT ON VIEW paciente_directorio_lite IS
  'Folio · vista para /pacientes. Combina PII y agregados de turnos sin tocar PHI. Accesible a todos los roles (RLS heredada de paciente_identidad).';

-- ─── paciente_completo ────────────────────────────────────────────────────
-- Vista para la ficha del paciente (PROFESIONAL+). Combina PII + PHI.
-- Accesible solo si can_read_clinical (RLS de paciente filtra).

CREATE OR REPLACE VIEW paciente_completo
WITH (security_invoker = true)
AS
SELECT
  p.id,
  p.organization_id,
  p.identidad_id,
  p.tipo                              AS tipo_paciente,
  p.tags,
  p.motivo_consulta_cifrado,
  p.notas_importantes_cifrado,
  p.profesional_principal_id,
  p.caja_fuerte_profesional,
  p.deleted_at,
  p.deleted_by_id,
  p.deleted_reason,
  p.pseudonimizado_en,

  pi.fecha_nacimiento,
  pi.sexo_biologico,
  pi.genero_autopercibido,
  pi.domicilio_ciudad,
  pi.domicilio_provincia,
  pi.domicilio_cp,
  pi.nombre_cifrado,
  pi.apellido_cifrado,
  pi.numero_doc_cifrado,
  pi.tipo_doc,
  pi.email_cifrado,
  pi.telefono_cifrado,
  pi.domicilio_calle_cifrado,
  pi.domicilio_numero_cifrado,

  -- Counts derivados (para badges UI)
  (SELECT count(*) FROM diagnostico d
    WHERE d.paciente_id = p.id AND d.estado = 'ACTIVO')   AS diagnosticos_activos,
  (SELECT count(*) FROM alergia a
    WHERE a.paciente_id = p.id AND a.activa = true)       AS alergias_activas,
  (SELECT count(*) FROM medicacion m
    WHERE m.paciente_id = p.id
      AND (m.hasta IS NULL OR m.hasta >= CURRENT_DATE))   AS medicaciones_vigentes,
  public.paciente_tiene_alergias_severas(p.id)             AS alerta_alergia_severa,

  p.created_at,
  p.updated_at
FROM paciente p
LEFT JOIN paciente_identidad pi ON pi.id = p.identidad_id;

COMMENT ON VIEW paciente_completo IS
  'Folio · vista para ficha /pacientes/[id]. RLS heredada de paciente (clinical-scoped).';

-- ─── turno_extendido ─────────────────────────────────────────────────────
-- Vista para la grilla de calendario y dashboard hoy. Une turno + paciente
-- (solo lo legible según rol) + servicio + pago.

CREATE OR REPLACE VIEW turno_extendido
WITH (security_invoker = true)
AS
SELECT
  t.id,
  t.organization_id,
  t.inicio,
  t.duracion_min,
  t.estado,
  t.origen,
  t.precio_cents,
  t.gcal_event_id,
  t.atendiendo_desde,
  t.duracion_real_min,
  t.created_at,

  t.paciente_id,
  pi.nombre_cifrado     AS paciente_nombre_cifrado,
  pi.apellido_cifrado   AS paciente_apellido_cifrado,
  pi.telefono_cifrado   AS paciente_telefono_cifrado,
  p.tipo                AS paciente_tipo,
  p.tags                AS paciente_tags,
  public.paciente_tiene_alergias_severas(p.id) AS paciente_alerta_alergia,

  t.servicio_id,
  s.nombre              AS servicio_nombre,
  s.tipo_canonico       AS servicio_tipo_canonico,

  t.profesional_id,

  pa.id                 AS pago_id,
  pa.monto_cents        AS pago_monto_cents,
  pa.metodo             AS pago_metodo,
  pa.estado             AS pago_estado,
  pa.pagado_ts          AS pago_pagado_ts

FROM turno t
JOIN paciente p           ON p.id = t.paciente_id
LEFT JOIN paciente_identidad pi ON pi.id = p.identidad_id
JOIN servicio s           ON s.id = t.servicio_id
LEFT JOIN pago pa         ON pa.turno_id = t.id;

COMMENT ON VIEW turno_extendido IS
  'Folio · vista turno + paciente_identidad + servicio + pago para grillas. RLS heredada de turno (scope clinic-aware).';

-- ─── sesion_con_enmiendas ────────────────────────────────────────────────

CREATE OR REPLACE VIEW sesion_con_enmiendas
WITH (security_invoker = true)
AS
SELECT
  s.id,
  s.organization_id,
  s.turno_id,
  s.paciente_id,
  s.soap_s_cifrado,
  s.soap_o_cifrado,
  s.soap_a_cifrado,
  s.soap_p_cifrado,
  s.vertebras_json,
  s.eva_antes,
  s.eva_despues,
  s.notas_cifrado,
  s.audio_url,
  s.locked_at,
  s.locked_by_id,
  s.created_at,
  s.updated_at,
  COALESCE(
    (SELECT jsonb_agg(jsonb_build_object(
      'id', e.id,
      'autor_id', e.autor_id,
      'motivo', e.motivo,
      'texto_correccion_cifrado', e.texto_correccion_cifrado,
      'created_at', e.created_at
    ) ORDER BY e.created_at)
    FROM sesion_enmienda e WHERE e.sesion_id = s.id),
    '[]'::jsonb
  ) AS enmiendas
FROM sesion s;

COMMENT ON VIEW sesion_con_enmiendas IS
  'Folio · sesion + array agregado de enmiendas. Para reconstruir el historial completo (sesion original + correcciones posteriores).';
