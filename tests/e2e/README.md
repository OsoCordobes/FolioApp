# tests/e2e — specs end-to-end de Folio

Corren con el project `e2e` de Playwright contra `E2E_BASE_URL`
(default `http://localhost:3010`, el dev server de `pnpm dev`;
`reuseExistingServer=true` — si ya hay un server en 3010, lo reusa).

> ⚠️ **El dev server local apunta a la DB que tengas en `.env.local`**
> (hoy: producción). Los specs marcados como *escriben datos* crean filas
> REALES en esa base. Corrélos solo contra la org de prueba designada.

## Specs gateados por env (escriben / requieren credenciales)

### `booking-submit.spec.ts` — booking público real (✍️ ESCRIBE EN LA DB)

Flujo completo de `/book/<slug>` con submit: elegir servicio → slot →
datos → pantalla de éxito, más la carrera de doble reserva del mismo slot
(conflicto + retry con otro horario).

```powershell
$env:E2E_BOOKING_SLUG = "lautaro-folio"
pnpm exec playwright test tests/e2e/booking-submit.spec.ts --project=e2e
```

- **Org de prueba**: `lautaro-folio` (datos de muestra, owner
  `lautaro-folio-test@folio.app`, servicios activos y disponibilidad
  cargada). Está permitido crear reservas de prueba ahí — **no apuntar a
  ninguna otra org**.
- **Qué crea por corrida**: 3 reservas (pedidos y/o turnos auto-confirmados
  + pacientes nuevos) con nombre `E2E Spec Booking <fecha-hora>` y teléfono
  único `+54 9 351 5xx xxxx` derivado del timestamp. Sin email (no dispara
  notificaciones).
- **Cleanup**: desde la UI pública no se puede; queda documentado como TODO
  en el spec — borrar por patrón de nombre `E2E Spec Booking %` cuando haya
  acceso SQL de mantenimiento. Los nombres son greppables a propósito.
- **Captcha**: en dev no hay `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, el wizard no
  monta Turnstile y el server es fail-open sin secret. Con captcha real el
  spec no aplica tal cual.
- **Rate limit**: `createPedidoPublico` admite 5 submits/IP/hora cuando
  Upstash está configurado (el rate limit corre ANTES del chequeo de
  conflicto, así que el intento que falla por conflicto también cuenta).
  La corrida completa hace 4 submits (3 reservas + 1 conflicto); dos
  corridas en la misma hora pueden rebotar con "Demasiados intentos".

### `demo-path.spec.ts` — smoke del camino del médico (solo lectura)

Login con un usuario **existente** (no crea cuentas) → `/hoy` → abre y
cierra el modal de crear turno sin crear nada → `/calendario` →
`/pacientes`, validando que no haya errores de consola.

```powershell
$env:E2E_LOGIN_EMAIL = "lautaro-folio-test@folio.app"
$env:E2E_LOGIN_PASSWORD = "<password>"
pnpm exec playwright test tests/e2e/demo-path.spec.ts --project=e2e
```

Sin las envs, ambos specs se **skipean** (seguro por defecto en CI).

## Resto de los specs

Los demás specs del directorio (`book-public`, `public-card`, `not-found`,
`security-headers`, etc.) son de solo lectura o usan rutas `/dev/*` con
mocks. **Excepción histórica**: `auth.spec.ts` crea usuarios reales
(`e2e-test-<ts>@folio.app`) en la DB apuntada en cada corrida — no correrlo
contra producción salvo que se acepte ese residuo.

## Correr todo el project e2e

```powershell
pnpm exec playwright test --project=e2e
```

Los specs gateados se skipean salvo que sus envs estén seteadas.
