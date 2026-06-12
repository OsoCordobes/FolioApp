-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M53 spec · slot_ocupado con exclusión de pedido
-- ════════════════════════════════════════════════════════════════════════════
-- Verifica:
--   1. Existe UNA sola versión de slot_ocupado (4 args) — la de 3 args fue
--      dropeada (un overload vivo sería ambiguo para PostgREST).
--   2. Un pedido PENDIENTE solapado cuenta como ocupado (semántica M44).
--   3. Con p_exclude_pedido = ese pedido, el slot queda libre (fix del
--      auto-conflicto del booking público).
--   4. La exclusión de un id ajeno NO destapa el conflicto real.
--   5. Llamada con 3 args (default) sigue funcionando = ocupado.
--
-- Fixtures como superuser (bypass RLS), patrón de M30/M49/M50 specs.
-- canal TELEFONO para no disparar pedido_web_requires_consent (M39).
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_org      uuid := gen_random_uuid();
  v_pedido   uuid := gen_random_uuid();
  v_inicio   timestamptz := date_trunc('hour', now() + interval '2 day');
  v_fin      timestamptz;
  v_count    int;
  v_ocupado  boolean;
BEGIN
  v_fin := v_inicio + interval '30 minutes';

  -- ── 1. una sola firma de slot_ocupado ─────────────────────────────────────
  -- (la ARIDAD exacta la asserta el spec de la última migración que la cambió
  --  — hoy M54 con 6 args; este spec solo exige que no haya overloads, que es
  --  lo que ambiguaría la resolución de PostgREST)
  SELECT count(*) INTO v_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'slot_ocupado';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'M53 spec FAIL: % versiones de slot_ocupado (esperada 1 — overloads ambiguan PostgREST)', v_count;
  END IF;

  -- ── fixtures ──────────────────────────────────────────────────────────────
  INSERT INTO organization (id, slug, nombre)
    VALUES (v_org, 'm53-spec', 'M53 Slot Exclude Spec');
  INSERT INTO pedido (id, organization_id, canal, estado, nombre_cifrado,
                      fecha_propuesta, duracion_min)
    VALUES (v_pedido, v_org, 'TELEFONO', 'PENDIENTE', '\x00'::bytea,
            v_inicio, 30);

  -- ── 2. pedido PENDIENTE solapado → ocupado ────────────────────────────────
  SELECT slot_ocupado(v_org, v_inicio, v_fin, NULL) INTO v_ocupado;
  IF v_ocupado IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'M53 spec FAIL: pedido PENDIENTE solapado no cuenta como ocupado';
  END IF;

  -- ── 3. excluyendo el propio pedido → libre ────────────────────────────────
  SELECT slot_ocupado(v_org, v_inicio, v_fin, v_pedido) INTO v_ocupado;
  IF v_ocupado IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'M53 spec FAIL: excluir el propio pedido no libera el slot (auto-conflicto sigue)';
  END IF;

  -- ── 4. excluir un id ajeno no destapa el conflicto ────────────────────────
  SELECT slot_ocupado(v_org, v_inicio, v_fin, gen_random_uuid()) INTO v_ocupado;
  IF v_ocupado IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'M53 spec FAIL: exclusión de id ajeno destapó un conflicto real';
  END IF;

  -- ── 5. llamada con 3 args (default NULL) sigue andando ────────────────────
  SELECT slot_ocupado(v_org, v_inicio, v_fin) INTO v_ocupado;
  IF v_ocupado IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'M53 spec FAIL: llamada de 3 args (default) no detecta el pedido';
  END IF;

  RAISE NOTICE 'M53 spec OK';
END $$;
