-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M89 · Cobertura del paciente: obra social / prepaga (Grado A · F7a)
-- ════════════════════════════════════════════════════════════════════════════
-- Gap del benchmark AR (auditoría Grado A): obra social/prepaga es expectativa
-- BASE del mercado argentino — todo consultorio la pregunta en el alta y la
-- necesita en el detalle del turno y el export para el contador. Folio hoy
-- hardcodeaba "Obra social: Particular" en la ficha (falso para todos).
--
-- Alcance CONSCIENTE (decisión del dueño): son CAMPOS + filtro + export.
-- NO es facturación a obras sociales (autorizaciones, nomencladores, etc.).
--
-- ─── Diseño de columnas (en paciente_identidad, junto al resto de la PII) ────
--   · cobertura_nombre  text NULL — nombre de la obra social/prepaga (OSDE,
--     Swiss Medical, PAMI, …) EN CLARO: alimenta filtro por cobertura en
--     /pacientes y el agrupado del export; es dato administrativo de baja
--     sensibilidad (la afiliación NO revela condición clínica) y cifrarlo
--     mataría el filtro server-side. NULL = particular / sin informar.
--   · cobertura_plan    text NULL — plan ("210", "SMG30"), en claro por el
--     mismo criterio.
--   · cobertura_nro_afiliado_cifrado bytea NULL — número de afiliado CIFRADO
--     app-side (AES-256-GCM vía lib/crypto, mismo tipo bytea que
--     numero_doc_cifrado): es un identificador personal fuerte, mismo
--     tratamiento que el DNI. Nunca se filtra/busca por él → sin blind index.
--
-- Aditiva pura: 3 columnas NULL, sin backfill, sin CHECK que valide on-install,
-- sin cambios de RLS (viajan con las policies existentes de paciente_identidad
-- — la lectura ya está scopeada por org y el UPDATE por los roles con alta de
-- pacientes). Replay-safe en vanilla postgres:16 con settings default.

alter table public.paciente_identidad
  add column if not exists cobertura_nombre text null,
  add column if not exists cobertura_plan text null,
  add column if not exists cobertura_nro_afiliado_cifrado bytea null;

comment on column public.paciente_identidad.cobertura_nombre is
  'M89 · Obra social / prepaga del paciente, en claro (dato administrativo; '
  'alimenta filtro y export). NULL = particular / sin informar.';
comment on column public.paciente_identidad.cobertura_plan is
  'M89 · Plan de la cobertura ("210", "SMG30"), en claro.';
comment on column public.paciente_identidad.cobertura_nro_afiliado_cifrado is
  'M89 · Nro de afiliado CIFRADO app-side (lib/crypto, mismo tratamiento que '
  'numero_doc_cifrado). Sin blind index: no se busca por este campo.';
