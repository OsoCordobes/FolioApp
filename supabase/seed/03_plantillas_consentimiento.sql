-- ════════════════════════════════════════════════════════════════════════════
-- Folio · seed · Plantillas globales de consentimiento informado
-- ════════════════════════════════════════════════════════════════════════════
-- 5 plantillas legales base (organization_id = NULL = globales del sistema).
-- Cada consultorio puede crear su propia versión custom partiendo de éstas.
--
-- Marco legal:
--   - Ley 26.529 art. 5-11 (consentimiento informado, AR)
--   - Ley 25.326 (Habeas Data — autorización para tratamiento de datos)
--   - Ley 26.061 (TRATAMIENTO_MENOR · firmado por tutor)
--   - Ley 26.529 art. 16 (TELEMEDICINA · vigencia ampliada post-pandemia)
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO plantilla_consentimiento
  (organization_id, tipo, version, texto_markdown, publicado_en)
VALUES
  (NULL, 'GENERAL', 1, $$# Consentimiento informado · Atención clínica general

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
- Revocar este consentimiento por escrito en cualquier momento, sin que ello afecte la validez del tratamiento ya realizado.
- Formular consultas o reclamos ante la Agencia de Acceso a la Información Pública (AAIP).

---

**Firma del paciente:** ________________________
**Aclaración:** {{paciente_nombre}}
**DNI:** {{paciente_dni}}
**Fecha:** {{fecha}}
$$, now()),

  (NULL, 'FOTOS', 1, $$# Consentimiento para registro fotográfico clínico

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

---

**Firma:** ________________________
**Aclaración:** {{paciente_nombre}}
**DNI:** {{paciente_dni}}
**Fecha:** {{fecha}}
$$, now()),

  (NULL, 'DIVULGACION_CIENTIFICA', 1, $$# Consentimiento para divulgación científica

**Fecha:** {{fecha}}
**Profesional:** {{profesional_nombre}} · {{profesional_matricula}}

Autorizo el uso ANONIMIZADO de mi información clínica (sin nombre, DNI, ni dato que permita identificarme) para:

- Presentaciones en congresos profesionales.
- Publicaciones en revistas científicas indexadas.
- Análisis estadísticos agregados con fines de investigación.
- Material educativo para profesionales en formación.

Comprendo que la anonimización es irreversible: una vez incluida mi información en una publicación, no será posible identificarme.

Este consentimiento es revocable hasta el momento previo a la publicación.

---

**Firma:** ________________________
**Aclaración:** {{paciente_nombre}}
**DNI:** {{paciente_dni}}
**Fecha:** {{fecha}}
$$, now()),

  (NULL, 'TELEMEDICINA', 1, $$# Consentimiento para atención por telemedicina

**Fecha:** {{fecha}}
**Profesional:** {{profesional_nombre}} · {{profesional_matricula}}

Acepto recibir atención profesional a distancia mediante medios digitales (videoconferencia, mensajería profesional, plataforma del consultorio), comprendiendo que:

1. La consulta a distancia tiene limitaciones inherentes: no permite examen físico directo. El profesional puede solicitar que asista de forma presencial si lo considera necesario.
2. La conexión depende de tecnología que puede fallar; en caso de interrupción de la consulta, el profesional intentará retomarla por otro medio.
3. La sesión puede grabarse SOLO con mi autorización expresa por escrito.
4. La información intercambiada queda registrada en mi historia clínica con el mismo nivel de protección que una consulta presencial (Ley 26.529 art. 18, retención 10 años).
5. Plataformas técnicas usadas: las informa el profesional al inicio. Cumplen estándares de cifrado en tránsito.

---

**Firma:** ________________________
**Aclaración:** {{paciente_nombre}}
**DNI:** {{paciente_dni}}
**Fecha:** {{fecha}}
$$, now()),

  (NULL, 'TRATAMIENTO_MENOR', 1, $$# Consentimiento informado · Tratamiento de menor de edad

**Fecha:** {{fecha}}
**Profesional:** {{profesional_nombre}} · {{profesional_matricula}}
**Menor:** {{paciente_nombre}} · DNI {{paciente_dni}} · Edad {{paciente_edad}}

## Representante legal firmante

**Nombre:** {{tutor_nombre}}
**DNI:** {{tutor_dni}}
**Vínculo:** {{tutor_vinculo}}

Declaro ser el/la representante legal del/de la menor identificado/a, con facultad para autorizar el tratamiento clínico propuesto (Ley 26.061 art. 24).

## Información del procedimiento

He recibido información clara y comprensible sobre el procedimiento propuesto. Comprendo riesgos, beneficios, alternativas y plan de tratamiento. He sido informado/a del derecho del/de la menor a ser escuchado/a (Ley 26.061 art. 24).

## Escucha del menor

Si el/la menor tiene 13 años o más, se le ha explicado el procedimiento en términos comprensibles y se ha registrado su opinión:

[ ] El/la menor expresa acuerdo con el tratamiento.
[ ] El/la menor expresa reservas o desacuerdo (detallar en historia clínica).
[ ] No corresponde por edad (<13 años).

## Tratamiento de datos

Autorizo el tratamiento de datos personales y de salud del/de la menor, en los términos del Consentimiento general (firmado por separado).

---

**Firma representante legal:** ________________________
**Aclaración:** {{tutor_nombre}}
**DNI:** {{tutor_dni}}
**Fecha:** {{fecha}}
$$, now())
ON CONFLICT DO NOTHING;

-- Verificación
DO $$
DECLARE c integer;
BEGIN
  SELECT count(*) INTO c FROM plantilla_consentimiento WHERE organization_id IS NULL;
  RAISE NOTICE 'Folio seed: % plantillas globales de consentimiento cargadas', c;
END
$$;
