-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M83 · Widen CHECK member.especialidad → kinesiologia + nutricion
-- (remediación de review adversarial · lockstep Fase 2 N1/N2)
-- ════════════════════════════════════════════════════════════════════════════
-- La Fase 2 sumó dos especialidades al registry (kinesiologia · N1, nutricion ·
-- N2). Sus migraciones ampliaron el CHECK de slug en DOS de las TRES columnas
-- que enumeran especialidades permitidas:
--
--   · organization.especialidad          → M74 (kinesio) + M75 (nutricion)  ✓
--   · paciente_intake_avanzado.especialidad → M74 + M75                      ✓
--   · member.especialidad (M55)          → NO ampliada                       ✗  ← acá
--
-- El header de M55 manda mantener member_especialidad_valida EN LOCKSTEP con el
-- CHECK de M50 y con ESPECIALIDAD_SLUGS (lib/especialidades/meta.ts). N1/N2 ya
-- agregaron 'kinesiologia'/'nutricion' a ESPECIALIDAD_SLUGS, así que
-- memberEspecialidadSchema = z.enum(ESPECIALIDAD_SLUGS).nullable() (lib/db/
-- members.ts) los ACEPTA y /configuracion → Equipo los renderiza como opción
-- seleccionable. Pero el CHECK de M55 seguía en el conjunto viejo
-- ('quiropraxia','cardiologia','psicologia'): una dirección de CLÍNICA (o el
-- propio colegiado) asignando kinesiologia/nutricion a un member disparaba
-- updateMemberEspecialidad → UPDATE que el CHECK rechaza (SQLSTATE 23514),
-- superficie como db_error genérico — feature rota justo en el escenario
-- multi-especialidad para el que M55 existe. Sin corrupción ni ruptura de replay
-- (el write se rechaza), pero es un bug de producto shipped.
--
-- Regla append-only: NO se editan las migraciones M55/M74/M75 aplicadas. Para no
-- alterar el DDL histórico se DROPEA y RECREA el CONSTRAINT con el conjunto
-- COMPLETO acumulado (quiropraxia, cardiologia, psicologia, KINESIOLOGIA y
-- NUTRICION) — el mismo conjunto final que M75 dejó en organization/intake, para
-- que las TRES columnas queden idénticas. Se preserva el patrón M55: el CHECK es
-- `especialidad IS NULL OR especialidad IN (...)` (NULL = hereda la org). Es un
-- widening de metadata que sólo ACEPTA valores nuevos: ninguna fila existente
-- puede violarlo (todos los slugs previos siguen permitidos, y NULL sigue
-- válido), así que valida trivialmente al instalar.
--
-- Portabilidad: sólo ALTER TABLE DROP/ADD CONSTRAINT de CHECK inline (no
-- referencia tablas de migraciones posteriores, no define funciones SQL). NO
-- necesita `set check_function_bodies = off` ni IMMUTABLE. Replay-safe en
-- postgres:16 vanilla y bajo pgTAP. Idempotente: el DROP usa IF EXISTS y el ADD
-- se guarda por pg_constraint (patrón M74/M75/M78/M62), así que un segundo replay
-- no rompe.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── member.especialidad (M55) ──────────────────────────────────────────────

ALTER TABLE member
  DROP CONSTRAINT IF EXISTS member_especialidad_valida;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'member_especialidad_valida'
  ) THEN
    ALTER TABLE member
      ADD CONSTRAINT member_especialidad_valida
      CHECK (especialidad IS NULL
             OR especialidad IN ('quiropraxia', 'cardiologia', 'psicologia', 'kinesiologia', 'nutricion'));
  END IF;
END$$;

COMMENT ON COLUMN member.especialidad IS
  'M55+M83 · especialidad propia del profesional (quiropraxia | cardiologia | '
  'psicologia | kinesiologia | nutricion). NULL = hereda organization.especialidad. '
  'Decide la herramienta clínica efectiva de los turnos de este member: '
  'member.especialidad ?? organization.especialidad (registry en '
  'lib/especialidades/). Mantener el CHECK en lockstep con el de M50 y con '
  'ESPECIALIDAD_SLUGS al ampliar el registry (dropear + recrear el CONSTRAINT, '
  'regla append-only).';
