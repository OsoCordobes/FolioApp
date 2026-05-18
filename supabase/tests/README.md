# Folio · pgTAP tests

Suite de tests RLS + state machine + append-only + pseudonimización.

## Pre-requisitos

```bash
# Iniciar Supabase local
supabase start

# Aplicar migrations
supabase db reset

# Instalar pgtap (una sola vez por DB)
psql "$SUPABASE_DB_URL" -c "CREATE EXTENSION IF NOT EXISTS pgtap"
```

## Correr todos los tests

```bash
# Suite completa
for f in supabase/tests/[0-9]*.sql; do
  echo "▶ $f"
  psql "$SUPABASE_DB_URL" -f "$f"
done
```

## Tests individuales

```bash
psql "$SUPABASE_DB_URL" -f supabase/tests/01_helpers.sql
psql "$SUPABASE_DB_URL" -f supabase/tests/02_tenancy_rls.sql
# ...
```

## Coverage

| Test | Cubre |
|---|---|
| 01_helpers.sql | `user_org_ids`, `user_role_in`, `can_read_clinical`, `can_read_admin`, `user_member_id_in`, `user_has_scope_over`, `hmac_blind` + SECURITY DEFINER + search_path |
| 02_tenancy_rls.sql | Tenant isolation Organization, PacienteIdentidad cross-org (no debe ver) |
| 03_paciente_split_rls.sql | ASISTENTE ve PII pero no PHI; PROFESIONAL dueño ve ambas; DIRECTOR colegiado vs no-colegiado |
| 04_sesion_append_only.sql | locked_at enforcement, sesion_enmienda append-only puro |
| 05_turno_state_machine.sql | Transiciones válidas + inválidas + log automático |
| 06_pseudonimizacion.sql | Solo OWNER/DIRECTOR, motivo required, dry_run, ejecución, idempotencia |
| 07_audit_log.sql | Triggers genéricos en paciente/sesion, payload before/after, append-only |

## Cuando agregar tests

- Cada nueva tabla en una migration → 3 tests mínimo (existence, tenant isolation, role-based access)
- Cada nuevo stored proc → 1 test happy path + 1 test failure mode + 1 test edge case
- Cada cambio en RLS policy → re-correr la suite completa y confirmar verde
