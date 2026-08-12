-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M96 · nota_clinica: la ficha como papel
-- ════════════════════════════════════════════════════════════════════════════
-- Pedido del dueño, verbatim del quiropráctico que está probando Folio: si no
-- usa Folio usa una ficha de papel, "y esa la agarra, la lee y la modifica
-- cuando quiere".
--
-- Hoy la ficha exige un turno ANCLA para escribir: sin turnos es read-only. Pero
-- la clínica no ocurre sólo dentro de un turno — el paciente llama por teléfono,
-- manda un WhatsApp preguntando por una reacción, el profesional recuerda algo
-- al día siguiente. Nada de eso tenía dónde vivir, así que se perdía o
-- terminaba deformando la nota de una visita a la que no pertenece.
--
-- `nota_clinica` es ese lugar: una anotación fechada, atribuida y cifrada,
-- colgada del PACIENTE y no de un turno.
--
-- ─── Append-only PURO ───────────────────────────────────────────────────────
-- Espejo de `sesion_enmienda` (M10), y por el mismo motivo: Ley 26.529 art. 15,
-- inviolabilidad de la historia clínica. Un typo se corrige con OTRA nota, como
-- la tinta. No hay UPDATE ni DELETE — ni por RLS, ni por trigger, ni para el
-- OWNER. La diferencia con `sesion` (que sí se edita mientras locked_at es
-- NULL) es deliberada: una sesión tiene una ventana de redacción durante la
-- consulta; una nota suelta nace cerrada.
--
-- ─── Quién la ve ────────────────────────────────────────────────────────────
-- Los roles clínicos de la org que ADEMÁS puedan ver la ficha del paciente: el
-- EXISTS sobre `paciente` encadena la RLS de esa tabla, así que hereda la
-- asignación de profesional (M32) y la caja fuerte (M03/M31) sin repetir la
-- regla acá — el mismo criterio que M94 aplicó a Storage y M95 a las tablas
-- clínicas hijas.
--
-- Entre profesionales de la misma org SÍ se ven: la ficha es del paciente, no
-- del profesional — igual que en papel, donde la carpeta está en el consultorio
-- y la lee quien lo atiende. La caja fuerte sigue siendo la excepción explícita.
--
-- El PORTAL DEL PACIENTE no tiene ninguna policy acá: no ve nada. Frontera
-- idéntica a la de `sesion` / `sesion_enmienda` (M71 la declara explícitamente).
--
-- Aditiva pura: tabla nueva, sin tocar nada existente.
-- Prefijo …098, número canónico M96.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE nota_clinica (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  paciente_id      uuid NOT NULL REFERENCES paciente(id) ON DELETE RESTRICT,
  -- RESTRICT como en sesion_enmienda.autor_id: la autoría de un registro
  -- clínico no se borra al dar de baja a un profesional.
  autor_id         uuid NOT NULL REFERENCES member(id) ON DELETE RESTRICT,
  texto_cifrado    bytea NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  -- Una nota vacía no es una nota. El largo del PLANTEXTO lo valida el writer
  -- (≤ 5000); acá sólo se exige que el ciphertext exista de verdad — el
  -- plaintext es ilegible para Postgres a propósito.
  CONSTRAINT nota_clinica_texto_no_vacio CHECK (octet_length(texto_cifrado) > 0)
);

-- El acceso natural es "las notas de esta ficha, de la más nueva a la más
-- vieja"; el índice por org sirve al timeline de auditoría.
CREATE INDEX nota_clinica_paciente_idx ON nota_clinica (paciente_id, created_at DESC);
CREATE INDEX nota_clinica_org_idx      ON nota_clinica (organization_id, created_at DESC);
-- FK sin índice → el DELETE de un member escanea la tabla entera (mismo criterio
-- que M46 aplicó al resto de las FKs).
CREATE INDEX nota_clinica_autor_idx    ON nota_clinica (autor_id);

COMMENT ON TABLE nota_clinica IS
  'Folio · M96 · anotación clínica fechada y atribuida, colgada del PACIENTE (no de un turno): la llamada telefónica, el WhatsApp, lo que el profesional recuerda al día siguiente. APPEND-ONLY PURO (Ley 26.529 art. 15): un error se corrige con otra nota, como la tinta. Sin acceso para el portal del paciente.';

-- ─── Coherencia de organización ─────────────────────────────────────────────
-- El paciente y el member autor tienen que ser de la MISMA org que la nota.
-- Sin esto, un INSERT que pase la RLS (que valida la org de la fila) podría
-- colgar la nota de un paciente de otro tenant.
CREATE OR REPLACE FUNCTION nota_clinica_validate_same_org()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM paciente p
     WHERE p.id = NEW.paciente_id AND p.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'nota_clinica.paciente_id debe ser de la misma organización'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM member m
     WHERE m.id = NEW.autor_id AND m.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'nota_clinica.autor_id debe ser member de la misma organización'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER nota_clinica_same_org_guard
  BEFORE INSERT ON nota_clinica
  FOR EACH ROW EXECUTE FUNCTION nota_clinica_validate_same_org();

-- ─── Append-only: ni UPDATE ni DELETE, para nadie ───────────────────────────
-- Doble candado a propósito: las policies cubren a `authenticated` vía
-- PostgREST; el trigger cubre además a `service_role` y a cualquier función
-- SECURITY DEFINER que se escriba en el futuro sin acordarse de esta regla.
CREATE OR REPLACE FUNCTION nota_clinica_prevent_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'nota_clinica es append-only (Ley 26.529 art. 15): para corregir, agregá otra nota'
    USING ERRCODE = '42501';
END
$$;

CREATE TRIGGER nota_clinica_no_update
  BEFORE UPDATE ON nota_clinica
  FOR EACH ROW EXECUTE FUNCTION nota_clinica_prevent_write();

CREATE TRIGGER nota_clinica_no_delete
  BEFORE DELETE ON nota_clinica
  FOR EACH ROW EXECUTE FUNCTION nota_clinica_prevent_write();

-- ─── Audit (Ley 26.529 art. 18) ─────────────────────────────────────────────
-- Sólo INSERT: es lo único que puede pasar. El timeline de la ficha lo lee de
-- audit_log sin necesitar una query propia.
CREATE TRIGGER nota_clinica_audit
  AFTER INSERT ON nota_clinica
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

-- ─── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE nota_clinica ENABLE ROW LEVEL SECURITY;
ALTER TABLE nota_clinica FORCE ROW LEVEL SECURITY;

-- El EXISTS sobre `paciente` se evalúa bajo la RLS de esa tabla: hereda gratis
-- la asignación del profesional (M32) y la caja fuerte (M03/M31).
CREATE POLICY nota_clinica_select_clinical
  ON nota_clinica FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
    AND EXISTS (
      SELECT 1 FROM public.paciente p
       WHERE p.id = nota_clinica.paciente_id
         AND p.organization_id = nota_clinica.organization_id
    )
  );

CREATE POLICY nota_clinica_insert_clinical
  ON nota_clinica FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
    -- La autoría no se declara: se deriva de quién está escribiendo.
    AND autor_id = public.user_member_id_in(organization_id)
    AND EXISTS (
      SELECT 1 FROM public.paciente p
       WHERE p.id = nota_clinica.paciente_id
         AND p.organization_id = nota_clinica.organization_id
    )
  );

-- UPDATE / DELETE: sin policy Y con trigger. Con FORCE RLS, la ausencia de
-- policy ya deniega; el USING (false) explícito documenta la intención para
-- quien lea el esquema.
CREATE POLICY nota_clinica_no_update ON nota_clinica FOR UPDATE USING (false);
CREATE POLICY nota_clinica_no_delete ON nota_clinica FOR DELETE USING (false);

COMMENT ON POLICY nota_clinica_select_clinical ON nota_clinica IS
  'M96 · rol clínico de la org + ficha del paciente visible (el EXISTS encadena la RLS de paciente: asignación M32 + caja fuerte M03/M31). Entre profesionales de la org se ven: la ficha es del paciente. El portal no tiene policy: no ve nada.';
