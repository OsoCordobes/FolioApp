# Folio

SaaS vertical para gestión de turnos, agenda clínica y finanzas para profesionales independientes de la salud en Argentina (hoy: quiropraxia, cardiología, psicología, kinesiología y nutrición — registry extensible en `lib/especialidades/`).

Multi-tenant + clinic-ready desde día 1. Cumple Ley 25.326 (Habeas Data) y Ley 26.529 (Historia Clínica AR). Encriptación columnar AES-256-GCM app-side con blind indexes HMAC-SHA256.

Tres superficies, con fronteras de datos distintas:

- **App del profesional** (`app/(app)/`) — agenda, ficha clínica, finanzas, configuración.
- **Booking público** (`app/(public)/book/`) — reserva sin cuenta, con captcha y rate-limit.
- **Portal del paciente** (`app/(portal)/`) — login por magic-link; ve sus turnos, sus datos y sus consentimientos, y **nada** de lo clínico: la RLS no le da ninguna policy sobre `sesion`, `sesion_enmienda` ni `nota_clinica`.

> **Snapshot pre-audit (2026-05-21):** [`docs/audit/pre-audit-self-assessment.md`](./docs/audit/pre-audit-self-assessment.md). El estado VIVO de gaps y excepciones es [`docs/audit/known-gaps.md`](./docs/audit/known-gaps.md).

## Stack

- **Next.js 15** (App Router, Turbopack) + **React 19** + **TypeScript** estricto
- **Supabase** (Postgres + Auth + RLS `FORCE`d + Storage privado con RLS)
- Encriptación columnar **app-side AES-256-GCM** (no pgsodium) — ver [`docs/audit/encryption-exceptions.md`](./docs/audit/encryption-exceptions.md)
- **Playwright** visual regression pixel-perfect + E2E
- **SQL specs** (`tests/sql/*.spec.sql`) corridos en CI vía `.github/workflows/pgtap.yml` contra postgres:16 + stubs de Supabase
- **Sentry** + **PostHog** observabilidad (events tipados en `lib/observability/events.ts`)
- es-AR · America/Argentina/Cordoba · ARS centavos

## Setup local

```bash
pnpm install
cp .env.local.example .env.local   # completar TODAS las claves; ver detalle abajo
pnpm dev                            # arranca en http://localhost:3010
```

Las envs críticas (sin las cuales el server hace hard-fail al boot via `instrumentation.ts`):

| Env | De dónde | Bloquea boot? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard → Settings → API | sí |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API | sí |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Settings → API (server-only) | sí |
| `FOLIO_ENC_KEY` | `openssl rand -base64 32` | sí |
| `FOLIO_ENC_HMAC_KEY` | `openssl rand -base64 32` | sí |
| `CRON_SECRET` | `openssl rand -base64 32` | runtime — los crons fallan sin él |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Upstash dashboard | runtime — sin él el rate-limit es **fail-open** en prod (fail-closed solo con `UPSTASH_FAIL_CLOSED=true`); con las keys presentes pero Upstash caído, el default en prod es fail-closed |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile dashboard | runtime — sin él el captcha es no-op (dev OK, prod riesgo) |
| `MP_ACCESS_TOKEN` / `MP_WEBHOOK_SECRET` | MercadoPago Developers panel | runtime — billing roto sin él |
| `WHATSAPP_*` | Meta WhatsApp Business | runtime — recordatorios fail sin él |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | Google Cloud Console | runtime — Calendar sync fail sin él |

El template completo vive en [`.env.local.example`](./.env.local.example) con comentarios por sección.

## Scripts

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Next.js dev server (puerto 3010, Turbopack) |
| `pnpm build` | Build producción |
| `pnpm start` | Server producción local (puerto 3010, requiere `pnpm build` previo) |
| `pnpm typecheck` | TypeScript estricto, 0 errores |
| `pnpm lint` | ESLint, 0 errores |
| `pnpm test:unit` | Unit tests con `node:test` (cripto, security, helpers) |
| `pnpm test:visual` | Playwright visual regression vs prototipo (`project: prototype`) |
| `pnpm test:visual:update` | Regenera baselines (solo si el prototipo cambió legítimamente) |
| `pnpm test:app` | Playwright visual contra la app real (`project: app`) |
| `pnpm test:all` | Toda la suite Playwright (prototype + app + e2e) |

Migrations: se aplican vía `/api/admin/migrate` (Bearer + escape hatch) o vía Supabase CLI (`supabase db push`). Prisma quedó removido en Sprint 2 — el schema vivo está en `supabase/migrations/`.

## Estado actual de fases

> **Checkpoint 2026-08-12.** Las 12 fases del plan maestro original están
> cerradas; lo que sigue vive en `docs/audit/known-gaps.md`, que es el estado
> **vivo** de gaps y excepciones. La lista de abajo es histórica — se conserva
> porque documenta el orden en que se construyó el producto, no porque sea un
> tablero de trabajo.
>
> Lo que se cerró después de esta lista (agosto 2026): guard de la RPC de
> pseudonimización (M93), policies de Storage por paciente (M94), UPDATE clínico
> con visibilidad (M95), notas clínicas sin turno (M96), estabilidad del login,
> carry-forward de la ficha, control de concurrencia del guardado y timeline de
> modificaciones de la historia clínica.

El plan maestro original (`docs/superpowers/plans/...`) divide el trabajo en 12 fases. La realidad post-Sprint 0 de pre-launch hardening:

- [x] **F0** Bootstrap (Next.js + Supabase + Playwright + baselines pixel-perfect)
- [x] **F1** Migración pixel-perfect de las 10 pantallas con mock data
- [x] **F2** Migrations M01–M35 (schema + RLS `FORCE`d + encriptación columnar + audit + pseudonimización)
- [x] **F3** Auth + multi-tenancy + onboarding wizard 9 pasos
- [x] **F4** Data layer + Server Actions (split PII/PHI)
- [x] **F5** Google Calendar (OAuth + push Folio→Google + inbound Google→Folio como bloqueos espejo, `lib/google/inbound.ts` + watch-renew)
- [x] **F6** WhatsApp Cloud API (inbound webhook + signed)
- [x] **F7** Booking público con Turnstile
- [x] **F8** Analytics anonimizada (k-anonymity + materialized views)
- [x] **F9** Cron jobs (recordatorios + analytics refresh + Google watch renew + maintenance)
- [x] **F10** Compliance (consentimientos + audit_log particionado + ARCO data rights + AFIP WSFEv1)
- [x] **F11** Polish + observability (Sentry + PostHog + hard-fail al boot + rate limiting vía Upstash — matriz de falla en `lib/security/rate-limit.ts`; fail-open sin Upstash, ver M3 en LAUNCH-RUNBOOK §5)
- [x] **Audit-prep sprint** (mayo 2026) — M22 RLS hardening, M24 account deletion, M25 pseudo audit, cookie banner, CSP, deploy checklist
- [x] **Post-audit Sprint 0** (2026-05-24) — gates duales en endpoints admin (C1, C3), CSP enforcing (C2), paginated user lookup (A3), rate limit calibrado (A4)
- [x] **F12 (parcial)** UI Clínicas — equipo/roles/invitaciones (M49/M51), selector multi-profesional en calendario y alta de turno; pendiente: splits de comisión
- [ ] **Sprint 1** post-audit (en curso) — README, 404/500 styled, HMAC salt per-tenant (A2), 1.6 olvidé email, audit cleanup
- [x] **Sprint 2 (parcial)** post-audit — auth callback perf, PostHog events tipados (`lib/observability/events.ts`), pgTAP CI (`.github/workflows/pgtap.yml`), Prisma cleanup (commit 06df9fe); pendiente: bundle reduction

## Migrations

**90 migraciones aplicadas (M01–M96)** al 2026-08-12. La tabla de abajo detalla
sólo M01–M35, la fundación del esquema; el resto vive en
`supabase/migrations/` con su header explicando propósito, dependencias y
reversibilidad.

Aplican en orden lexicográfico. Todas con RLS `FORCE`d en la misma migration que crea la tabla (regla inviolable #4).

**El flujo canónico** (no negociable, hubo un incidente por saltearlo):

```bash
node scripts/diff-migrations.mjs                              # qué falta contra prod
node --env-file=.env.local scripts/push-pending-migrations.mjs # aplicarlas
node scripts/diff-migrations.mjs                              # confirmar el ledger
```

La migración va a producción **antes** de mergear el código que la usa: `master`
auto-deploya y el client de Supabase está tipado `<any>`, así que una columna
faltante no da error de compilación — falla en silencio en producción.

Hitos posteriores a M35: multi-especialidad (M50/M55), clínica y equipos
(M49/M51), booking público (M53), pseudonimización (M61/M63), portal del
paciente (M70/M71/M84-M88), y el bloque de seguridad de agosto 2026
(M93 guard de pseudonimización, M94 Storage por paciente, M95 UPDATE clínico,
M96 notas clínicas append-only).

| ID | Propósito |
|---|---|
| M01 | Extensions (pgcrypto, citext, uuid-ossp) + helper functions (hmac_blind) |
| M02 | Tenancy base: `organization`, `profile`, `member`, `equipo`, RLS base |
| M03 | Paciente split — `paciente_identidad` (PII) ↔ `paciente` (PHI) |
| M04 | Catálogos read-only (paises, provincias, especialidades) |
| M05 | Entidades clínicas (diagnostico, alergia, medicacion) |
| M06 | Contactos + tutores (referidor, tutor legal de menores) |
| M07 | Consentimientos — versionado + append-only |
| M08 | Documentos clínicos — metadata + storage path |
| M09 | Servicios + turnos (estado-máquina) |
| M10 | Sesiones SOAP append-only + enmiendas |
| M11 | Integraciones (Google, WhatsApp, MercadoPago, AFIP) cifradas |
| M12 | Audit log particionado por mes + trigger global |
| M13 | Pseudonimización — RPC para Habeas Data art. 16 |
| M14 | Vistas convenientes (turno_hoy, paciente_full) |
| M15 | Analytics schema (separate, restricted role) |
| M16 | Analytics pipeline (refresh functions + k-anonymity suppression) |
| M17 | Fix paciente ↔ member checks (consistency) |
| M18 | WhatsApp inbound + outbound canonical |
| M19 | Suscripción Folio (MercadoPago integration) |
| M20 | Organization public fields (slug, descripción para booking) |
| M21 | Card personalization (booking público look-and-feel) |
| M22 | RLS hardening — `FORCE` audit + trigger prevent_sesion_unlock |
| M23 | Profile consent (Ley 25.326 art. 14 explicit gate) |
| M24 | Account deletion request — 30-day grace + pseudonimization |
| M25 | Pseudonimización audit event (Ley 25.326 art. 16 traceable) |
| M26 | Profile PII nullable post-deletion |
| M27 | Storage clinical buckets — private + RLS |
| M28 | Audit log partition safety (DEFAULT fallback) |
| M29 | Fix analytics SEGUIMIENTO enum literals |
| M30 | Paciente telefono_hash (blind index dedup) |
| M31 | Paciente_identidad caja_fuerte (VIP patient hide-from-staff) |
| M32 | Paciente SELECT via turno (RLS for booking visibility) |
| M33 | Bootstrap org atomic (SECURITY DEFINER RPC, signup rollback safe) |
| M34 | Audit log director read scope |
| M35 | Unify opt_out analytics |

Aplicación a Supabase: vía `/api/admin/migrate` (Bearer + escape hatch). Long-term: migrar a `supabase db push` vía GitHub Actions con OIDC.

## Compliance

Folio implementa los mecanismos exigidos por la legislación argentina de protección de datos personales y de salud:

- **Ley 25.326 — Habeas Data**: consentimiento informado al signup (M23), derecho ARCO (acceso, rectificación, cancelación, oposición), pseudonimización irreversible (M13 + M25), audit log (M12). Detalles: [`docs/audit/data-rights.md`](./docs/audit/data-rights.md), [`docs/audit/consent-flow.md`](./docs/audit/consent-flow.md).
- **Ley 26.529 — Historia Clínica**: 10 años de retención obligatoria, append-only para SOAP + enmiendas (M10), audit de accesos (M12 + M34), profesional como controller + Folio como processor. Detalles en [`docs/audit/retention.md`](./docs/audit/retention.md).
- **RLS por tenant**: matriz tabla × rol × CRUD en [`docs/audit/rls-matrix.md`](./docs/audit/rls-matrix.md), verificada con pgTAP (`tests/sql/`).
- **Encriptación columnar**: AES-256-GCM app-side, claves en Vercel encrypted-at-rest. Inventario completo + threat model + excepciones documentadas en [`docs/audit/encryption-exceptions.md`](./docs/audit/encryption-exceptions.md).
- **Security headers**: CSP enforcing (Sprint 0 — 2026-05-24), HSTS preload, X-Frame DENY, Permissions-Policy restrictiva. Ver `next.config.ts`.

## Pixel-perfect (regla inviolable)

El diseño nació del prototipo Claude Design. `folio.css` (~17.7k líneas) es hecho a mano, se sirve como static asset desde `/public/folio.css` y evoluciona con el producto; los cambios reusan los tokens de `:root` (no hex off-theme).

La suite visual (`pnpm test:visual`) compara contra baselines y se corre manualmente; el CI de PRs corre typecheck + lint + unit (`.github/workflows/app-ci.yml`).

Baselines: `tests/visual/baseline.spec.ts-snapshots/` (PNGs light/dark a 1440×900).

## Deploy

Vercel auto-deploy desde `master`. Pre-deploy checklist exhaustiva en [`docs/audit/2026-05-23-deploy-checklist.md`](./docs/audit/2026-05-23-deploy-checklist.md).

Producción: https://folio-app-ten.vercel.app
Health: https://folio-app-ten.vercel.app/api/health (público, sin auth, safe)

## Reglas inviolables

1. `folio.css` se edita SOLO reusando tokens de `:root`; no introducir hex off-theme. Los baselines visuales se regeneran únicamente con cambio legítimo.
2. NO emojis en código, commits ni archivos productivos.
3. Una tarea a la vez, premium standard antes de avanzar.
4. RLS habilitada (y `FORCE`d) en la misma migration que crea cada tabla. Nunca activar a posteriori.
5. Sin `--no-verify`, sin `--force`, sin push remoto sin confirmación del owner.
6. Sin inventar secrets: si falta una credencial, pedirla o documentarla. El boot hace hard-fail en producción si faltan las críticas (`instrumentation.ts`).
7. Endpoints administrativos: gate dual-factor en producción (Bearer + escape hatch env explícita). Ver `lib/security/admin-gate.ts`.
