-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M75 · Especialidad Nutrición (CHECK widening · N2)
-- ════════════════════════════════════════════════════════════════════════════
-- Fase 2 del plan integral: suma la especialidad `nutricion` al registry de la
-- app (lib/especialidades/nutricion/), cuya herramienta clínica
-- (nutricion.ficha.v1) registra antropometría longitudinal (peso, talla, IMC
-- derivado, circunferencias corporales y pliegues cutáneos), plan alimentario en
-- texto libre y objetivos nutricionales; reusa el <SerieEvolucion> de la
-- biblioteca lib/instrumentos para la curva de evolución (peso/IMC/cintura).
--
-- Esta migración SOLO amplía dos CHECK que enumeran los slugs de especialidad
-- permitidos, para que una org o un intake avanzado puedan declararse
-- `nutricion`:
--
--   1. organization.especialidad          — CHECK organization_especialidad_valida (M50)
--   2. paciente_intake_avanzado.especialidad — CHECK …_especialidad_valida        (M60)
--
-- Regla append-only: NO se editan las migraciones M50/M60/M74 aplicadas. Para no
-- alterar el DDL histórico, se DROPEA y RECREA cada CONSTRAINT con el conjunto de
-- valores ampliado. Como M74 (N1) ya sumó 'kinesiologia', este CHECK nuevo debe
-- incluir el conjunto COMPLETO acumulado — quiropraxia, cardiologia, psicologia,
-- KINESIOLOGIA y NUTRICION — para no revertir el widening de N1. Es un cambio de
-- metadata (widening) que sólo ACEPTA valores nuevos: ninguna fila existente
-- puede violarlo (todos los slugs previos siguen permitidos), así que valida
-- trivialmente al instalar.
--
-- Portabilidad: sólo ALTER TABLE DROP/ADD CONSTRAINT de CHECK inline (no
-- referencia tablas de migraciones posteriores, no define funciones SQL). NO
-- necesita `set check_function_bodies = off` ni IMMUTABLE. Replay-safe en
-- postgres:16 vanilla y bajo pgTAP. Idempotente: los DROP usan IF EXISTS y el ADD
-- se guarda por pg_constraint (patrón M74/M78/M62), así que un segundo replay no
-- rompe.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. organization.especialidad (M50 + M74) ───────────────────────────────

ALTER TABLE organization
  DROP CONSTRAINT IF EXISTS organization_especialidad_valida;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organization_especialidad_valida'
  ) THEN
    ALTER TABLE organization
      ADD CONSTRAINT organization_especialidad_valida
      CHECK (especialidad IN ('quiropraxia', 'cardiologia', 'psicologia', 'kinesiologia', 'nutricion'));
  END IF;
END$$;

COMMENT ON COLUMN organization.especialidad IS
  'M50+M74+M75 · slug de especialidad del tenant (quiropraxia | cardiologia | '
  'psicologia | kinesiologia | nutricion). Decide qué herramienta clínica '
  'renderiza el slot de la ficha del paciente (registry en lib/especialidades/). '
  'Orgs previas backfill a quiropraxia vía DEFAULT. Ampliar el CHECK al sumar '
  'especialidades nuevas (dropear + recrear el CONSTRAINT, regla append-only).';

-- ─── 2. paciente_intake_avanzado.especialidad (M60 + M74) ────────────────────

ALTER TABLE paciente_intake_avanzado
  DROP CONSTRAINT IF EXISTS paciente_intake_avanzado_especialidad_valida;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'paciente_intake_avanzado_especialidad_valida'
  ) THEN
    ALTER TABLE paciente_intake_avanzado
      ADD CONSTRAINT paciente_intake_avanzado_especialidad_valida
      CHECK (especialidad IN ('quiropraxia', 'cardiologia', 'psicologia', 'kinesiologia', 'nutricion'));
  END IF;
END$$;
