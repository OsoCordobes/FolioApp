-- M102: expand phase, compatible with the existing upload/signing UI.
-- Optional validation metadata and scope checks; no direct SDK policy changes.
-- Deploy authenticated upload/download code after this migration, smoke-test,
-- then apply M104 to close direct Storage and metadata writes.
-- No legacy objects/rows are rewritten/deleted; precheck scope anomalies.
ALTER TABLE public.documento_clinico
  ADD COLUMN content_sha256 text,
  ADD COLUMN validated_at timestamptz,
  ADD CONSTRAINT documento_validated_content CHECK (
    (content_sha256 IS NULL AND validated_at IS NULL) OR
    (content_sha256 IS NOT NULL AND content_sha256 ~ '^[0-9a-f]{64}$' AND validated_at IS NOT NULL AND tamanio_bytes <= 4194304)
  ) NOT VALID,
  ADD CONSTRAINT documento_bound_path CHECK (
    storage_bucket = 'documentos-clinicos'
    AND split_part(storage_path,'/',1) = storage_bucket
    AND split_part(storage_path,'/',2) = organization_id::text
    AND split_part(storage_path,'/',3) = paciente_id::text
    AND storage_path ~ '^documentos-clinicos/[0-9a-f-]+/[0-9a-f-]+/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\.[A-Za-z0-9]{1,12}$'
    AND strpos(split_part(storage_path,'/',4),'..') = 0
  ) NOT VALID;

CREATE UNIQUE INDEX documento_verified_object_unique
 ON public.documento_clinico(storage_path) WHERE content_sha256 IS NOT NULL AND deleted_at IS NULL;

CREATE FUNCTION public.documento_bound_entities() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.paciente p WHERE p.id=NEW.paciente_id AND p.organization_id=NEW.organization_id) THEN
  RAISE EXCEPTION 'document patient organization mismatch' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.member m WHERE m.id=NEW.subido_por_id AND m.organization_id=NEW.organization_id) THEN
  RAISE EXCEPTION 'document author organization mismatch' USING ERRCODE='23514';
 END IF;
 IF NEW.sesion_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM public.sesion s WHERE s.id=NEW.sesion_id AND s.paciente_id=NEW.paciente_id AND s.organization_id=NEW.organization_id
 ) THEN
  RAISE EXCEPTION 'document session patient mismatch' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.documento_bound_entities() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER documento_bound_entities_guard
 BEFORE INSERT OR UPDATE OF organization_id,paciente_id,sesion_id,subido_por_id ON public.documento_clinico
 FOR EACH ROW EXECUTE FUNCTION public.documento_bound_entities();

GRANT SELECT, INSERT, UPDATE ON public.documento_clinico TO service_role;

COMMENT ON COLUMN public.documento_clinico.content_sha256 IS
 'SHA-256 of server-validated bytes. NULL means legacy: the authenticated download endpoint still validates actual bytes, size and MIME on every read.';
