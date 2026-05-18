# Folio · Deployment Guide

Guía paso-a-paso para deployar Folio a producción en Vercel + Supabase + servicios complementarios (WhatsApp, Google Calendar, AFIP, Cloudflare, Upstash, Sentry, PostHog).

> **Antes de empezar:** este MVP está pensado para los primeros ~20 profesionales en Argentina. La stack escala a 5k orgs sin cambios estructurales. Si planeás >5k, evaluar BigQuery/Clickhouse para `analytics.*`.

---

## 1. Pre-requisitos

- Cuenta Vercel (Pro recomendado para crons cada 15min — Hobby permite máximo 2 crons/día)
- Cuenta Supabase (Free alcanza al inicio; upgrade a Pro cuando aparezca el límite de 500 MB)
- Dominio propio (Vercel-managed o externo apuntando con CNAME)
- WhatsApp Business Account aprobada (Meta, 24-48h proceso de review)
- Google Cloud project con Calendar API habilitada
- AFIP: certificado digital ARCA (homologación primero, producción después de testing)
- Cloudflare account (para Turnstile captcha)
- Upstash account (Redis para rate limiting)

---

## 2. Setup Supabase

### 2.1 Crear proyecto

1. https://supabase.com/dashboard → New project
2. Región: **South America (São Paulo)** — latencia más baja desde AR
3. Anotar `PROJECT_REF` y la `DATABASE PASSWORD`

### 2.2 Correr migrations

```bash
# Setup local
pnpm dlx supabase login
pnpm dlx supabase link --project-ref [PROJECT_REF]

# Aplicar M01-M16 + helpers
pnpm dlx supabase db push

# Seeds (orden importa)
pnpm dlx supabase db execute --file supabase/seed/01_obras_sociales_ar.sql
pnpm dlx supabase db execute --file supabase/seed/02_cie10_starter.sql
pnpm dlx supabase db execute --file supabase/seed/03_plantillas_consentimiento.sql
pnpm dlx supabase db execute --file supabase/seed/04_geo_regions_ar.sql
pnpm dlx supabase db execute --file supabase/seed/05_insight_templates_es.sql
```

### 2.3 Storage buckets

En Supabase dashboard → Storage:

- `consentimientos-firmados` (privado) — firmas digitales / PDFs subidos
- `documentos-clinicos` (privado) — estudios, recetas, fotos
- `seguros` (privado) — pólizas de responsabilidad civil
- `facturas-afip` (privado) — PDFs de facturas emitidas

Policies: read solo si el path empieza con `${org_id}/` y el usuario es member de esa org.

### 2.4 Generar keys de encriptación

```bash
echo "FOLIO_ENC_KEY=$(openssl rand -base64 32)"
echo "FOLIO_ENC_HMAC_KEY=$(openssl rand -base64 32)"
```

Guardar en un password manager — si se pierden, los datos cifrados quedan inaccesibles para siempre.

---

## 3. Setup Vercel

### 3.1 Importar repo

1. https://vercel.com/new → Import repo de GitHub
2. Framework preset: Next.js (autodetectado)
3. Build command: `pnpm build`
4. Output: default

### 3.2 Env vars (Production + Preview)

Copiar todas las variables del `.env.local.example` al panel de Environment Variables. Críticas:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `FOLIO_ENC_KEY`, `FOLIO_ENC_HMAC_KEY`
- `CRON_SECRET` (generar con `openssl rand -hex 32`)
- `NEXT_PUBLIC_APP_URL` (= dominio final, ej. https://folio.app)
- `TZ=America/Argentina/Cordoba`

> **Vercel Cron + CRON_SECRET:** Vercel auto-inyecta `Authorization: Bearer ${CRON_SECRET}` en requests originadas por Cron Jobs. Por eso los endpoints `/api/cron/*` y `/api/analytics/refresh` validan ese header.

### 3.3 Dominio

Vercel → Domains → Add. Apuntar el DNS según las instrucciones (CNAME `cname.vercel-dns.com` o A records).

---

## 4. Setup integraciones

### 4.1 WhatsApp Business Cloud API

1. https://developers.facebook.com → Apps → Create App (Business type)
2. Add product: **WhatsApp**
3. Crear System User en Business Manager → permitir whatsapp_business_messaging y whatsapp_business_management
4. Generar **system user access token** (long-lived, no expira)
5. Configurar webhook callback: `https://[domain]/api/whatsapp/webhook` con `WHATSAPP_WEBHOOK_VERIFY_TOKEN` arbitrario
6. Aprobar templates de mensaje:
   - `folio_confirmacion_24h_v1` (6 placeholders: nombre, fecha, hora, servicio, consultorio, dirección)
   - `folio_recordatorio_2h_v1` (3 placeholders: nombre, hora, consultorio)
   - `folio_post_visita_v1` (3 placeholders: nombre, memo, profesional)
   - `folio_reagendado_v1`, `folio_pago_pendiente_v1` (futuro)

   Review típicamente toma 24-48h.

7. Settear env vars: `WHATSAPP_*`

### 4.2 Google Calendar OAuth

1. https://console.cloud.google.com → New project → Enable **Google Calendar API**
2. Credentials → OAuth client ID (Web application):
   - Authorized redirect URIs: `https://[domain]/api/google/callback` (+ localhost para dev)
3. OAuth consent screen → External, scope: `https://www.googleapis.com/auth/calendar.events`
4. Settear `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` + `GOOGLE_OAUTH_REDIRECT_URI`

### 4.3 Cloudflare Turnstile (captcha)

1. https://dash.cloudflare.com → Turnstile → Add site
2. Domain: tu dominio principal
3. Widget mode: Managed (recomendado)
4. Copiar Site Key → `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, Secret → `TURNSTILE_SECRET_KEY`

### 4.4 Upstash Redis (rate limiting)

1. https://console.upstash.com → Create Database → Global (multi-region)
2. Copiar REST URL + Token → `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`

### 4.5 AFIP WSFEv1 (facturación)

1. Generar par de claves: `openssl genrsa -out folio.key 2048`
2. Generar CSR: `openssl req -new -key folio.key -subj "/C=AR/O=Folio/CN=folio-app/serialNumber=CUIT [CUIT_FOLIO]" -out folio.csr`
3. Subir CSR a AFIP en homologación: https://wsass-homo.afip.gov.ar
4. AFIP devuelve el certificado X.509 (`folio.crt`)
5. Para producción: repetir con https://wsass.afip.gov.ar
6. Cada **organization** sube su propio par cert+key (concatenados como PEM) en `/configuracion`. Folio los cifra con AES-256-GCM antes de guardar en `organization.certificado_arca_cifrado`.
7. Settear `AFIP_ENV=homologacion` hasta que el flujo end-to-end esté validado, luego `produccion`.

### 4.6 Sentry

1. https://sentry.io → New project → Next.js
2. Copiar DSN → `NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_DSN`
3. (Opcional) Source maps upload: `SENTRY_AUTH_TOKEN` con scope `project:releases`

### 4.7 PostHog

1. https://posthog.com → New project
2. Copiar Project API Key → `NEXT_PUBLIC_POSTHOG_KEY` + `POSTHOG_KEY`
3. Host: por default us.i.posthog.com (más cerca de AR que EU)

---

## 5. Crons (Vercel)

`vercel.json` ya define:

| Path | Schedule (UTC) | Local (AR) | Propósito |
|------|---------------|------------|-----------|
| `/api/cron/dispatch-recordatorios` | `*/15 * * * *` | cada 15 min | Procesar cola WhatsApp |
| `/api/cron/google-watch-renew` | `0 7 * * *` | 04:00 AR | Renovar watch channels Google |
| `/api/analytics/refresh` | `0 6 * * *` | 03:00 AR | Recalcular benchmarks k-anónimos |

Vercel valida que el job tenga env `CRON_SECRET` y inyecta el header `Authorization: Bearer ...` automáticamente.

> **Plan tier:** Hobby permite solo 2 cron jobs/día con frecuencia diaria. Para `*/15 * * * *` necesitás **Pro plan** ($20/mo).

---

## 6. Smoke tests post-deploy

```bash
# Health check (no requiere auth)
curl https://[domain]/api/health
# → { ok: true, version: "abc1234", checks: { db: { ok: true, latencyMs: 15 }, env: { ok: true } } }

# Cron manual (require CRON_SECRET)
curl -H "Authorization: Bearer $CRON_SECRET" https://[domain]/api/cron/dispatch-recordatorios
# → { ok: true, processed: 0 } (sin pendientes)

# Booking público
open https://[domain]/book/[org-slug-de-test]
```

Si `/api/health` retorna 503 con `env.ok=false`, falta alguna env var crítica.

---

## 7. Compliance checklist (Ley 25.326 + 26.529)

- [ ] DPA firmado con Supabase (https://supabase.com/dpa)
- [ ] Términos del servicio publicados en `/terminos`
- [ ] Política de privacidad publicada en `/privacidad` (incluye cláusula de analytics k-anónimos)
- [ ] Cookie banner si activás session_recording de PostHog
- [ ] Backups de Supabase configurados (Pro plan tiene daily auto-backup; en Free hay que correr `pg_dump` semanal)
- [ ] Plan de respuesta a brecha (notificar a AAIP dentro de 72h)
- [ ] Audit log retention 10 años verificado (M12 particionado mensual permite archivar a Storage en F12)
- [ ] Consentimiento informado funciona end-to-end (paciente firma → archivo en Storage → consentimiento.firma_storage_path apunta correctamente)

---

## 8. Operación día-a-día

### Rotar `FOLIO_ENC_KEY`

Si la key se filtra:

1. Generar nueva key: `openssl rand -base64 32`
2. Setearla como `FOLIO_ENC_KEY_NEW` en Vercel
3. Correr el script `scripts/rotate-enc-key.ts` (F12) que re-cifra todas las columnas `*_cifrado` con la nueva.
4. Una vez completado, swap `FOLIO_ENC_KEY` ← `FOLIO_ENC_KEY_NEW` y deletear la vieja.

Mientras no haya el script (F12), restore desde backup pre-leak es la única opción.

### Backups

Supabase Free tiene snapshot diario automático con retention de 7 días. Para retention de 10 años (Ley 26.529), exportar `pg_dump` mensual a S3 archive class.

### Monitoreo

- **Errores app:** Sentry → alertas a Slack en error rate >5/min
- **Performance:** PostHog dashboard "Slow queries" (>500ms p95)
- **Disponibilidad:** UptimeRobot ping `/api/health` cada 5min, alerta a Pager/Slack si 503

---

## 9. Roadmap post-MVP (F12+)

Ver `C:\Users\amiun\.claude\plans\estoy-trabajando-en-folio-velvet-torvalds.md` sección F12. Resumen:

- UI específica de clínicas (selector multi-profesional en sidebar)
- Liquidación de comisiones (tabla + dashboard DIRECTOR)
- Mercado Pago para cobranza online
- App móvil (PWA con offline support para zonas con mala conexión)
- Multi-idioma (es-AR → es-CL/es-UY)
- API pública (OAuth para integraciones externas)
