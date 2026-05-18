# Folio

SaaS vertical para gestión de turnos, agenda clínica y finanzas para profesionales de la salud en Argentina (quiropraxia, kinesiología, fonoaudiología, etc.).

Multi-tenant + clinic-ready desde día 1. Cumple Ley 25.326 (Habeas Data) y Ley 26.529 (Historia Clínica AR).

## Stack

- **Next.js 15** (App Router, Turbopack) + **React 19** + **TypeScript**
- **Supabase** (Postgres + Auth + RLS + Storage + pgsodium TCE)
- **Prisma 7** (ORM)
- **Playwright** (visual regression pixel-perfect)
- es-AR · America/Argentina/Cordoba · ARS centavos

## Setup

```bash
pnpm install
cp .env.local.example .env.local   # completar con credenciales reales (F2+)
pnpm dev                            # arranca en http://localhost:3010
```

## Scripts

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Next.js dev server (puerto 3010, Turbopack) |
| `pnpm build` | Build producción |
| `pnpm typecheck` | TypeScript estricto |
| `pnpm lint` | ESLint |
| `pnpm test:visual` | Playwright visual regression vs prototipo |
| `pnpm test:visual:update` | Regenera baselines (solo si el prototipo cambió legítimamente) |
| `pnpm db:generate` | Prisma client |
| `pnpm db:migrate` | Prisma migrate dev |
| `pnpm db:studio` | Prisma Studio |

## Pixel-perfect (regla inviolable)

El diseño viene del prototipo Claude Design en `C:\Users\amiun\Desktop\Folio\` y es **intocable**. `folio.css` (12,199 líneas) se sirve byte-perfect como static asset desde `/public/folio.css`.

Cada PR/commit corre `pnpm test:visual` y compara contra los baselines de los 10 HTML originales. Cualquier diff > 0.1% bloquea merge.

Baselines: `tests/visual/baseline.spec.ts-snapshots/` (20 PNGs = 10 pantallas × light/dark a 1440×900).

## Estado de fases (plan maestro)

Ver `C:\Users\amiun\.claude\plans\estoy-trabajando-en-folio-velvet-torvalds.md`.

- [x] **F0** Bootstrap (Next.js + Prisma + Supabase + Playwright + baselines)
- [ ] **F1** Migración pixel-perfect de las 10 pantallas con mock data
- [ ] **F2** Migrations M01–M14 (schema + RLS + encriptación columnar)
- [ ] **F3** Auth + multi-tenancy + onboarding
- [ ] **F4** Data layer + Server Actions
- [ ] **F5** Google Calendar bidireccional
- [ ] **F6** WhatsApp Cloud API
- [ ] **F7** Booking público
- [ ] **F8** Analytics anonimizada (k-anonymity)
- [ ] **F9** Cron jobs (recordatorios)
- [ ] **F10** Compliance (consentimientos + audit + AFIP)
- [ ] **F11** Polish + a11y + observability + deploy

F12 (post-MVP, ~1 mes después): UI específica de Clínicas (selector multi-profesional, dashboard del Director, splits de comisión).

## Reglas inviolables

1. NO tocar `folio.css` (intacto desde el prototipo).
2. NO emojis en código, commits ni archivos productivos.
3. Una tarea a la vez, premium standard antes de avanzar.
4. RLS habilitada en la misma migration que crea cada tabla (nunca activar a posteriori).
5. Sin `--no-verify`, sin `--force`, sin push remoto sin confirmación del owner.
6. Sin inventar secrets: si falta una credencial, pedirla o documentarla.
