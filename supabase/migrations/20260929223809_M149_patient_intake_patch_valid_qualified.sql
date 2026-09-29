-- Folio · M149 · Calificación de columnas en la validación del patch M148
-- Migración aditiva: M148 permanece inmutable. Conserva firma, atributos,
-- cuerpo, permisos y search_path; sólo elimina la ambigüedad PL/pgSQL entre
-- la variable `value` y la columna `jsonb_each.value`.

CREATE OR REPLACE FUNCTION folio_intake_private.incorporation_patch_valid(
  p_patch jsonb,p_selected text[]) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE field text; value jsonb; base64_fields text[]:=ARRAY[
  'nombre_cifrado','apellido_cifrado','numero_doc_cifrado','email_cifrado',
  'telefono_cifrado','cobertura_nro_afiliado_cifrado'];
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object'
    OR pg_column_size(p_patch)>32768 THEN RETURN false; END IF;
  FOR field,value IN SELECT entry.key,entry.value FROM jsonb_each(p_patch) AS entry LOOP
    IF field NOT IN ('nombre_cifrado','apellido_cifrado','nombre_hash','tipo_doc',
      'numero_doc_cifrado','dni_hash','fecha_nacimiento','email_cifrado','email_hash',
      'telefono_cifrado','telefono_hash','cobertura_nombre','cobertura_plan',
      'cobertura_nro_afiliado_cifrado') THEN RETURN false; END IF;
    IF (field IN ('nombre_cifrado','nombre_hash') AND NOT 'nombre'=ANY(p_selected)
        AND NOT (field='nombre_hash' AND 'apellido'=ANY(p_selected)))
      OR (field='apellido_cifrado' AND NOT 'apellido'=ANY(p_selected))
      OR (field IN ('tipo_doc','numero_doc_cifrado','dni_hash')
        AND NOT 'tipoDocumento'=ANY(p_selected))
      OR (field='fecha_nacimiento' AND NOT 'fechaNacimiento'=ANY(p_selected))
      OR (field IN ('email_cifrado','email_hash') AND NOT 'email'=ANY(p_selected))
      OR (field IN ('telefono_cifrado','telefono_hash') AND NOT 'telefono'=ANY(p_selected))
      OR (field='cobertura_nombre' AND NOT 'cobertura.nombre'=ANY(p_selected))
      OR (field='cobertura_plan' AND NOT 'cobertura.plan'=ANY(p_selected))
      OR (field='cobertura_nro_afiliado_cifrado'
        AND NOT 'cobertura.numeroAfiliado'=ANY(p_selected)) THEN RETURN false; END IF;
    IF field=ANY(base64_fields) THEN
      IF jsonb_typeof(value)<>'string' OR length(value#>>'{}')>17408 THEN RETURN false; END IF;
      BEGIN
        IF octet_length(decode(value#>>'{}','base64'))<29 THEN RETURN false; END IF;
      EXCEPTION WHEN invalid_parameter_value OR invalid_text_representation THEN RETURN false;
      END;
    ELSIF field IN ('nombre_hash','dni_hash','email_hash','telefono_hash') THEN
      IF jsonb_typeof(value)<>'string' OR (value#>>'{}') !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
    ELSIF field='tipo_doc' THEN
      IF jsonb_typeof(value)<>'string' OR (value#>>'{}') NOT IN
        ('DNI','LE','LC','CI','PASAPORTE') THEN RETURN false; END IF;
    ELSIF field='fecha_nacimiento' THEN
      IF jsonb_typeof(value)<>'string' OR (value#>>'{}') !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN false; END IF;
    ELSIF field='cobertura_nombre' THEN
      IF jsonb_typeof(value) NOT IN ('null','string') OR
        (jsonb_typeof(value)='string' AND (length(value#>>'{}') NOT BETWEEN 1 AND 120)) THEN RETURN false; END IF;
    ELSIF field='cobertura_plan' THEN
      IF jsonb_typeof(value)<>'string' OR length(value#>>'{}') NOT BETWEEN 1 AND 40 THEN RETURN false; END IF;
    END IF;
  END LOOP;
  IF (p_patch ? 'nombre_cifrado' OR p_patch ? 'apellido_cifrado')
    AND NOT p_patch ? 'nombre_hash' THEN RETURN false; END IF;
  IF (p_patch ? 'numero_doc_cifrado') <> (p_patch ? 'dni_hash')
    OR (p_patch ? 'email_cifrado') <> (p_patch ? 'email_hash')
    OR (p_patch ? 'telefono_cifrado') <> (p_patch ? 'telefono_hash') THEN RETURN false; END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION folio_intake_private.incorporation_patch_valid(jsonb,text[])
  FROM PUBLIC,anon,authenticated,service_role;
