-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M55 · member.especialidad — especialidad por profesional (CLINICA-5)
-- ════════════════════════════════════════════════════════════════════════════
-- Hasta M50 la especialidad vive SOLO en organization.especialidad: una
-- clínica cardio+psico+quiro es inexpresable (el writer de sesiones y el slot
-- clínico de la ficha derivan la herramienta de la org, así que la psicóloga
-- de una clínica 'cardiologia' vería y persistiría la tool equivocada).
--
-- Esta migración agrega la dimensión por profesional:
--
--   member.especialidad text NULL
--     · NULL  = hereda organization.especialidad (caso de TODAS las filas
--       existentes — compat total con las orgs Solo de prod, sin backfill).
--     · slug  = especialidad propia del profesional. CHECK espejado del
--       organization_especialidad_valida de M50 y de ESPECIALIDAD_SLUGS en
--       lib/especialidades/meta.ts — los tres se amplían JUNTOS al sumar
--       una especialidad nueva.
--
-- La especialidad efectiva de un turno/sesión pasa a resolverse app-side como
--   member(turno.profesional_id).especialidad ?? organization.especialidad
-- (lib/especialidades/meta.ts → resolveEspecialidadEfectiva; writer único en
-- lib/db/sesiones.ts).
--
-- Decisiones de alcance:
--   · member_invitation NO lleva especialidad: setearla en la invitación
--     exigiría CREATE OR REPLACE de accept_member_invitation (M49). El flujo
--     de producto es invitar → aceptar → dirección (o el propio profesional)
--     la define en /configuracion → Equipo.
--   · SIN policies nuevas: RLS no es column-level — una policy de UPDATE
--     "self/director" sobre member permitiría también escalar role/alcance.
--     La edición va por server action gateada app-side (canManageTeam o self,
--     lib/db/members.ts → updateMemberEspecialidad) con service client
--     acotado a la columna, y queda en audit_log (M12).
--
-- Append-only / portabilidad: 100% aditiva (columna nullable + CHECK que
-- valida trivialmente sobre una columna all-NULL). No referencia tablas de
-- migraciones posteriores ni define funciones → no necesita
-- `set check_function_bodies = off`. Replay-safe en postgres:16 vanilla.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE member
  ADD COLUMN especialidad text
  CONSTRAINT member_especialidad_valida
    CHECK (especialidad IS NULL OR especialidad IN ('quiropraxia', 'cardiologia', 'psicologia'));

COMMENT ON COLUMN member.especialidad IS
  'M55 · especialidad propia del profesional (quiropraxia | cardiologia | '
  'psicologia). NULL = hereda organization.especialidad. Decide la herramienta '
  'clínica efectiva de los turnos de este member: '
  'member.especialidad ?? organization.especialidad (registry en '
  'lib/especialidades/). Mantener el CHECK en lockstep con el de M50 y con '
  'ESPECIALIDAD_SLUGS al ampliar el registry.';
