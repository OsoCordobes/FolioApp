# Informe de implementación: preflight clínico

Fecha: 2026-09-12

Rama: `codex/launch-reliability`

Base recibida y verificada: `783f85c6b4d443659ef44124b1e0b632820e6fa1`

## Resultado

- El ensayo clínico usa exclusivamente `http://127.0.0.1:4420`; el runner común conserva su default `4410`.
- `run-clinical.mjs` construye el default clínico y valida el perfil completo 4420/54321/54322 antes de iniciar `run-browser.mjs`. Un override explícito a otro puerto se rechaza.
- El perfil local de Auth sólo permite el origen y los redirects locales en 4420.
- El conteo final de pagos deriva la organización con `pago.turno_id → turno.organization_id` mediante `JOIN`.
- Las lecturas AAL1 protegidas aceptan únicamente una lista vacía sin error o `42501` sin filas. Filas visibles, formas incompletas y otros errores siguen fallando.

No se usaron datos reales, archivos de entorno, proveedores, Docker, Supabase, una base ni producción.

## RED → GREEN

RED del puerto, antes de cambiar la implementación:

```text
pnpm test:unit -- tests/unit/clinical-fixture-safety.test.ts
```

Salida: exit 1; 4 pasaron y 2 fallaron. El caso positivo en 4420 y el bootstrap sintético fallaron con `Clinical integration requires the dedicated 4410/54321/54322 local profile.`

RED de AAL1, antes de agregar la aserción reusable:

```text
pnpm test:unit -- tests/unit/clinical-fixture-safety.test.ts
```

Salida: exit 1; 4 pasaron y 3 fallaron. Además de las fallas del puerto, la matriz AAL1 falló con `assertAal1ProtectedRead is not a function`. La matriz ya incluía la respuesta sintética válida `{data:null,error:{code:'42501'}}`, incompatible con las expectativas estrictas anteriores de `error === null` y `data === []`.

GREEN focal después de implementar:

```text
pnpm test:unit -- tests/unit/clinical-fixture-safety.test.ts
```

Salida: exit 0; 8/8 pasaron.

## Verificación final

```text
pnpm test:unit -- tests/unit/clinical-fixture-safety.test.ts tests/unit/test-isolation.test.ts
```

Salida: exit 0; 18/18 pasaron.

```text
pnpm typecheck
```

Salida: exit 0.

```text
pnpm exec eslint scripts/testing/clinical-config.mjs scripts/testing/clinical-config.d.mts scripts/testing/run-clinical.mjs tests/unit/clinical-fixture-safety.test.ts tests/e2e/clinical-path.spec.ts
```

Salida: exit 0, sin diagnósticos.

```text
node --input-type=module -e "import assert from 'node:assert/strict';import {testAppConfig} from './scripts/testing/app-config.mjs';assert.equal(testAppConfig({}).appUrl,'http://127.0.0.1:4410');console.log('generic runner default: 4410')"
```

Salida: exit 0 con `generic runner default: 4410`.

El comando se ejecutó con `FOLIO_TEST_SUPABASE_URL`, ambas claves locales, `FOLIO_TEST_DATABASE_URL`, `E2E_BASE_URL` y `FOLIO_TEST_CLINICAL` eliminadas del entorno del proceso:

```text
node scripts/testing/run-clinical.mjs
```

Salida observada y esperada: exit 1 con `FOLIO_TEST_ISOLATION` y `Clinical integration requires explicit local Supabase URL, both local JWT keys and its local database URL.` El fallo ocurrió en `testAppConfig`, antes de crear el child de `run-browser.mjs`.

Con URLs y JWT legacy exclusivamente sintéticos se ejecutó:

```text
node scripts/testing/run-clinical.mjs --list
```

Salida: exit 0; descubrió 7 tests en `tests/e2e/clinical-path.spec.ts`. Esto prueba sólo descubrimiento; no inició los escenarios ni acredita Auth, TOTP, Storage, RLS, SQL, navegador o aplicación reales.

## Revisión SQL y pendientes reales

`supabase/migrations/20260518000009_M09_servicios_turnos.sql` define `turno.organization_id` y `pago.turno_id`; no define `pago.organization_id`. El conteo corregido usa:

```sql
SELECT count(*)::int
FROM public.pago p
JOIN public.turno t ON t.id = p.turno_id
WHERE t.organization_id = $1
```

La revisión estática del resto del SQL y las RPC del fixture contra las migraciones no encontró incompatibilidades adicionales.

El coordinador ejecutó `.flow/launch-reliability/clinical-count-proof.sql` en una base PostgreSQL 16 nueva con las 113 migraciones del checkout. Su log registra el RED `42703` para `pago.organization_id` y el GREEN del `JOIN`, que devolvió cero filas para una organización sintética sin uso. El baseline aportado por el coordinador también registra 60/60 specs SQL. Esta ejecución no fue realizada por este agente, no usó el perfil clínico PostgreSQL 17 y no acredita Auth, TOTP, Storage, RLS vía API, navegador ni aplicación.

Este agente no inició ni conectó Docker, Supabase o DB. Queda pendiente ejecutar el recorrido completo sobre el perfil clínico PostgreSQL 17 con Auth/Storage sin omisiones.

## Alcance de archivos

Se modificaron únicamente los ocho archivos permitidos que requirió la solución y este informe exigido por el plan. No se tocó `finanzas/actions.ts`, su prueba ni ningún archivo de entorno.
