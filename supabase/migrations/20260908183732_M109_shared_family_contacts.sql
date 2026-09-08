-- Phone numbers are contact channels. A household may share one number.
-- No records, ciphertext, hashes, links, or existing DNI constraints change.
-- The non-unique org/phone search index from M30 remains in place.
DROP INDEX IF EXISTS public.paciente_identidad_telefono_unique_active;

COMMENT ON COLUMN public.paciente_identidad.telefono_hash IS
  'HMAC-SHA256 contact lookup scoped by organization. Non-unique: shared family phone numbers never establish patient identity or authorize linking records.';
