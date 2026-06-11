# LAUNCH RUNBOOK — Folio

> Documento operativo del día de lanzamiento. **es-AR.** Conciso y accionable.
> Lo usa el operador (vos) para llevar a Folio a producción con el primer
> cliente real. Orden de uso: **(1) Pre-vuelo de envs → (2) Verificación
> go-live → (3) Recomendaciones fuertes → (4) tener a mano Rollback y Gaps.**
>
> Contexto: `master` auto-deploya a producción (Vercel, región `gru1`). El
> cliente Supabase está tipado `<any>` — un env faltante o un mismatch de
> schema no rompe en compile-time, falla en runtime. De ahí este pre-vuelo.

---

## 1. Pre-vuelo de envs en producción (Vercel)

Setear en **Vercel → Project → Settings → Environment Variables (Production)**.
La columna "Si falta" dice el modo de falla: **ROMPE** = la feature/app no
funciona; **DEGRADA** = sigue andando con capacidad reducida.

### 1.1 CRÍTICAS — tienen que estar antes de tocar al cliente

| Env | Para qué | Si falta |
|-----|----------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase (cliente + server + middleware). | **ROMPE** — no hay app: middleware y todos los clientes Supabase fallan al instanciar. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Key pública para el cliente browser/SSR. | **ROMPE** — sesión/auth no funciona; queries del cliente fallan. |
| `SUPABASE_SERVICE_ROLE_KEY` | Cliente service-role (BYPASSRLS) para ops privilegiadas, crones, health. | **ROMPE** — `requireEnv` tira en `lib/supabase/server.ts`; crones, health-check DB, onboarding, webhooks caen. |
| `FOLIO_ENC_KEY` | AES-256-GCM de columnas `*_cifrado` (PII/PHI app-side). 32 bytes base64. | **ROMPE** — toda lectura/escritura de PII/PHI cifrada tira; `/api/health` reporta `checks.env.ok=false` → 503. |
| `FOLIO_ENC_HMAC_KEY` | HMAC-SHA256 de blind indexes (`nombre_hash`/`dni_hash`/`telefono`). 32 bytes base64. | **ROMPE** — búsqueda por nombre/DNI/teléfono y alta de paciente fallan al derivar el índice. |
| `NEXT_PUBLIC_APP_URL` | URL canónica (`https://...`). Back-URLs de MP, links de invitación, password-reset. | **DEGRADA fuerte** — hay fallback a `VERCEL_URL` y por último `localhost:3010`; sin setearla, los links de invitación/reset y el back de MP pueden apuntar mal. Setearla a la URL real de prod. |
| `MP_ACCESS_TOKEN` | Token de Folio (merchant directo) para crear preapproval y resolver pagos. | **ROMPE billing** — `requireEnv` tira al activar suscripción o procesar webhook de cobro. |
| `MP_WEBHOOK_SECRET` | Secreto de firma HMAC de los webhooks de MP. | **ROMPE activación** — en prod el webhook se rechaza sin firma válida → la suscripción nunca pasa a ACTIVA automáticamente. |
| `CRON_SECRET` | Bearer que autentica los Vercel Crons. | **ROMPE crones** — todo `/api/cron/*` responde 401; recordatorios, reconciliación de billing, mantenimiento de particiones de `audit_log` y renovación de watches de Google no corren. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Site key del captcha (signup, login, booking público). | **ROMPE/DEGRADA** — en prod el captcha es obligatorio; sin la site key el widget no carga y el form no se puede enviar. |
| `TURNSTILE_SECRET_KEY` | Verificación server-side del token de Turnstile. | **ROMPE** — la validación del captcha falla → signup/login/booking rechazados. |
| `NEXT_PUBLIC_SENTRY_DSN` | Error tracking (client + server + edge). | **DEGRADA** — la app anda, pero te quedás ciego ante errores en prod el día del lanzamiento. Tratarla como crítica para el go-live. |

> **Nota cifrado**: `FOLIO_ENC_KEY` y `FOLIO_ENC_HMAC_KEY` son las "keys de
> cifrado app-side". NUNCA se commitean. Si ya hay datos cifrados en prod, NO
> las cambies sin re-encrypt (ver `scripts/rotate-enc-key.ts`).

### 1.2 OPCIONALES — la app arranca sin ellas; habilitan o endurecen features

| Env | Para qué | Si falta |
|-----|----------|----------|
| `RESEND_API_KEY` | Envío real de emails (invitación de equipo, confirmación de turno). | **DEGRADA** — `sendEmail` loguea en vez de enviar (fail-safe). La UI da link copiable. **Recomendado setear** (ver §3). |
| `EMAIL_FROM` | Remitente de los emails (Resend). | **DEGRADA** — sin remitente válido el envío de Resend falla aunque haya API key. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Backend del rate-limit (signup/login/booking/invitación). | **DEGRADA (riesgo)** — sin Upstash el rate-limit es **fail-open** en prod (M3). Mitigado parcialmente por Turnstile + rate-limits propios de Supabase Auth. **Recomendado provisionar** (ver §3). |
| `UPSTASH_FAIL_CLOSED` | Opt-in: `=true` hace que la falta de Upstash en prod bloquee (fail-closed) en vez de fail-open. | Sin ella, default fail-open. Setear a `true` **solo después** de provisionar Upstash y verificar `/api/health`. |
| `PAYMENT_PROVIDER` | Selector del proveedor de pagos (`lib/payments`). | **DEGRADA nula** — default `mercadopago`. Dejar sin setear o en `mercadopago`. |
| `MP_PLAN_PRICE_CENTS` | Precio del plan Solo (INDEPENDIENTE) en centavos. | **DEGRADA nula** — default 3.000.000 (30.000 ARS). |
| `CLINIC_BASE_PRICE_CENTS` / `CLINIC_SEAT_PRICE_CENTS` | Pricing de tier Clínica (base + por seat) en centavos. | **DEGRADA nula** — defaults 10.000.000 / 2.500.000 (100k base + 25k por seat). |
| `META_APP_SECRET` | Firma HMAC de webhooks de WhatsApp. | **DEGRADA/ROMPE WhatsApp** — en prod, sin él el webhook de WhatsApp se bloquea. Si no usás WhatsApp el día 1, no aplica. |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | Integración Google Calendar (OAuth + sync). | **DEGRADA** — sin las tres, la conexión de Google Calendar no funciona; el resto de la app sí. |
| `MP_PUBLIC_KEY` | Reservado para SDK frontend de MP (futuro). | Sin uso hoy. |
| `SENTRY_DSN` | Fallback server/edge del DSN de Sentry. | **DEGRADA nula** — `NEXT_PUBLIC_SENTRY_DSN` ya cubre los tres runtimes. |
| `SENTRY_AUTH_TOKEN` | Subida de source maps (build-time, plugin de Sentry). | **DEGRADA** — stack traces sin símbolos. El runtime NO lo lee. |
| `NEXT_PUBLIC_POSTHOG_KEY` / `_HOST` | Analytics de producto (PostHog). | **DEGRADA** — sin métricas de producto; la app anda. |
| `AFIP_ENV` | `homologacion` | `produccion` para facturación AFIP. | **DEGRADA** — solo afecta facturación electrónica. |
| `TZ` | Zona horaria del runtime (`America/Argentina/Cordoba`). | **DEGRADA** — fechas en UTC si no se setea; conviene fijarla. |

---

## 2. Verificación go-live

### 2.1 Health-check

```bash
curl -s https://<APP_URL>/api/health | jq
```

**Esperado para go-live:**

- `ok: true` (HTTP 200). `ok` deriva SOLO de `checks` (db + env críticas).
- `checks.db.ok: true` y `checks.env.ok: true` (sin `error`).
- En `integrations`, **todos los críticos en `true`**:
  - `mercadopago: true`
  - `mp_webhook_secret: true`  ← (necesita `MP_WEBHOOK_SECRET` **y** `MP_ACCESS_TOKEN`)
  - `cron_secret: true`        ← (necesita `CRON_SECRET`)
  - `turnstile: true`
  - `sentry: true`
- `integrations.upstash_redis` idealmente `true` (ver §3); `whatsapp`/`google_calendar`/`posthog` según lo que actives.

> `cron_secret` y `mp_webhook_secret` son **informativos**: no bajan `ok` (los
> crones y el webhook no son dependencia de boot). Pero en este lanzamiento
> tienen que estar en `true` antes de abrir al cliente — si `mp_webhook_secret`
> está `false`, la suscripción no se activa sola; si `cron_secret` está
> `false`, la reconciliación de billing y el mantenimiento de `audit_log` no
> corren.

### 2.2 Smoke manual (en prod, navegador real)

1. **Onboarding completo**: signup → onboarding → elegir **especialidad** →
   crear **ficha** de paciente → abrir la **herramienta** clínica de la
   especialidad → **guardar sesión** sobre el turno en curso → recargar y
   verificar que el dato persiste.
2. **Booking público**: abrir `/book/[slug]` del consultorio → reservar un
   turno → verificar que aparece en la agenda.
3. **Equipo + invitación (solo si el cliente es Clínica)**: en
   `/configuracion` → Equipo → invitar a un member → verificar que el email
   sale (o, sin `RESEND_API_KEY`, que aparece el link copiable) →
   `/invitacion/[token]` → aceptar.

Si algo de esto falla, **no abras al cliente**: revisá `/api/health` y los
logs de Vercel/Sentry antes de continuar.

### 2.3 `maxDuration` — nota de capacidad

Los route handlers pesados tienen `export const maxDuration = 60`:
`mercadopago/webhook`, `me/export`, `cron/account-purge`, `google/callback`,
más los crones (`maintenance`, `dispatch-recordatorios`, `reconcile-suscripciones`,
`analytics/refresh`, `google-watch-renew`) y `admin/migrate` (300s).

> **Limitación de Next 15**: `maxDuration` solo aplica a **route handlers** y
> **pages**, no a módulos `'use server'` sueltos. Las server actions de billing
> (`app/(app)/configuracion/billing/actions.ts` — `activateSubscriptionAction`,
> `syncClinicAmountAction`) llaman a MP pero **no tienen route propio**:
> heredan la duración de la **page POST** que las invoca
> (`/configuracion/billing`). No se les puso un `maxDuration` no-op (sería
> engañoso). Si alguna vez una activación de MP tarda y corta, la vía correcta
> es mover esa lógica a un route handler dedicado, no agregar un export inútil
> a la action.

---

## 3. Recomendaciones fuertes (antes de abrir al cliente)

1. **Provisionar Upstash y setear `UPSTASH_FAIL_CLOSED=true`.**
   Hoy el rate-limit es **fail-open** cuando Upstash no está configurado en
   prod (hallazgo **M3**, `lib/security/rate-limit.ts`): signup/login/booking
   no tienen límite propio de Folio (queda solo Turnstile + límites de Supabase
   Auth). Orden correcto:
   1. Crear Upstash Redis (REST) y setear `UPSTASH_REDIS_REST_URL` +
      `UPSTASH_REDIS_REST_TOKEN` en Vercel.
   2. Verificar `/api/health` → `integrations.upstash_redis: true`.
   3. Confirmar que Sentry está wired (para que la misconfig page a on-call).
   4. Recién entonces setear `UPSTASH_FAIL_CLOSED=true`.

2. **Setear `RESEND_API_KEY` (+ `EMAIL_FROM`).**
   Sin esto, los emails de **invitación de equipo** y **confirmación de turno**
   NO salen — `sendEmail` loguea en vez de enviar (fail-safe) y la UI muestra un
   link copiable. Para un lanzamiento con cliente real, configuralo así el flujo
   de invitaciones y confirmaciones funciona de punta a punta.

---

## 4. Rollback

`master` auto-deploya a producción. Para revertir un deploy malo:

1. **Revert de código** (preferido — deja historia limpia):
   `git revert <sha-del-commit-malo>` → push a `master` → Vercel redeploya el
   estado revertido automáticamente. Alternativa rápida: en **Vercel →
   Deployments**, "Promote to Production" sobre el último deploy bueno (rollback
   instantáneo sin tocar git, pero acordate de revertir en git después para que
   `master` no vuelva a deployar lo malo).

2. **Migraciones — son aditivas, NO hay down.** Las migraciones de Folio son
   append-only y aditivas (columnas nullable, funciones nuevas, policies). **No
   existe rollback de schema.** Si revertís código que dependía de una columna
   nueva, la columna queda en prod sin uso (inofensivo). El riesgo inverso es el
   peligroso: NUNCA mergees código que usa una columna/RPC que no esté ya en
   prod (el cliente `<any>` no avisa; falla en runtime con `42703`, como el
   outage de M49 del 9-jun). **Antes de cualquier deploy con migración: aplicar
   la migración a prod primero** (vía Supabase MCP `apply_migration` o
   `scripts/push-pending-migrations.mjs`, registrando la versión canónica en
   `supabase_migrations.schema_migrations`).

---

## 5. Gaps aceptados conscientemente para el MVP

De `docs/AUDIT.md`. Se lanza con estos gaps **documentados**; cada uno tiene
mitigación vigente y plan de cierre post-launch.

| Gap | Riesgo | Mitigación (vigente) | Cuándo se cierra |
|-----|--------|----------------------|------------------|
| **M3** — rate-limit fail-open sin Upstash | Brute-force/credential-stuffing en signup/login mientras no haya Upstash. | Turnstile obligatorio en prod + rate-limits propios de Supabase Auth. | Al provisionar Upstash + `UPSTASH_FAIL_CLOSED=true` (ver §3). Idealmente antes del go-live. |
| **M4** — `signOut()` no revoca el JWT ya emitido | Si un JWT activo se filtra, sigue válido hasta expirar aunque el user cierre sesión. | `signOut()` usa scope global (revoca refresh tokens de todos los devices) + access token de **vida corta (1h)** → ventana de exposición acotada + RLS bloquea sin JWT válido. | Post-launch, si se requiere revocación inmediata: tabla de revocación / `session_version` en `profile` validado en `getActiveSession()`. |
| **M8** — helpers `SECURITY DEFINER` ejecutables por `authenticated` vía RPC | Un user logueado podría llamar `user_org_ids`/`can_read_clinical` por `/rest/v1/rpc/*` y aprender su propio scope (info disclosure, NO datos de otros). | Las funciones filtran por `auth.uid()` → solo devuelven el scope del propio usuario; retornan tipos simples (bool/uuid/text), nunca filas. La app NO las invoca por RPC. En prod ya no las puede ejecutar `anon`/PUBLIC. | ⚠️ **NO revocar EXECUTE a `authenticated`** — las policies RLS evalúan estos helpers CON el rol del usuario que consulta; revocárselo rompería todos los chequeos RLS de la app (verificado en re-auditoría 2026-06-11). El cierre correcto es sacarlos de la superficie RPC de PostgREST (moverlos fuera del schema expuesto o filtrarlos en la config de la API), manteniendo EXECUTE para `authenticated`. `anon`/PUBLIC ya están revocados. Riesgo residual aceptado: un user autenticado solo aprende su propio scope. |
| **M9** — `pg_trgm` / `btree_gist` en schema `public` | Higiene de seguridad: extensiones visibles/callable en `public`; sienta precedente para extensiones futuras peligrosas. | Extensiones no sensibles; las tablas que las usan requieren `auth.uid() IS NOT NULL`. Sin bypass de auth ni fuga de PHI. | Migración post-launch: mover a schema `extensions` dedicado. |

> El resto de bajos de la auditoría (B1–B8) están triados en `docs/AUDIT.md` y
> no bloquean el lanzamiento.

---

## 6. Crons (`vercel.json`)

Todos autenticados con `Bearer CRON_SECRET`. Horarios en **UTC** (Argentina =
UTC−3). Si `CRON_SECRET` falta, todos devuelven 401 y no hacen nada.

| Path | Schedule (UTC) | Qué hace | Criticidad |
|------|----------------|----------|------------|
| `/api/cron/dispatch-recordatorios` | `0 5 * * *` (02:00 AR) | Procesa la cola `recordatorio_job`: hidrata turno+paciente+org y manda el template de WhatsApp; marca enviado/reintenta. | Recordatorios de turno — degrada UX si no corre. |
| `/api/analytics/refresh` | `0 6 * * *` (03:00 AR) | `analytics.refresh_all(periodo)`: recalcula métricas mensuales + benchmarks + cache de insights del mes anterior. | Solo dashboards de analytics. |
| `/api/cron/maintenance` | `0 3 1 * *` (1° de mes, 00:00 AR) | `audit_log_run_maintenance(6)`: crea las próximas particiones mensuales de `audit_log`. **Crítico a mediano plazo**: sin esto, a los ~12 meses los INSERT a tablas auditadas fallan (M28 deja una partición DEFAULT como red). | **Alta** (diferida) — la app se brickea sin particiones futuras. |
| `/api/cron/google-watch-renew` | `0 7 * * *` (04:00 AR) | Renueva los watch channels de Google Calendar que expiran en <48h (Google los corta a los ~7 días). | Solo sync de Google Calendar. |
| `/api/cron/reconcile-suscripciones` | `30 8 * * *` (05:30 AR) | Red de seguridad de billing (A2): para suscripciones en estado no terminal con `mp_preapproval_id`, hace GET preapproval contra MP y aplica el estado real; además corre `syncSubscriptionAmount` (repara PUTs de monto perdidos en Clínica). | **Alta** — repara divergencia local↔MP (cliente pagando sin acceso). |

> **No registrado en `vercel.json`**: `/api/cron/account-purge` (purga ARCO a
> los 30 días). Existe el route con su auth, pero **no está en `crons[]` y está
> gateado por `ACCOUNT_PURGE_ENABLED=1`** (no hay borrados solicitados todavía
> y se quiere un trial en staging primero). Si se quiere activar: agregarlo a
> `vercel.json` (sugerido diario 03:00 UTC) **y** setear `ACCOUNT_PURGE_ENABLED=1`.
