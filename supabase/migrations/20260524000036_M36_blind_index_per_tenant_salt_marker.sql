-- ════════════════════════════════════════════════════════════════════════════
-- M36 · Blind-index per-tenant salt marker (Sprint 1 T1.5.2)
-- Audit finding A2 · 2026-05-24
-- ════════════════════════════════════════════════════════════════════════════
--
-- Esta migration es un MARKER sin DDL real. Los blind indexes en
-- `paciente_identidad` (nombre_hash, dni_hash, telefono_hash) siguen siendo
-- texto/hash de 64 chars; el schema NO cambia.
--
-- Lo que cambia es el ALGORITMO DE CÓMPUTO:
--
--   Pre-M36: blindIndex(plain)         → HMAC(key, lower(trim(plain)))
--   Post-M36: blindIndex(plain, org_id) → HMAC(key, org_id + ":" + lower(trim(plain)))
--
-- Razón (audit A2): la HMAC key global es brute-forceable contra DNI argentino
-- (~99M combos) si la key leaks. El salt per-tenant multiplica el costo del
-- ataque por el número de orgs, conteniendo el blast radius.
--
-- Procedimiento de aplicación (rehash de datos existentes):
--
--   1. Deploy del código que escribe con salt + lee con fallback legacy
--      (Sprint 1 T1.5.3).
--   2. Backup PITR Supabase confirmado.
--   3. Ventana de baja actividad (madrugada).
--   4. Correr scripts/rehash-blind-indexes.mjs --dry-run → revisar output.
--   5. Si parece sano, --live.
--   6. Post-rehash: --verify (5 pacientes random tienen hash con salt).
--   7. Monitorear Sentry 1h: 0 fallbacks legacy logueados.
--   8. Tras 72h sin fallbacks, remover el código de lectura legacy
--      (Sprint 1 T1.5.5).
--
-- Rollback: restore de PITR (Supabase Pro plan, 7-day window). Los hashes
-- viejos sin salt quedan en el snapshot. RTO ~30 min.
--
-- ════════════════════════════════════════════════════════════════════════════

-- Marker idempotente: NOTICE en el log de Postgres + INSERT en
-- audit_log si la org "system" existe (para trace cuando esta migration
-- corra contra una DB no-vacía).
DO $$
BEGIN
  RAISE NOTICE 'M36 marker applied: blind-index per-tenant salt active. Run scripts/rehash-blind-indexes.mjs to backfill historical hashes.';
END $$;
