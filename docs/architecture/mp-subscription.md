# Mercado Pago · Suscripción mensual de Folio

> Cómo configurar, operar y debuggear la integración de cobro de Folio (M19, mayo 2026).

## Resumen

- **Modelo de negocio**: 30.000 ARS/mes fijos por organización (consultorio).
- **Folio es merchant directo**: el dinero entra a la cuenta MP de Folio. No es marketplace.
- **Sin OAuth de profesional**: el `MP_ACCESS_TOKEN` es de Folio. El profesional solo autoriza el preapproval con su tarjeta.
- **Grace period**: 7 días desde el alta de la org antes de exigir suscripción activa.

## Componentes

| Componente | Ruta | Responsabilidad |
|---|---|---|
| Schema | `supabase/migrations/20260520000019_M19_suscripcion.sql` | Tablas `suscripcion` + `cargo_suscripcion`, RLS solo OWNER |
| MP client | `lib/mercadopago/client.ts` | Wrapper REST sobre `api.mercadopago.com` |
| Webhook security | `lib/mercadopago/webhook-security.ts` | HMAC-SHA256 sobre manifest `id:<id>;request-id:<rid>;ts:<ts>;` |
| DB helpers | `lib/db/suscripcion.ts` | CRUD + lógica pura de gating (`computeAccessGate`) |
| Webhook handler | `app/api/mercadopago/webhook/route.ts` | Recibe eventos, valida firma, idempotente |
| Server Actions | `app/(app)/configuracion/billing/actions.ts` | `activate`, `cancel`, `refresh` |
| Página | `app/(app)/configuracion/billing/page.tsx` | Server Component, sólo OWNER |
| UI | `components/billing/billing-page.tsx` | Client Component |
| Gating | `app/(app)/layout.tsx` + `lib/db/active-context.ts` + `middleware.ts` | Redirect si grace vencido y no activa |

## Setup en MP Developers

1. Crear app en [https://www.mercadopago.com.ar/developers/panel/app](https://www.mercadopago.com.ar/developers/panel/app).
2. **Credenciales**: copiar `Access Token` (modo **Test** primero, **Production** después) → `MP_ACCESS_TOKEN`.
3. **Webhooks**: en la sección "Configurar notificaciones":
   - URL: `https://app.folio.ar/api/mercadopago/webhook` (o ngrok para local).
   - Eventos a suscribir: `subscription_preapproval`, `subscription_authorized_payment`.
   - Copiar la "Clave secreta" → `MP_WEBHOOK_SECRET`.

## Cambiar el precio del plan

El precio es source of truth en `lib/mercadopago/client.ts`:

```ts
export const MP_PLAN_PRICE_CENTS = 3000000;  // 30.000 ARS
```

Para subir a 35.000:

1. Editar la constante en `client.ts` (afecta a preapproval **nuevos**).
2. Actualizar `NEXT_PUBLIC_MP_PLAN_PRICE_ARS` en Vercel env.
3. Para los preapproval **existentes**, hacer un script one-shot que itere `suscripcion` con `estado=ACTIVA` y haga `PUT /preapproval/{id}` con `{ auto_recurring: { transaction_amount: 35000 } }`.

## Flujo end-to-end (manual smoke test)

```
1. signup nuevo → onboarding → cae a /hoy.
2. UPDATE organization SET created_at = now() - interval '8 days' WHERE id = '<org_id>';
   (simula grace expired).
3. Refrescar cualquier ruta /app → redirect a /configuracion/billing?gate=grace_expired.
4. Click "Activar suscripción" → action crea preapproval en MP → redirect a init_point.
5. En MP, autorizar con tarjeta test:
     APRO 5031 7557 3453 0604 / 11/30 / 123 / Nombre: APRO
   (más tarjetas: https://www.mercadopago.com.ar/developers/es/docs/checkout-api/integration-test/test-cards)
6. MP redirige a /configuracion/billing?activation=ok.
7. Webhook subscription_preapproval llega → suscripcion.estado=ACTIVA.
8. /hoy ya funciona sin redirect.
```

## Idempotencia del webhook

`cargo_suscripcion.mp_payment_id` tiene UNIQUE constraint. Si MP reenvía el mismo webhook:

- `recordChargeAttempt` hace INSERT que choca con 23505.
- El handler ignora ese error específico y devuelve 200.
- No se duplica el cargo.

## Cuándo MP cancela automáticamente

Después de **3 cobros consecutivos fallidos** (en una ventana de ~10 días con 4 reintentos automáticos), MP cancela el preapproval. Llega webhook `subscription_preapproval` con `status=cancelled` → `suscripcion.estado=CANCELADA`. El usuario debe crear un preapproval nuevo (no se puede "revivir" uno cancelado).

## Debugging

### El webhook no llega
- Verificar que la URL del webhook en panel MP es accesible públicamente (probar con `curl -i https://...`).
- Revisar el log de "Notificaciones" en el panel MP — ahí muestra cada intento + respuesta de Folio.
- Si Folio devolvió 403 → revisar `MP_WEBHOOK_SECRET` (debe coincidir con el del panel).

### El estado local no coincide con MP
- OWNER tiene un botón "Refrescar estado" en `/configuracion/billing` que llama `refreshSubscriptionAction()` → GET a MP + apply.
- Si seguís viendo discrepancia, mirar `cargo_suscripcion.raw_payload` para entender qué llegó del webhook.

### Tarjeta del profesional vence
- MP intenta cobrar → falla → estado pasa a MOROSA → después de 3 fallos → CANCELADA.
- El UI ofrece "Volver a activar" que crea un preapproval nuevo (con tarjeta nueva).

## Rotación del access token

1. Panel MP → "Credenciales" → "Restablecer".
2. Copiar nuevo token → setear en Vercel env `MP_ACCESS_TOKEN`.
3. Re-deploy. Los preapproval existentes siguen funcionando (no están atados al token).

## Rotación del webhook secret

1. Panel MP → "Webhooks" → "Restablecer clave secreta".
2. Copiar → Vercel env `MP_WEBHOOK_SECRET`.
3. Re-deploy.

Durante la rotación (~30s) los webhooks van a fallar la validación → MP reintenta hasta 3 veces → no perdemos eventos siempre que el deploy termine en <5 min.

## Cuándo NO usar este sistema

- Si querés que el paciente le pague AL PROFESIONAL vía Folio: eso requiere "MP Marketplace" con OAuth + `application_fee`. Está fuera de scope (ver el plan en `crea-un-plan-primero-linear-mitten.md`, sección "Modelo descartado").
- Si querés cobrar AFIP IVA: F10 incluye facturación AFIP automática de Folio al profesional. Por ahora, el comprobante del cobro es el de MP.
