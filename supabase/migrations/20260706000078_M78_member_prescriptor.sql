-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M78 · Campos prescriptor en member (identidad para receta digital · R1)
-- ════════════════════════════════════════════════════════════════════════════
-- Prepara la identidad PRESCRIPTORA del profesional para la receta digital
-- (Fase 5 · R1). La receta argentina exige, además del nombre y la matrícula,
-- individualizar al prescriptor con su registro nacional (REFEPS/ReNaPDiS) y la
-- JURISDICCIÓN de la matrícula (provincial vs nacional), y opcionalmente la
-- especialidad bajo la que prescribe. La tabla `receta` NO se crea acá (es M79 ·
-- R2): esta migración sólo agrega la IDENTIDAD del prescriptor, que vive en
-- `member` (por-profesional, por-org), igual que M55 (especialidad) y M62
-- (perfil público) — no en `profile`.
--
-- Por qué en `member` y no en `profile`:
--   · La matrícula base sigue en profile.matricula (M02) y NO se duplica — el
--     mismo criterio que M62 con mostrar_matricula. El registro nacional y la
--     jurisdicción SÍ pueden variar por consultorio (un profesional puede
--     prescribir en más de una org bajo distinta jurisdicción), así que son
--     por-member como la especialidad de M55.
--   · Son credenciales del PROPIO profesional, NO PII de paciente → NO entran en
--     pseudonimizar_paciente (M39/M61/M63, que redacta datos de pacientes). Al
--     igual que member.foto_publica_url/bio_publica (M62), quedan en la fila
--     member huérfana tras pseudonimizar_member (que sólo redacta profile y
--     soft-deletea el member). Se respeta la regla append-only: NO se toca
--     pseudonimizar_member.
--
-- Columnas (todas NULLABLE — 100% aditivas, backfill = NULL, sin exposición):
--   member.registro_prescriptor        text NULL  · REFEPS/ReNaPDiS/registro nac.
--   member.jurisdiccion_matricula      text NULL  · jurisdicción de la matrícula
--   member.especialidad_prescriptora   text NULL  · especialidad bajo la que Rx
--
-- Estos son textos administrativos NO médicos y NO PII sensible de paciente →
-- viven en plaintext (igual que profile.matricula). La edición irá por server
-- action gateada app-side (self o dirección) + service client acotado a estas
-- columnas + audit_log, EXACTAMENTE el mismo patrón que member.especialidad
-- (M55): RLS no es column-level, así que NO se agrega una policy de UPDATE
-- "self/director" sobre member (permitiría escalar role/alcance). Sin PHI.
--
-- Append-only / portabilidad: sólo columnas nullable + CHECKs de longitud que
-- validan trivialmente sobre columnas all-NULL. No referencia tablas de
-- migraciones posteriores ni define funciones SQL → NO necesita
-- `set check_function_bodies = off` ni IMMUTABLE. Replay-safe en postgres:16
-- vanilla y bajo pgTAP. Idempotente (ADD COLUMN IF NOT EXISTS + CHECK guardado
-- por pg_constraint, patrón M62).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Columnas en member ─────────────────────────────────────────────────────

ALTER TABLE member
  ADD COLUMN IF NOT EXISTS registro_prescriptor      text NULL,
  ADD COLUMN IF NOT EXISTS jurisdiccion_matricula    text NULL,
  ADD COLUMN IF NOT EXISTS especialidad_prescriptora text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'member_registro_prescriptor_len'
  ) THEN
    ALTER TABLE member
      ADD CONSTRAINT member_registro_prescriptor_len
      CHECK (registro_prescriptor IS NULL
             OR length(registro_prescriptor) BETWEEN 1 AND 60);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'member_jurisdiccion_matricula_len'
  ) THEN
    ALTER TABLE member
      ADD CONSTRAINT member_jurisdiccion_matricula_len
      CHECK (jurisdiccion_matricula IS NULL
             OR length(jurisdiccion_matricula) BETWEEN 1 AND 80);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'member_especialidad_prescriptora_len'
  ) THEN
    ALTER TABLE member
      ADD CONSTRAINT member_especialidad_prescriptora_len
      CHECK (especialidad_prescriptora IS NULL
             OR length(especialidad_prescriptora) BETWEEN 1 AND 80);
  END IF;
END$$;

COMMENT ON COLUMN member.registro_prescriptor IS
  'M78 · registro nacional del prescriptor (REFEPS/ReNaPDiS u otro registro '
  'nacional) para la receta digital (R1). Distinto de profile.matricula (M02), '
  'que es la matrícula base y NO se duplica. Credencial del profesional, NO PII '
  'de paciente. Plaintext, nullable. Editable por self/dirección vía server '
  'action (patrón M55), fuera de pseudonimizar_paciente.';
COMMENT ON COLUMN member.jurisdiccion_matricula IS
  'M78 · jurisdicción de la matrícula (p. ej. "Provincia de Buenos Aires", '
  '"Matrícula Nacional") para individualizar al prescriptor en la receta. '
  'Puede variar por consultorio → vive en member (como M55). Plaintext, nullable.';
COMMENT ON COLUMN member.especialidad_prescriptora IS
  'M78 · especialidad bajo la que el profesional prescribe (texto libre, p. ej. '
  '"Cardiología", "Medicina general"). Independiente de member.especialidad '
  '(M55), que decide la HERRAMIENTA clínica del registry. Plaintext, nullable.';
