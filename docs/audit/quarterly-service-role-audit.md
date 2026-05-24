# Folio · Auditoría trimestral de service-role bypass

`createSupabaseServiceClient()` crea un cliente Supabase con `SUPABASE_SERVICE_ROLE_KEY`, que tiene **`BYPASSRLS`**: lee y escribe cualquier fila de cualquier tenant sin que las policies RLS apliquen. Su uso es legítimo y necesario en muchos casos (cron jobs sin sesión, OAuth callbacks pre-creación de profile, RPCs administrativas), pero **cada call site representa un riesgo de cross-tenant leak si no está gateado correctamente**.

Esta doc define el proceso de re-auditoría trimestral para evitar drift.

---

## Procedimiento

Una vez por trimestre (próximas fechas abajo), un encargado:

1. Corre el grep:
   ```bash
   grep -rln "createSupabaseServiceClient" app/ lib/
   ```
2. Por cada archivo en el output:
   - Confirma que tiene **una de las siguientes** salvaguardas explícitas ANTES del primer uso del service client:
     - **Bearer secret** (`process.env.CRON_SECRET`) — para crons y webhooks externos.
     - **Webhook signature verify** (`timingSafeEqual` con HMAC del payload) — para MercadoPago, WhatsApp.
     - **`auth.getUser()` o `getActiveContext()`** — para Server Actions invocadas por user authenticated. El service client se usa después de confirmar identidad para operaciones que cruzan tenant (ej. lookup de slug público) o que necesitan RLS bypass (ej. bootstrap atómico).
     - **`turnstileVerify` + rate-limit** — para endpoints anónimos (booking público, signup).
     - **`checkAdminGate({ mode: ... })`** + Bearer — para endpoints administrativos.
   - Si NO tiene salvaguardas claras, abre issue + commit fix antes del cierre de la auditoría.
3. Compara contra la lista esperada abajo. Cualquier path nuevo agregado al codebase debe haber sido auditado en un PR; los unexpected son drift.
4. Actualiza la fecha de "Próxima auditoría" abajo.

---

## Call sites esperados (snapshot 2026-05-24, Sprint 2 T2.6)

| Archivo | Salvaguarda | Notas |
|---|---|---|
| `app/(app)/configuracion/datos/actions.ts` | `getActiveContext()` user-scoped | Habeas Data ARCO — siempre filtra por org del user |
| `app/(app)/configuracion/datos/page.tsx` | Server Component bajo `(app)` layout autenticado | RLS aplica via `getActiveContext` |
| `app/(public)/book/[slug]/actions.ts` | Public + Turnstile + rate-limit + Zod | El service client se usa porque el path es anónimo (no hay session); el slug es validado y todas las ops están scoped por `org.id` derivado del slug |
| `app/(public)/book/[slug]/page.tsx` | Public read-only (solo info pública) | Service client lee `organization.publica*` campos solamente |
| `app/(public)/onboarding/actions.ts` | `auth.getUser()` + Turnstile + rate-limit | M33 bootstrap RPC + helpers; valida user authenticated antes |
| `app/api/admin/confirm-user/route.ts` | Bearer + `checkAdminGate(prod-escape-hatch)` | Sprint 0 T0.4 cierra C3 |
| `app/api/admin/seed-hoy-demo/route.ts` | Bearer + `checkAdminGate(prod-disabled)` | Sprint 0 T0.5 cierra C3 |
| `app/api/analytics/refresh/route.ts` | Bearer (Vercel cron) | Trigger interno de Vercel |
| `app/api/cron/account-purge/route.ts` | Bearer (Vercel cron) | M24 purge schedule |
| `app/api/cron/dispatch-recordatorios/route.ts` | Bearer (Vercel cron) | Envío de recordatorios WhatsApp/email |
| `app/api/cron/google-watch-renew/route.ts` | Bearer (Vercel cron) | Renueva watches de Google Calendar |
| `app/api/cron/maintenance/route.ts` | Bearer (Vercel cron) | Phase 9 M35 maintenance |
| `app/api/health/route.ts` | Sin gate — público | Solo hace 1 SELECT contra `organization` para health check; sin filtros explícitos por org porque el endpoint es público y solo reporta booleanos |
| `app/api/whatsapp/webhook/route.ts` | HMAC signature `X-Hub-Signature-256` + `timingSafeEqual` | Verificación de firma de Meta |
| `lib/afip/comprobantes.ts` | Llamado desde Server Actions ya gateadas | Helper; no es entry point |
| `lib/auth/find-user-by-email.ts` | Helper invocado por endpoints ya gateados | `confirm-user` (gated) y `onboarding/actions` (auth.getUser) |
| `lib/booking/availability.ts` | Llamado desde booking público (gated) | Helper de availability calc |
| `lib/db/onboarding-resume.ts` | Llamado solo desde `onboarding/page.tsx` (con user authenticated) | Helper de resume state |
| `lib/db/recordatorios.ts` | Helper invocado desde `cron/dispatch-recordatorios` (Bearer gated) | |
| `lib/db/suscripcion.ts` | Helper invocado desde MP webhook (HMAC gated) + Server Actions con auth | |

---

## Reglas para nuevos call sites

Si en un PR se agrega un nuevo uso de `createSupabaseServiceClient()`:

1. El PR debe incluir el call site en esta tabla con su salvaguarda explícita.
2. El reviewer debe confirmar que la salvaguarda es real y aplicada **antes** del primer uso del client.
3. Si el call site es para un endpoint admin nuevo, debe usar `checkAdminGate({ mode })` del helper común (`lib/security/admin-gate.ts`).

---

## Calendario de auditorías

| Fecha | Estado | Encargado |
|---|---|---|
| 2026-05-24 | ✅ Snapshot inicial (Sprint 2 T2.6) | Plan post-auditoría |
| **2026-08-24** | ⏳ Próxima | Agendar en calendario antes de la fecha |
| 2026-11-24 | — | |
| 2027-02-24 | — | |

---

## Reminder

El owner del proyecto debe agendar un reminder recurrente (Google Calendar / Linear cycle / etc.) para el día 24 del mes 2 de cada trimestre. Trigger: revisar este doc + correr el grep + reconciliar.
