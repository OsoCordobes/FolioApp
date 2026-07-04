-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M68 · Seed de plantillas globales de consentimiento + titulo + PNG
-- ════════════════════════════════════════════════════════════════════════════
-- La tabla plantilla_consentimiento (M04) está VACÍA en prod: sin plantillas
-- la UI de consentimiento informado (Ley 26.529 art. 5-11) no tiene nada que
-- firmar. Esta migración deja el feature operable:
--
--   1. Agrega `titulo` a plantilla_consentimiento. El reader existente
--      (lib/db/consentimientos.ts, listConsentimientosPaciente) ya embebe
--      `plantilla_consentimiento(titulo, tipo, version)` — sin la columna el
--      SELECT falla a runtime con 42703 (el cliente <any> no lo detecta en
--      compile time). Nullable: las plantillas custom de una org pueden no
--      tenerlo y la UI cae al label del tipo.
--   2. Seed idempotente de las 5 plantillas globales (organization_id = NULL,
--      una por valor del enum tipo_consentimiento de M04, version 1). Guard
--      WHERE NOT EXISTS por (global, tipo, version): la tabla no tiene UNIQUE
--      sobre esa terna, así que ON CONFLICT no alcanza para idempotencia.
--      Texto legal es-AR basado en supabase/seed/03_plantillas_consentimiento.sql
--      (Ley 26.529, Ley 25.326, Ley 26.061). Los placeholders {{...}} los
--      muestra la UI tal cual (la firma manuscrita va en el canvas).
--   3. Amplía allowed_mime_types del bucket `consentimientos-firmados` (M27
--      lo creó solo-PDF) para aceptar image/png: la firma en canvas sube un
--      PNG. El CHECK de path de M07 ya admite `.png` ([a-zA-Z0-9_.-]+).
--
-- Inmutabilidad: el trigger plantilla_immutable_guard (M04) bloquea cambios de
-- texto/version/tipo una vez publicada — el backfill de `titulo` no los toca.
-- Replay: sin funciones ni referencias forward → corre en postgres:16 vanilla
-- con check_function_bodies default. storage.buckets existe en el stub del CI
-- (pgtap.yml declara id/name/public/file_size_limit/allowed_mime_types).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Columna titulo (requerida por el reader de lib/db) ──────────────────

ALTER TABLE plantilla_consentimiento ADD COLUMN IF NOT EXISTS titulo text;

COMMENT ON COLUMN plantilla_consentimiento.titulo IS
  'Folio · M68 · título humano de la plantilla para listados ("Consentimiento informado · Atención clínica general"). NULL → la UI muestra el label del tipo.';

-- Backfill para entornos donde el seed viejo (supabase/seed/03) ya insertó
-- globales sin titulo. Solo filas globales con titulo NULL — no pisa nada.
UPDATE plantilla_consentimiento SET titulo = 'Consentimiento informado · Atención clínica general'
  WHERE organization_id IS NULL AND titulo IS NULL AND tipo = 'GENERAL';
UPDATE plantilla_consentimiento SET titulo = 'Consentimiento para registro fotográfico clínico'
  WHERE organization_id IS NULL AND titulo IS NULL AND tipo = 'FOTOS';
UPDATE plantilla_consentimiento SET titulo = 'Consentimiento para divulgación científica'
  WHERE organization_id IS NULL AND titulo IS NULL AND tipo = 'DIVULGACION_CIENTIFICA';
UPDATE plantilla_consentimiento SET titulo = 'Consentimiento para atención por telemedicina'
  WHERE organization_id IS NULL AND titulo IS NULL AND tipo = 'TELEMEDICINA';
UPDATE plantilla_consentimiento SET titulo = 'Consentimiento informado · Tratamiento de menor de edad'
  WHERE organization_id IS NULL AND titulo IS NULL AND tipo = 'TRATAMIENTO_MENOR';

-- ─── 2. Seed de plantillas globales (idempotente por tipo+version) ──────────

INSERT INTO plantilla_consentimiento (organization_id, tipo, version, titulo, texto_markdown, publicado_en)
SELECT NULL, 'GENERAL'::tipo_consentimiento, 1,
  'Consentimiento informado · Atención clínica general',
  $md$# Consentimiento informado · Atención clínica general

**Fecha:** {{fecha}}
**Profesional:** {{profesional_nombre}} · {{profesional_matricula}}
**Paciente:** {{paciente_nombre}} · DNI {{paciente_dni}}

## Información del procedimiento

He recibido información clara y comprensible sobre la naturaleza, propósito, beneficios y posibles riesgos del procedimiento clínico propuesto, así como sobre alternativas terapéuticas disponibles.

Comprendo que:

1. La práctica clínica no garantiza resultados absolutos; los efectos esperados son razonablemente probables según la mejor evidencia disponible.
2. Pueden existir efectos secundarios o complicaciones poco frecuentes, que el profesional me ha explicado en términos generales.
3. Tengo el derecho a interrumpir el tratamiento en cualquier momento y a obtener una segunda opinión.
4. Puedo solicitar copia de mi historia clínica en cualquier momento (Ley 26.529 art. 14).

## Tratamiento de datos personales (Ley 25.326)

Autorizo el tratamiento de mis datos personales y de salud para los fines exclusivos de mi atención clínica, conservación de mi historia clínica (10 años · Ley 26.529 art. 18), y comunicaciones relacionadas con turnos y resultados.

Mis datos no serán cedidos a terceros sin mi consentimiento expreso, salvo obligación legal.

## Derechos

He sido informado/a de mi derecho a:

- Acceder, rectificar y solicitar la supresión de mis datos (con la salvedad de la retención clínica obligatoria).
- Revocar este consentimiento por escrito en cualquier momento, sin que ello afecte la validez del tratamiento ya realizado (Ley 26.529 art. 11).
- Formular consultas o reclamos ante la Agencia de Acceso a la Información Pública (AAIP).
$md$, now()
WHERE NOT EXISTS (
  SELECT 1 FROM plantilla_consentimiento
  WHERE organization_id IS NULL AND tipo = 'GENERAL' AND version = 1
);

INSERT INTO plantilla_consentimiento (organization_id, tipo, version, titulo, texto_markdown, publicado_en)
SELECT NULL, 'FOTOS'::tipo_consentimiento, 1,
  'Consentimiento para registro fotográfico clínico',
  $md$# Consentimiento para registro fotográfico clínico

**Fecha:** {{fecha}}
**Profesional:** {{profesional_nombre}} · {{profesional_matricula}}
**Paciente:** {{paciente_nombre}} · DNI {{paciente_dni}}

## Objeto

Autorizo al profesional indicado a tomar fotografías clínicas (postura, regiones anatómicas, evolución de lesiones) durante mi tratamiento, con el único propósito de:

- Documentar la evolución clínica en mi historia.
- Comparar antes/después para evaluar resultados.
- Uso interno de planificación terapéutica.

## Lo que NO autorizo (salvo consentimiento adicional)

- Uso de mis fotografías en publicaciones científicas, congresos o redes sociales.
- Cesión a terceros.
- Identificación facial sin censura.

## Protección y custodia

Las imágenes se conservan en el sistema clínico del consultorio, cifradas y con acceso restringido al profesional tratante. Se eliminarán al cierre definitivo de mi historia clínica o cuando lo solicite por escrito.
$md$, now()
WHERE NOT EXISTS (
  SELECT 1 FROM plantilla_consentimiento
  WHERE organization_id IS NULL AND tipo = 'FOTOS' AND version = 1
);

INSERT INTO plantilla_consentimiento (organization_id, tipo, version, titulo, texto_markdown, publicado_en)
SELECT NULL, 'DIVULGACION_CIENTIFICA'::tipo_consentimiento, 1,
  'Consentimiento para divulgación científica',
  $md$# Consentimiento para divulgación científica

**Fecha:** {{fecha}}
**Profesional:** {{profesional_nombre}} · {{profesional_matricula}}

Autorizo el uso ANONIMIZADO de mi información clínica (sin nombre, DNI, ni dato que permita identificarme) para:

- Presentaciones en congresos profesionales.
- Publicaciones en revistas científicas indexadas.
- Análisis estadísticos agregados con fines de investigación.
- Material educativo para profesionales en formación.

Comprendo que la anonimización es irreversible: una vez incluida mi información en una publicación, no será posible identificarme.

Este consentimiento es revocable hasta el momento previo a la publicación.
$md$, now()
WHERE NOT EXISTS (
  SELECT 1 FROM plantilla_consentimiento
  WHERE organization_id IS NULL AND tipo = 'DIVULGACION_CIENTIFICA' AND version = 1
);

INSERT INTO plantilla_consentimiento (organization_id, tipo, version, titulo, texto_markdown, publicado_en)
SELECT NULL, 'TELEMEDICINA'::tipo_consentimiento, 1,
  'Consentimiento para atención por telemedicina',
  $md$# Consentimiento para atención por telemedicina

**Fecha:** {{fecha}}
**Profesional:** {{profesional_nombre}} · {{profesional_matricula}}

Acepto recibir atención profesional a distancia mediante medios digitales (videoconferencia, mensajería profesional, plataforma del consultorio), comprendiendo que:

1. La consulta a distancia tiene limitaciones inherentes: no permite examen físico directo. El profesional puede solicitar que asista de forma presencial si lo considera necesario.
2. La conexión depende de tecnología que puede fallar; en caso de interrupción de la consulta, el profesional intentará retomarla por otro medio.
3. La sesión puede grabarse SOLO con mi autorización expresa por escrito.
4. La información intercambiada queda registrada en mi historia clínica con el mismo nivel de protección que una consulta presencial (Ley 26.529 art. 18, retención 10 años).
5. Plataformas técnicas usadas: las informa el profesional al inicio. Cumplen estándares de cifrado en tránsito.
$md$, now()
WHERE NOT EXISTS (
  SELECT 1 FROM plantilla_consentimiento
  WHERE organization_id IS NULL AND tipo = 'TELEMEDICINA' AND version = 1
);

INSERT INTO plantilla_consentimiento (organization_id, tipo, version, titulo, texto_markdown, publicado_en)
SELECT NULL, 'TRATAMIENTO_MENOR'::tipo_consentimiento, 1,
  'Consentimiento informado · Tratamiento de menor de edad',
  $md$# Consentimiento informado · Tratamiento de menor de edad

**Fecha:** {{fecha}}
**Profesional:** {{profesional_nombre}} · {{profesional_matricula}}
**Menor:** {{paciente_nombre}} · DNI {{paciente_dni}}

## Representante legal firmante

**Nombre:** {{tutor_nombre}}
**Vínculo:** {{tutor_vinculo}}

Declaro ser el/la representante legal del/de la menor identificado/a, con facultad para autorizar el tratamiento clínico propuesto (Ley 26.061 art. 24).

## Información del procedimiento

He recibido información clara y comprensible sobre el procedimiento propuesto. Comprendo riesgos, beneficios, alternativas y plan de tratamiento. He sido informado/a del derecho del/de la menor a ser escuchado/a (Ley 26.061 art. 24).

## Escucha del menor

Si el/la menor tiene 13 años o más, se le ha explicado el procedimiento en términos comprensibles y se ha registrado su opinión:

[ ] El/la menor expresa acuerdo con el tratamiento.
[ ] El/la menor expresa reservas o desacuerdo (detallar en historia clínica).
[ ] No corresponde por edad (menor de 13 años).

## Tratamiento de datos

Autorizo el tratamiento de datos personales y de salud del/de la menor, en los términos del Consentimiento general (firmado por separado).
$md$, now()
WHERE NOT EXISTS (
  SELECT 1 FROM plantilla_consentimiento
  WHERE organization_id IS NULL AND tipo = 'TRATAMIENTO_MENOR' AND version = 1
);

-- ─── 3. Bucket: aceptar PNG de la firma en canvas ────────────────────────────
-- M27 creó `consentimientos-firmados` con allowed_mime_types = {application/pdf}
-- (pensado para PDFs firmados físicamente). La firma digital en canvas sube
-- image/png; sin esto el upload falla con "mime type not supported".
-- Idempotente: UPDATE absoluto del set permitido (pdf + png).

UPDATE storage.buckets
SET allowed_mime_types = ARRAY['application/pdf', 'image/png']
WHERE id = 'consentimientos-firmados';
