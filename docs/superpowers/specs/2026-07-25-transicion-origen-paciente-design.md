# M91 · Atribución `paciente` en el log de transiciones de turno

**Fecha:** 2026-07-25 · **Estado:** aprobado · **Migración:** M91

## Problema

Cuando un paciente cancela su turno, la fila que queda en `transicion` dice que
lo hizo el consultorio a mano:

```sql
-- turno_record_transition(), definición vigente (M57:50-53)
INSERT INTO transicion (turno_id, from_estado, to_estado, ts, actor_id, trigger_origin)
VALUES (NEW.id, prev_estado, NEW.estado, now(),
        public.user_member_id_in(NEW.organization_id),
        coalesce(current_setting('folio.transition_origin', true), 'manual'));
```

Sin sesión de staff, `user_member_id_in` devuelve `NULL` y el GUC nunca está
seteado, así que la fila sale `trigger_origin='manual'`, `actor_id=NULL` — la
misma firma que una cancelación de mostrador. En un producto que guarda PHI y
cuyo log de transiciones es append-only, el registro miente.

Son **tres** los caminos afectados, no uno:

| Camino | Archivo | Hoy |
|---|---|---|
| Email 1-click · cancelar | `app/(public)/t/[token]/actions.ts:109` | `'manual'`, sin atribución en ningún lado |
| Email 1-click · confirmar | mismo archivo | `'manual'` en `transicion`; sólo `turno.confirmado_via` dice la verdad |
| Portal · cancelación self-service | `lib/db/portal-turnos.ts:346` | `'manual'`, sin atribución |

## Hallazgos que definieron el diseño

**1. El GUC ya se lee, desde M09.** El trigger consulta
`current_setting('folio.transition_origin', true)` desde su primera versión y
M57 lo preservó. No hace falta tocar `turno_record_transition()`. Lo que falta
es que *alguien lo escriba*: PostgREST corre cada statement en su propia
transacción, así que un `.rpc("set_config")` separado no sobrevive hasta el
`UPDATE`. La única forma es una función que haga `set_config` y el `UPDATE` en
el mismo cuerpo.

**2. Una columna espejo `turno.cancelado_via` no es viable.** El guard de M84
hace un diff de fila completa contra tampering
(`supabase/migrations/20260706000086_M84_portal_turno_self_service.sql:229`):

```sql
IF (to_jsonb(NEW) - 'estado') IS DISTINCT FROM (to_jsonb(OLD) - 'estado') THEN
  RAISE EXCEPTION 'portal: sólo se puede cambiar el estado a CANCELADO, no otros campos del turno'
```

Cualquier columna nueva que escriba el path del paciente queda rechazada. Y aun
resolviendo eso, la columna no arregla `transicion`, que es la tabla de
auditoría real.

**3. El guard de M84 ya sabe que el actor es el paciente.** Es `BEFORE UPDATE`
y `turno_transition_log` es `AFTER`: corren en la misma transacción, en ese
orden. Un `set_config(..., is_local => true)` dentro del guard lo lee el trigger
de log sin ningún cambio en el código de la app.

## Diseño

### Migración M91 — `20260725000093_M91_transicion_origen_paciente.sql`

**(a) Ensanchar el CHECK.** `transicion_trigger_origin_valid` hoy permite
`manual | auto | webhook | walk_in | system`. Se le suma `paciente` con
`DROP CONSTRAINT` + `ADD CONSTRAINT` en migración nueva (M09 es append-only).
Es un ensanchamiento puro: toda fila existente pasa, así que valida inline sin
riesgo.

**(b) `public.turno_transicion_paciente(uuid, text, text[])`** — `SECURITY
DEFINER`, `plpgsql`. Setea el GUC y corre el mismo CAS que hoy hace la action:

```sql
perform set_config('folio.transition_origin', 'paciente', true);
return query
  with upd as (
    update public.turno t
       set estado = p_to::estado_turno,
           confirmado_via = case when p_to = 'CONFIRMADO' then 'paciente'
                                 else t.confirmado_via end
     where t.id = p_turno_id
       and t.deleted_at is null
       and t.estado = any (p_from::estado_turno[])
    returning t.id
  )
  select id from upd;
```

Se rechaza cualquier `p_to` fuera de `('CONFIRMADO','CANCELADO')` para mantener
la función angosta. `REVOKE` de `public, anon, authenticated` + `GRANT EXECUTE`
sólo a `service_role`.

*No agrega privilegio nuevo*: el llamador ya es el service client (BYPASSRLS),
que hoy puede escribir cualquier turno con un `UPDATE` directo. La función sólo
suma el GUC y encierra el CAS.

`atendiendo_desde` no se toca: `CONFIRM_CAS_FROM` (`lib/booking/confirm-decision.ts:52`)
sólo admite origen `AGENDADO`/`CONFIRMADO`, estados en los que la columna ya es
`NULL` por el CHECK `turno_atendiendo_consistency`.

El guard de M84 es no-op acá: sin `auth.uid()`, `paciente_owns` devuelve false y
la función retorna temprano.

**(c) `CREATE OR REPLACE turno_portal_cancel_guard()`** con el cuerpo completo
de M84 (estilo casa, igual que hizo M57 con `turno_record_transition`), sumando
`perform set_config('folio.transition_origin','paciente',true)` justo antes del
`RETURN NEW` final — después de las salidas tempranas de staff/no-dueño y de las
cuatro validaciones. Se preserva `LANGUAGE plpgsql SET search_path = public` sin
`SECURITY DEFINER` (setear un GUC no requiere privilegio).

*Caveat documentado:* `is_local => true` deja el GUC seteado para el resto de la
transacción. En el path del portal el `UPDATE` es de una sola fila por id, y en
PostgREST cada request es su propia transacción, así que no hay filtración entre
requests ni entre filas.

### Código

**`app/(public)/t/[token]/actions.ts`** — el `.from("turno").update(patch)…`
pasa a `.rpc("turno_transicion_paciente", { p_turno_id, p_to, p_from })`. La
decisión pura, el re-read-and-redecide ante CAS perdido y los side-effects
post-respuesta quedan igual. Cero filas devueltas sigue significando "carrera",
como hoy.

**Chip — `lib/db/cancelado-por-paciente.ts`** (nuevo). Lectura batch desde
`transicion`, no desde una columna espejo:

```sql
select turno_id from transicion
 where turno_id in (...) and to_estado = 'CANCELADO' and trigger_origin = 'paciente'
```

Devuelve un `Set<string>`, fail-soft con `console.warn` igual que
`lib/db/confirmado-via.ts`. Una sola fuente de verdad, y cubre los dos caminos
del paciente (email y portal) sin trabajo extra. La RLS de `transicion`
(`transicion_select_scoped`, M09:464) scopea vía el `EXISTS` sobre `turno`, así
que el staff ve exactamente las transiciones de los turnos que ya puede ver.

**Superficies del chip** — las dos únicas donde hoy se ve un turno `CANCELADO`:

- `components/hoy/turno-list.tsx:198-207`, en la línea de meta de la sección
  "Cancelados / No asistió" (colapsada por default).
- `components/calendario/turno-detalle-modal.tsx:163-170`, junto al chip M90.
  Sólo llega desde la grilla semanal — el mes filtra `CANCELADO`
  (`lib/db/calendario.ts:785`).

Clase nueva `.fi-chip-canc-paciente`, gemela de `.fi-chip-conf-paciente`
(`public/folio.css:20707-20722`) pero con `--slate-soft` / `--slate`: es
atribución, no error, así que el rojo sobre-señaliza.

## Rollout

Escalonado, según la disciplina de deploy del repo:

1. `node scripts/push-pending-migrations.mjs` → M91 a producción. Las tres
   partes van en una transacción, así que el guard nunca puede setear
   `'paciente'` contra un CHECK todavía sin ensanchar.
2. Recién ahí se mergea el código. Entre (1) y (2) el path del portal ya audita
   bien y el del email sigue como hoy — sin ventana rota.

## Verificación

- Gates: `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm build`.
- M91 tiene que replayar en `postgres:16` vanilla. No hay referencias hacia
  adelante (todo lo que toca existe desde M09/M84), así que no necesita
  `set check_function_bodies = off`.
- pgTAP nuevo `tests/sql/M91_transicion_origen_paciente.spec.sql`:
  - el CHECK acepta `'paciente'` y sigue rechazando basura;
  - `turno_transicion_paciente` deja `transicion.trigger_origin='paciente'`;
  - un `UPDATE` de staff sigue dejando `'manual'`;
  - una cancelación de portal deja `'paciente'`;
  - la función está revocada para `anon`/`authenticated`.

## Fuera de alcance

- **`transicion_select_scoped` es legible por el paciente de portal.** M71 sumó
  `turno_select_portal`, y como las policies PERMISSIVE se OR-ean, una cuenta de
  portal puede leer el log de transiciones de sus propios turnos, incluido el
  `actor_id` del staff. Es previo a este trabajo y no lo empeora, pero conviene
  angostarlo en un PR aparte.
- El booking público auto-confirma insertando el turno ya en `CONFIRMADO`
  (`lib/db/pedidos.ts:342` vía `app/(public)/book/[slug]/actions.ts:449`). Es un
  `INSERT`, no una transición de estado, y merece su propio origen
  (`'walk_in'`/`'booking'`) en otro PR.
- Backfill de filas históricas: no se toca. Las transiciones viejas quedan
  `'manual'` — no hay forma de reconstruir el origen a posteriori.
