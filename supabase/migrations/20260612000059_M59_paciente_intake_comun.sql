-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M59 · Campos comunes de intake del paciente (ocupación, recomendado por)
-- ════════════════════════════════════════════════════════════════════════════
-- El alta de paciente se amplía con campos comunes a todas las especialidades.
-- La mayoría ya tienen columna (nombre/apellido/teléfono/email, fecha_nacimiento,
-- domicilio_ciudad/provincia, motivo_consulta). Faltan dos generales:
--   - ocupacion (PII)
--   - recomendado_por (PII de un tercero)
-- Ambos van en paciente_identidad (AES-256-GCM app-side). Por vivir ahí, la
-- pseudonimización (M13/M25) ya los borra físicamente al eliminar la identidad
-- → cumplen el derecho al olvido sin tocar el proc.
--
-- ⚠️  paciente_completo se redefine para EXPONER las columnas a la ficha. Igual
--     que M56: CREATE OR REPLACE VIEW no preserva reloptions → hay que RE-
--     DECLARAR `WITH (security_invoker = true)` o se vuelve fuga RLS. Definición
--     base copiada de M14; columnas existentes intactas y en el mismo orden —
--     sólo se AGREGAN las dos nuevas al final. DO-block final lo verifica.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE paciente_identidad
  ADD COLUMN ocupacion_cifrado       bytea,
  ADD COLUMN recomendado_por_cifrado bytea;

COMMENT ON COLUMN paciente_identidad.ocupacion_cifrado IS 'AES-256-GCM app-side · M59 (intake común)';
COMMENT ON COLUMN paciente_identidad.recomendado_por_cifrado IS 'AES-256-GCM app-side · M59 (intake común, PII de tercero)';

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
  p.updated_at,

  -- M59: columnas nuevas, AÑADIDAS AL FINAL (no reordena las existentes).
  pi.ocupacion_cifrado,
  pi.recomendado_por_cifrado

FROM paciente p
LEFT JOIN paciente_identidad pi ON pi.id = p.identidad_id;

COMMENT ON VIEW paciente_completo IS
  'Folio · vista para ficha /pacientes/[id]. RLS heredada de paciente (clinical-scoped) vía security_invoker. M59 suma ocupacion/recomendado_por.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'paciente_completo'
      AND relkind = 'v'
      AND reloptions @> ARRAY['security_invoker=true']
  ) THEN
    RAISE EXCEPTION 'M59: paciente_completo perdió security_invoker=true (fuga RLS) — abortando';
  END IF;
END $$;
