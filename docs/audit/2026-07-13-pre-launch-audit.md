# Auditoría pre-venta — Folio (2026-07-13)

> **Pregunta que responde**: ¿qué falta para vender Folio y usarlo de punta a punta
> con clientes reales?
>
> **Metodología**: 3 pasadas de exploración profunda en paralelo sobre el working
> tree de `master` (superficie de producto y flujos E2E; pipeline de
> monetización/billing; seguridad/datos/operaciones), contrastadas contra la
> auditoría FASE 0 (`docs/AUDIT.md`, 2026-06-10), `docs/LAUNCH-RUNBOOK.md` y
> `docs/audit/known-gaps.md`. Desde la auditoría de junio se mergearon ~30 PRs
> (legales, consentimiento con firma, emails de ciclo de vida de billing,
> fallback de email en recordatorios, verificación de email adaptativa,
> landing/pricing, directorio público) — este documento re-evalúa el estado
> actual. Las referencias `archivo:línea` fueron verificadas a mano contra el
> working tree en la fecha de esta auditoría.
>
> **Limitación de sesión**: esta auditoría corrió sin acceso autenticado a la DB
> de producción ni a Vercel. Los ítems que dependen de estado de prod (toggle de
> confirmación de email, env vars) quedan marcados **[VERIFICAR EN PROD]** en vez
> de asertados.

## Veredicto

**El producto está completo y endurecido — no falta nada estructural para vender.**
Signup → onboarding → ficha clínica → agenda → booking público → cobro por
suscripción funcionan de punta a punta, con RLS en todas las tablas, PHI cifrada
a nivel columna y un pipeline de billing production-grade. Lo que falta es una
lista corta de **toggles operativos y verificación de configuración** (sección A),
2–3 **gaps de producto acotados** (sección B) y hardening post-launch ya triado
(sección C).

---

## A. Bloqueantes — resolver antes de cobrar clientes reales

### A-1 · Verificación de email apagada (PHI con emails no verificados)

- **Estado**: el código es adaptativo (PR #80, `d2dd8a2`) — con el toggle de
  Supabase ON el signup pasa por "Revisá tu email" y el onboarding se retoma
  tras confirmar. Pero la activación en prod es un procedimiento de 4 pasos
  (SMTP custom → template `token_hash` → allow-list de redirects → flip del
  toggle) documentado en `docs/LAUNCH-RUNBOOK.md` §7, y el gate de merge del
  2026-07-03 dejó constancia de que el estado del toggle en prod requiere
  verificación explícita. **[VERIFICAR EN PROD]**
- **Riesgo**: en una app médica, cuentas con email ajeno/no verificado que van a
  recibir links de reset, invitaciones y datos de pacientes.
- **Cómo cerrarlo**: ejecutar los 4 pasos del runbook §7 (en ese orden — sin
  SMTP custom la cuota built-in de ~2-4 mails/h brickea el signup) + smoke
  post-flip cross-device.

### A-2 · Rate limiting fail-open sin Upstash (gap M3 vigente)

- **Estado**: `lib/security/rate-limit.ts:111-122` — con las keys de Upstash
  AUSENTES en prod, el rate limit queda **desactivado** (fail-open con un
  `console.error`). Desde `a4ac36c`, con keys presentes pero Upstash fallando el
  default ya es fail-closed; el agujero queda acotado a "no provisionado".
  **[VERIFICAR EN PROD]** si `UPSTASH_REDIS_REST_URL/TOKEN` están seteadas.
- **Riesgo**: signup/login/booking público sin throttle propio (queda solo
  Turnstile + límites de Supabase Auth).
- **Cómo cerrarlo**: provisionar Upstash Redis (REST) → verificar
  `/api/health` → `integrations.upstash_redis: true` → recién entonces
  `UPSTASH_FAIL_CLOSED=true` (orden del runbook §3.1).

### A-3 · Pre-vuelo de envs de producción

- **Estado**: la app degrada o rompe en runtime si faltan envs (cliente Supabase
  `<any>`, sin guard de compile-time). El checklist completo con modo de falla
  por env ya existe: `docs/LAUNCH-RUNBOOK.md` §1. **[VERIFICAR EN PROD]**
- **Críticas**: `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` (+ webhook **registrado
  en el panel de MP** apuntando a prod — no verificable desde código),
  `CRON_SECRET`, `FOLIO_ENC_KEY`/`FOLIO_ENC_HMAC_KEY`, Turnstile (site +
  secret), `NEXT_PUBLIC_SENTRY_DSN`, `RESEND_API_KEY` + `EMAIL_FROM` (sin esto
  invitaciones/confirmaciones no salen), `NEXT_PUBLIC_APP_URL`.
- **Dominio custom (F0.2) pendiente**: `getAppUrl()`
  (`lib/config/app-url.ts:23-37`) está bien centralizado, pero sin dominio
  propio los links generados (emails, back-URLs de MP, booking) salen con el
  dominio `*.vercel.app`. Para vender, agregar el dominio custom en Vercel y
  setear `NEXT_PUBLIC_APP_URL` a ese dominio.
- **Cómo cerrarlo**: correr el pre-vuelo del runbook §1 + `curl /api/health` y
  exigir los flags críticos en `true` (runbook §2.1).

### A-4 · Webhook de MP sin guardrail sandbox↔producción

- **Estado**: `app/api/mercadopago/webhook/route.ts:68` declara
  `live_mode?: boolean` en el payload pero **nunca lo chequea**. El handler usa
  el token que haya en env; un token de test en prod (o un webhook de sandbox
  llegando a prod) "funciona" en silencio y puede activar suscripciones sin
  cobro real.
- **Cómo cerrarlo**: fix chico de código — en prod, si `live_mode === false`,
  loguear y descartar (200 para que MP no reintente). Único ítem de esta
  sección que requiere código; recomendado antes del primer cobro real.

---

## B. Importantes — primeras semanas con clientes reales

### B-1 · Sin backoffice de soporte para suscripciones

- **Estado**: no existe UI interna para ver/comp/cancelar la suscripción de un
  cliente. Hoy: SQL crudo o flag `organization.is_internal_account`. Los admin
  routes existentes son ops-only (`app/api/admin/*`, `app/(app)/admin/audit`).
- **Riesgo**: con clientes pagando, cada reclamo/refund/comp es una operación
  manual contra la DB de prod.
- **Relacionado**: `is_internal_account` no está guardado a nivel RLS (hallazgo
  B2 de `docs/AUDIT.md`) — agregar la policy de column-guard propuesta para que
  solo service_role pueda flipearlo.

### B-2 · Facturación AFIP no usable (única feature real a medio hacer)

- **Estado**:
  - `lib/afip/wsfev1.ts:283` — `getUltimoNumeroEmitido` **throwea** ("no
    implementado (F11)"): sin numeración automática de comprobantes.
  - Firma CMS del login ticket marcada `TODO[F11]` (`wsfev1.ts:26`).
  - `emitirFacturaAction` (`app/(app)/finanzas/actions.ts:20`) existe pero
    tiene **cero callers en la UI** (ya lo señalaba
    `docs/auditoria-codebase-2026-06-15.md` L3).
- **Decisión de producto pendiente**: ¿facturación dentro o fuera del scope v1?
  Vender B2B a médicos probablemente la requiera pronto. Si queda fuera,
  documentarlo como limitación conocida y comunicarlo en el onboarding/pricing;
  si entra, cerrar F11 (numeración + CMS + botón en la fila PAGADA de Finanzas).

### B-3 · Hardening de Supabase Auth (toggles manuales)

- **Leaked-password protection**: toggle manual del dashboard (nota en header de
  M45, "NO automatizable"). **[VERIFICAR EN PROD]**
- `minimum_password_length = 6` en `supabase/config.toml` — subir a 8.
- `secure_password_change = false` — considerar re-auth para cambiar contraseña.

### B-4 · Email de soporte con dominio propio

- **Estado**: `lib/support.ts:11` — `SUPPORT_EMAIL = "folioasistencia@gmail.com"`,
  visible en superficie comercial (legales, billing, emails).
- **Cómo cerrarlo**: casilla en dominio propio (junto con F0.2) y actualizar la
  constante. Trivial en código; requiere el dominio primero.

### B-5 · Purga ARCO todavía en dry-run

- **Estado**: `/api/cron/account-purge` corre a diario pero sin
  `ACCOUNT_PURGE_ENABLED=1` solo lista candidatos, no borra. El SLA de borrado a
  30 días (Ley 25.326 art. 16) no es real hasta flipearlo.
- **Cómo cerrarlo**: trial en staging (pendiente según runbook §6) → setear la
  env en Vercel Production.

### B-6 · Backups / PITR para PHI

- **Estado**: no hay estrategia de backups en el repo — se delega en los backups
  managed de Supabase. Para un producto con PHI, confirmar que el tier del
  proyecto incluye PITR (o upgradearlo). **[VERIFICAR EN PROD]**
- El archival de particiones de `audit_log` (retención 10 años, Ley 26.529)
  sigue siendo manual — documentado en `docs/audit/retention.md`; aceptable a
  volúmenes actuales.

### B-7 · Reconciliación de billing solo diaria

- **Estado**: `/api/cron/reconcile-suscripciones` corre 1×/día (`vercel.json`).
  Un webhook de activación perdido puede dejar a un cliente **pagando sin
  acceso hasta ~24h** (mitigado por el auto-refresh al volver de MP y el botón
  "Refrescar estado").
- **Cómo cerrarlo**: dispararlo también cada 1-4h vía GitHub Actions (mismo
  patrón que `dispatch-recordatorios.yml`, que ya existe porque el plan Hobby
  de Vercel no acepta schedules sub-diarios). Es idempotente — seguro de correr
  más seguido.

---

## C. Post-launch — triado, no bloquea

- **Audit de LECTURA de historia clínica**: los triggers M12 cubren
  INSERT/UPDATE/DELETE, no SELECT. "Quién vio la ficha" (expectativa de
  auditoría médica) no queda registrado. Documentar la posición frente a Ley
  26.529 o implementar logging app-side en los readers de `lib/db/*`.
- **CI**: pgTAP corre contra postgres:16 vanilla con `auth.uid()` NULL — las
  policies bajo JWT real y las de `storage.objects` no se ejercitan en CI;
  Playwright e2e/visual tampoco corre en CI (solo `test:unit`).
- **M4 / M8 / M9**: ya triados con mitigación y plan en
  `docs/LAUNCH-RUNBOOK.md` §5 — sin cambios.
- **Retirar `/api/admin/migrate` y `/api/admin/confirm-user`** (plan Sprint 3:
  `supabase db push` vía GitHub Actions OIDC).
- **Menores**: `analytics.geo_regions` sin RLS (solo higiene de grants, data no
  sensible — M42); comentario stale en M19 (dice "middleware", el gate vive en
  `app/(app)/layout.tsx:66-75`); docstring stale en
  `app/(app)/configuracion/page.tsx` ("read-only or stub" — ya no); confirmar
  que `app/dev/*` queda gateado en prod; revisar orgs internas/demo sembradas
  antes del go-live; email de "suscripción activada" puede no salir en un
  ordering específico de webhooks (documentado en
  `app/api/mercadopago/webhook/route.ts:230-233`, cosmético).
- **Diferidos conocidos** (en `docs/audit/known-gaps.md`, sin cambios): UI de
  enmiendas de sesión, compose outbound de WhatsApp, two-way sync de turnos con
  Google (by design), splits de comisión para clínicas, auditoría formal de
  accesibilidad, update de tarjeta in-app (inherente al modelo preapproval de
  MP — el cliente re-activa con preapproval nuevo; explicitarlo en el copy).

---

## D. Qué está confirmado funcionando (fortalezas)

- **Flujo comercial completo**: signup con Turnstile + rate limit + consent Ley
  25.326 → onboarding 9 pasos con autosave → bootstrap atómico de org (M33) →
  gate de 7 días de gracia → suscripción MP (Solo ARS 30k / Clínica base + seats)
  → paywall en layout con recovery path siempre alcanzable.
- **Billing production-grade**: webhook con HMAC timing-safe + replay guard 6h,
  fail-closed en prod, idempotencia por `UNIQUE(mp_payment_id)` + watermark
  `mp_last_modified`, deadline interno 20s → 503 para retry de MP, cron de
  reconciliación, emails de ciclo de vida con dedupe por episodio, upgrade
  self-serve Solo→Clínica, validación de monto per-org, abstracción
  `PaymentProvider` lista para un proveedor europeo.
- **Booking público E2E**: slots reales por profesional, re-validación
  server-side + RPC `slot_ocupado` + EXCLUDE M40 contra doble-booking, captcha,
  consent, notificaciones a paciente y profesional.
- **Recordatorios**: cola `recordatorio_job` cada 15 min (GH Actions) con claim
  CAS, WhatsApp primario + fallback email (M67), presupuesto de reintentos.
- **Seguridad de datos**: RLS habilitado (y FORCE) en todas las tablas de
  `public` — cero `USING (true)`; PHI cifrada app-side (AES-256-GCM) con blind
  indexes; buckets privados con policies espejo del modelo de roles;
  consentimientos inmutables; export ARCO; pseudonimización con audit trail;
  Sentry en 3 runtimes con scrubbing de PII; sin secretos commiteados.
- **Legales**: `/terminos`, `/privacidad`, `/cookies` con copy real versionado;
  consentimiento informado con firma en canvas (Ley 26.529, PR #88).
- **Tests**: 76+ unit tests sobre la lógica riesgosa (crypto, webhooks,
  rate-limit, IDOR, overlap, billing), 12 specs pgTAP con replay completo
  M01→M68 en CI, build gate en `app-ci.yml`.

---

## Orden de ejecución sugerido

| # | Ítem | Tipo | Esfuerzo |
|---|------|------|----------|
| 1 | A-3 pre-vuelo de envs + dominio custom + health check | Config | horas |
| 2 | A-2 Upstash + `UPSTASH_FAIL_CLOSED=true` | Config | ~1h |
| 3 | A-1 verificación de email (runbook §7) | Config + smoke | ~2h |
| 4 | A-4 guardrail `live_mode` en webhook | Código | ~1h + tests |
| 5 | B-3 toggles de Auth (leaked-password, min length 8) | Config | minutos |
| 6 | B-4 email de soporte con dominio | Config + 1 línea | minutos |
| 7 | B-7 reconcile cada 1-4h vía GH Actions | Código (workflow) | ~1h |
| 8 | B-1 backoffice mínimo de suscripciones + RLS `is_internal_account` | Código | días |
| 9 | B-2 decisión AFIP (documentar o cerrar F11) | Producto | decisión |
| 10 | B-5 purga ARCO (trial staging → env) / B-6 PITR | Config | ~1 día |

Con 1–5 hechos, se puede cobrar al primer cliente real con riesgo aceptable;
6–10 dentro de las primeras semanas.
