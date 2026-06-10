# PLAN — Folio multi-especialidad

> Plan maestro aprobado el 2026-06-10 (FASE 1 del proyecto multi-especialidad). La auditoría que lo fundamenta está en [docs/AUDIT.md](AUDIT.md). Este documento se actualiza al cerrar cada fase.

## Estado

| Fase | Descripción | Estado |
|------|-------------|--------|
| FASE 0 | Auditoría (workflow 27 agentes + verificación adversarial) | ✅ Completa — [AUDIT.md](AUDIT.md) |
| Paso 0 | docs/AUDIT.md + docs/PLAN.md | ✅ Completa (PR #26) |
| Fase A.1 | C1: drift de migraciones | ✅ Completa — M44–M48 ya estaban en repo vía PR #25; **M49 pendiente aplicada a prod el 10-jun (resolvió outage 42703 de ~11 h)**; fidelidad verificada por replay+diff; duplicados del ledger documentados (ver Addendum en AUDIT.md) |
| Fase A (resto) | A1, A2, M1/M2/M5/M6 | ⏳ En curso |
| Fase B | Specialty registry + slot genérico | 🔨 Código + M50 listos en branch `feat/fase-b-especialidades` (sin commitear). ⚠️ **M50 debe aplicarse a prod ANTES de mergear/deployar**: `lib/db/active-context.ts` selecciona `organization.especialidad` explícitamente — sin la columna, 42703 en TODA la app (mismo modo de falla del outage M49) |
| Fase C | Onboarding con especialidad + tiers Solo/Clinic | 🔨 Código listo en branch `feat/fase-c-onboarding-tiers` (sin commitear): C1 = selector especialidad+tipo en onboarding/configuración; C2 = pricing Clinic (`lib/billing/pricing.ts`), **M51** (gate de seats en RLS), equipo/invitaciones (`lib/db/members.ts` + sección Equipo + email + `/invitacion/[token]`), billing tier-aware. ⚠️ **M51 debe aplicarse a prod ANTES de mergear/deployar** (la UI de invitaciones asume la policy nueva; M51 es solo DROP+CREATE de policy — sin validación de datos, segura de aplicar) |
| Fase D | Herramientas clínicas cardiología + psicología | 🔨 Código listo en branch `feat/fase-d-herramientas` (sin commitear): D1 = persistencia del borrador del tab Plan; D2 = herramienta de cardiología (`cardiologia.cv.v1`); D3 = herramienta de psicología (`psicologia.escalas.v1`). **Sin migración nueva** — persiste sobre `sesion.tool_id`/`tool_data_cifrado` (M50, ya en prod) |
| Fase E | Integración E2E + PaymentProvider + cobro Clinic | 🔨 E1+E2 listos en worktree `feat/fase-e-payments` (sin commitear): E1 = abstracción `PaymentProvider` (`lib/payments/`) con implementación MP, callers migrados; E2 = cobro Clinic variable por seats (preapproval tier-aware, `syncSubscriptionAmount` + hooks de seats + cron, validación de cargo per-org, UI con drift). E2E por especialidad pendiente. **Checkpoint billing obligatorio antes de commit/deploy** |
| Fase F | Hardening final + regresión completa + readiness operacional | 🔨 En curso — compliance/billing/auth-defensa + **F-OPS** (env example, `/api/health`, `maxDuration`, `docs/LAUNCH-RUNBOOK.md`) listos en worktree `fix/fase-f-hardening` (sin commitear). M4/M8/M9 documentados como gaps post-launch (ver Fase F + runbook §5) |

## Objetivo

Transformar Folio en un SaaS médico **multi-especialidad** (quiropraxia, cardiología, psicología):

1. Selección de especialidad durante el onboarding, persistida por tenant.
2. En el "slot" clínico de la ficha del paciente (hoy: medidor de columna hardcodeado), la herramienta apropiada a cada especialidad. El medidor de columna queda SOLO para quiropraxia.
3. Todo cableado end-to-end: onboarding → selección → herramienta correcta → persistencia con RLS por tenant → respeto de tiers de pricing.

## Decisiones de alcance (usuario, 2026-06-10)

1. **Cardiología: AMBAS herramientas** — Panel CV (TA/FC seriado, factores de riesgo, score OMS/OPS, evolución) + registro de estudios (ECG/eco/ergometría/Holter).
2. **Psicología: AMBAS herramientas** — PHQ-9 + GAD-7 (scoring automático, severidad, curva longitudinal) + registro de sesión estructurado (MSE, objetivos terapéuticos).
3. **Tiers: Solo + Clinic** — Solo: independientes, precio actual ARS 30.000. Clinic: clínicas, ARS 100.000 base + 25.000 por seat (médico o secretaria). *Supuesto a confirmar en checkpoint Fase C: la base cubre al OWNER; cada member adicional = 1 seat.* Modelado + feature-gating primero; el cobro MP variable después, con checkpoint.
4. **Sin MP Connect** (marketplace/cobro a pacientes fuera de alcance) — solo suscripción SaaS + abstracción `PaymentProvider` lista para un proveedor europeo (MP no opera en España).

## Reglas transversales de ejecución

- Después de cada cambio sustancial: `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm build` — con output real como evidencia.
- Cada policy RLS nueva/modificada lleva test de aislamiento de dos tenants (pgtap en `supabase/tests/`, replay completo en CI sobre postgres:16 vanilla).
- Cambios de billing/RLS piden **checkpoint humano antes de commitear**.
- Migraciones aplicadas a prod **antes** de mergear el código que las usa (master auto-deploya; cliente Supabase `<any>` no avisa mismatches). Constraints que validan al instalar → pre-check de datos prod + rollout staged.
- Commits atómicos por tarea; PRs squash-merged con título conventional-commit.
- Subagentes/workflows para lo paralelizable; registry/onboarding/RLS/billing secuencial en hilo principal.
- **Numeración de migraciones nuevas: desde M50** (M49 la tomó `clinic_mode` del PR #25 — ver Addendum en AUDIT.md). Renumeración: especialidad → **M50** (A.2 quedó sin migración), tiers → **M51**.

## Fases

### Fase A — Hardening crítico/alto de la auditoría

**Objetivo**: cerrar C1, A1, A2 + los medios baratos (M1, M2, M5, M6) de [AUDIT.md](AUDIT.md).

- **A.1 (C1)**: recuperar M44–M48 de prod al repo (DDL vía MCP read-only), verificar que aplican en CI pgtap vanilla, documentar las 8 entradas duplicadas del ledger, `scripts/diff-migrations.mjs` en verde. *Solo repo — no toca prod.*
- **A.2 (A1)**: ~~M50 restringe INSERT `paciente_identidad`~~ **RECLASIFICADO**: el INSERT amplio es diseño documentado (M03 + capabilities de PR #25); sin migración. El residuo (identidad huérfana al fallar el INSERT de PHI por RLS) se cierra con el gate de M1 en `createPaciente`. Ver Addendum en AUDIT.md.
- **A.3 (A2)**: cron `app/api/cron/reconcile-suscripciones` (CRON_SECRET, cada 12 h): suscripciones con `mp_preapproval_id` y estado ≠ ACTIVA → GET preapproval → `applyMpPreapprovalUpdate`. Unit tests (divergencia, MP caído, idempotencia). **Checkpoint billing.**
- **A.4**: M1 (role check `createPacienteAction`), M2 (mensaje genérico signup), M5 (SQLSTATE 23505), M6 (deadline webhook ~20 s). M3/M4/M8/M9 y bajos: fix barato acá o documentado con plan (no bloquean Fase B).

**Aceptación**: suite completa verde + pgtap CI verde + evidencia. **CHECKPOINT humano.**

### Fase B — Specialty registry + slot genérico

**Objetivo**: el slot deja de ser SpineMap hardcodeado; quiropraxia pasa a ser una implementación más.

- **Registry** `lib/especialidades/registry.tsx`: `ESPECIALIDADES: Record<EspecialidadSlug, EspecialidadDef>` con `{ slug, nombre, badge, Tool, schema (zod), resumenSesion() }`. Slugs: `quiropraxia | cardiologia | psicologia`.
- **Interfaz del slot** `SpecialtyClinicalTool` (props): `{ value: unknown; onChange(next): void; readOnly?: boolean; historial: { fecha, toolData }[] }`.
- **DB (M50, aditiva)**: `organization.especialidad text NOT NULL DEFAULT 'quiropraxia'` + CHECK contra slugs; `sesion.tool_id text` + `sesion.tool_data_cifrado bytea` (cifrado app-side como SOAP — los datos de psicología/cardiología son PHI sensible; `vertebras_json` queda legacy de solo-lectura con fallback en el reader). RLS heredada — sin policies nuevas.
- **Refactor**: `lib/db/paciente-ficha.ts` generaliza `PlanData` → `{ toolId, toolData, toolHistorial }`; `TabPlan` ([components/paciente/paciente-detalle.tsx](../components/paciente/paciente-detalle.tsx)) renderiza `registry[org.especialidad].Tool`; badge dinámico; historial/Tab Sesiones usan `resumenSesion()`. SpineMap + spine-config se mueven al módulo de quiropraxia. Focus mode queda como preview etiquetado.

**Aceptación**: org quiro existente ve exactamente lo mismo que hoy (snapshot visual), datos legacy legibles, suite verde. **CHECKPOINT.**

> **Nota post-PR #25 (Fase C)**: el repo ya trae "clinic mode" — `organization.tipo` (`INDEPENDIENTE|CLINICA`, M49), tabla `member_invitation` + RPCs de invitación, y `lib/auth/capabilities.ts`. Los tiers se anclan en `organization.tipo` (Solo ↔ INDEPENDIENTE, Clinic ↔ CLINICA) en vez de una columna `plan_tier` nueva, y el gate de seats se integra con el flujo de invitaciones existente. Revisar capabilities/invitations antes de diseñar M52.

### Fase C — Onboarding con especialidad + tiers

- Selector de especialidad en Step 3 (Consultorio) — evita tocar el constraint de pasos (M20); persiste en `organization.especialidad`; templates de servicios del Step 6 ([lib/onboarding/templates.ts](../lib/onboarding/templates.ts)) por especialidad. Editable en /configuracion con advertencia si ya hay sesiones de otra herramienta.
- **Tiers (M51, aditiva)**: anclados en `organization.tipo` (M49: `INDEPENDIENTE|CLINICA`) — sin columna extra; gate de seats: SOLO = 1 member activo (invitar staff exige CLINIC); CLINIC = base ARS 100.000 + 25.000 × seat adicional (display + modelo; el cobro MP variable va en Fase E). Selección de tier en onboarding + /configuracion/billing. `computeAccessGate()` no cambia.

**Estado C2 (2026-06-10, branch `feat/fase-c-onboarding-tiers`)**:
- `lib/billing/pricing.ts`: `computeMonthlyPriceCents(tipo, seatsActivos)` — INDEPENDIENTE = `MP_PLAN_PRICE_CENTS`; CLINICA = 10.000.000 + 2.500.000 × max(0, seats−1) centavos, overrides `CLINIC_BASE_PRICE_CENTS`/`CLINIC_SEAT_PRICE_CENTS`. **SUPUESTO (a confirmar en checkpoint)**: la base cubre al OWNER; cada member activo adicional (cualquier rol, `deleted_at IS NULL`) = 1 seat. Tests en `tests/unit/clinic-pricing.test.ts`.
- **M51** (`20260610000051`): re-crea `member_invitation_insert_admin` exigiendo además `organization.tipo = 'CLINICA'` — el gate de tier vive en RLS, no solo en UI. Spec RLS de dos tenants en `tests/sql/M51_tier_seat_gate.spec.sql` (corre como rol `authenticated`).
- Equipo: `lib/db/members.ts` (list/create/revoke/remove, token sha256 espejo de M49, límite 20 pendientes), sección "Equipo" en /configuracion (upsell honesto en INDEPENDIENTE), email `member-invitation` fail-safe con link copiable, página pública `/invitacion/[token]` (signup mínimo sin org + accept RPC con consentimiento + rate limit), billing con desglose Clinic (display-only; preapproval intacto).
- ⚠️ **Deploy: aplicar M51 a prod (y registrarla canónica en `schema_migrations`) ANTES de mergear** — la policy es DROP+CREATE sin validación de datos (segura), pero el flujo de invitaciones de la app asume su semántica.

**Aceptación**: onboarding nuevo permite elegir especialidad y tier, persiste, servicios default coherentes. **CHECKPOINT humano (confirmar supuesto de seats).**

### Fase D — Herramientas de cardiología y psicología

Con la interfaz congelada en Fase B, generación en paralelo con subagentes (un agente por herramienta + uno de tests), revisión secuencial en hilo principal:

- **Cardiología** `lib/especialidades/cardiologia/`: (1) Panel CV — TA sistólica/diastólica, FC por sesión; checklist de factores de riesgo (tabaquismo, diabetes, dislipemia, HTA, antecedentes, sedentarismo); score de riesgo CV OMS/OPS; curva de evolución TA/FC. (2) Estudios — registros tipados (ECG/eco/ergometría/Holter/lab) con fecha, hallazgos, conclusión.
- **Psicología** `lib/especialidades/psicologia/`: (1) PHQ-9 (9 ítems 0–3) y GAD-7 (7 ítems 0–3) — scoring automático, banda de severidad estándar, curva longitudinal. (2) Registro estructurado — estado mental (apariencia, ánimo, afecto, pensamiento, riesgo), objetivos terapéuticos con progreso.
- Ambas: zod schema versionado (`v: 1`), cifrado app-side, tokens de folio.css (sin hex off-theme), es-AR voseo, estados de carga/error, a11y.

**Estado D (2026-06-10, branch `feat/fase-d-herramientas`)**:
- **D1 — persistencia del slot**: `lib/especialidades/draft.ts` (`buildUpsertSesionInput`, puro) + `saveSesionFichaAction` en `app/(app)/pacientes/actions.ts` — el toolId se deriva server-side de la especialidad de la org y el writer (`upsertSesion`) valida el toolData contra el schema del registry ANTES de cifrar. El tab Plan guarda herramienta + SOAP con «Guardar sesión» sobre el turno en curso (upsert 1:1 por turno, editable hasta el lock) y re-hidrata el borrador desde `plan.turnoActivo.toolDraft` (`lib/db/paciente-ficha.ts`), así un guardado posterior que solo toque el SOAP no pisa la herramienta. Tests en `tests/unit/sesion-draft.test.ts`.
- **D2 — cardiología** (`lib/especialidades/cardiologia/`, toolId `cardiologia.cv.v1`): panel TA/FC con rangos plausibles, checklist de factores, `scoreRiesgoCV` ORIENTATIVO (conteo simplificado OMS/OPS, etiquetado como tal), `deriveCardioSeries` + sparkline SVG con tokens, alta/quita de estudios tipados con historial. Tests en `tests/unit/cardiologia-schema.test.ts`.
- **D3 — psicología** (`lib/especialidades/psicologia/`, toolId `psicologia.escalas.v1`): PHQ-9 y GAD-7 con ítems es-AR, radios 0–3 por ítem (fieldset/legend), scoring automático al completar con bandas estándar, curva longitudinal de puntajes, aviso clínico sobrio si el ítem 9 del PHQ-9 > 0 o se registra riesgo (ideación/plan); registro de estado mental (selects cortos: apariencia/ánimo/afecto/pensamiento/riesgo) y objetivos terapéuticos con estado (en curso/logrado/pausado) + «retomar de la última sesión». Las escalas persisten SOLO completas (el borrador parcial avisa que no se puede guardar). Tests en `tests/unit/psicologia-schema.test.ts`.
- **Decisión UX/clínica — riesgo suicida en el resumen del historial**: `resumenSesionPsicologia` expone deliberadamente el flag categórico de riesgo («riesgo: ideación» / «riesgo: plan») en el resumen por sesión del historial de la ficha (HistorialReciente / TabSesiones). Razón: continuidad de cuidado — un indicador de riesgo suicida debe ser visible al escanear el historial; enterrarlo tras navegación extra (tab «Notas sensibles» o similar) aumenta el riesgo clínico de que un profesional lo pase por alto, que es peor que el costo de exposición. La exposición queda acotada en tres capas: (1) solo viaja el valor categórico del enum — nunca respuestas ítem por ítem (el detalle del PHQ-9, incluido el ítem 9, no entra al resumen) ni texto libre; (2) la ficha solo la ven roles clínicos — ASISTENTE se redirige server-side en `app/(app)/pacientes/[id]/page.tsx` y RLS (`caja_fuerte_profesional` / `can_read_clinical`) aplica por debajo; (3) el toolData persiste cifrado app-side (M50). Revisitar esta decisión si el historial de sesiones se expone alguna vez a roles no clínicos o a superficies fuera de la ficha.
- `lib/especialidades/placeholder-tool.tsx` eliminado (las tres especialidades tienen herramienta real). Sin migración nueva — todo persiste sobre M50.

**Aceptación**: paciente + sesión en org de cada especialidad → herramienta correcta, persiste, reload muestra datos, historial con `resumenSesion`. Suite verde. **CHECKPOINT.**

### Fase E — Integración E2E + PaymentProvider + cobro Clinic

- **E2E**: flujo completo por especialidad (onboarding → ficha → herramienta → sesión → booking público); booking muestra servicios por especialidad.
- **PaymentProvider**: interfaz `lib/payments/provider.ts` (`createSubscription/cancelSubscription/fetchSubscription/parseWebhook/planPricing`) con implementación MercadoPago (refactor sin cambio de comportamiento); interfaz lista para proveedor europeo, sin implementarlo.
- **Cobro Clinic en MP**: monto variable por seats (PUT preapproval al cambiar seats) + unit tests. **Checkpoint billing obligatorio antes de commit/deploy.**

**Estado E1 (2026-06-10, worktree `feat/fase-e-payments`)**: abstracción `PaymentProvider` en `lib/payments/` (`types.ts` interfaz + tipos de dominio con montos en centavos enteros, `mercadopago.ts` implementación, `index.ts` factory por env `PAYMENT_PROVIDER` con fallback a MP). Callers migrados (`lib/db/suscripcion.ts`, webhook, cron, billing actions); `lib/mercadopago/client.ts` queda como detalle de transporte (suma `updatePreapprovalAmount`, PUT con X-Idempotency-Key). La validación HMAC sigue intacta en `lib/mercadopago/webhook-security.ts` (transporte, no dominio). Tests en `tests/unit/payment-provider-mp.test.ts`.

**Estado E2 (2026-06-10, worktree `feat/fase-e-payments`) — cobro Clinic variable por seats**:
- `createOrRenewPendingSubscription`: el monto del preapproval y de `suscripcion.monto_cents` sale de `computeMonthlyPriceCents(org.tipo, seatsActivos)` al momento de activar — INDEPENDIENTE idéntico a siempre (plan vigente, ni siquiera cuenta members); CLINICA = base + seats.
- `syncSubscriptionAmount(orgId)` (`lib/db/suscripcion.ts`): orquestación sobre la decisión PURA `decideSubscriptionAmountSync` — solo CLINICA, solo ACTIVA/MOROSA con `mp_preapproval_id`, solo si `monto_cents` difiere → `provider.updateSubscriptionAmount` (MP primero) + UPDATE `monto_cents` + log estructurado sin PII (`org/suscripcion/seats/antes→después`). INDEPENDIENTE jamás se toca aunque difiera (regla dura). Errores de MP → `Result err` sin romper al caller; los recupera el cron.
- Hooks de seats (fire-and-forget `syncSubscriptionAmountInBackground`, jamás rompen el alta/baja): `acceptInvitationAction` (cubre alta Y revival — la RPC M49 revive con `ON CONFLICT … deleted_at = NULL`) y `removeMember`. El webhook de MP NO llama sync (evita loops PUT → webhook → PUT).
- Red de seguridad: `/api/cron/reconcile-suscripciones` corre `syncSubscriptionAmount` por cada suscripción del batch (no-op para INDEPENDIENTE/sin drift; repara PUTs perdidos y filas locales a medio escribir).
- `recordChargeAttempt` (M-BILL-2 per-org): el monto del cargo se valida contra `suscripcion.monto_cents` de ESA org (pura `validateChargeAmount`, tolerancia ±1 centavo, moneda ARS) — ya no contra el `MP_PLAN_PRICE_CENTS` global.
- UI `/configuracion/billing`: el desglose Clínica muestra el monto que MP debita hoy (`monto_cents`) y, si hay drift pendiente de sync, botón "Actualizar monto" (`syncClinicAmountAction`, gate OWNER + CLINICA). INDEPENDIENTE no cambia.
- Tests: `tests/unit/suscripcion-sync.test.ts` (decisión de sync + validación per-org Solo 30K / Clinic 150K / monto inesperado / moneda) y `tests/unit/payment-provider-mp.test.ts` (redondeo centavos↔ARS, PUT real con fetch stub).
- **Dato de prod**: hoy NO existe ninguna org CLINICA con suscripción (las 39 orgs son INDEPENDIENTE de backfill) — el cobro variable estrena limpio con orgs nuevas. Si alguna vez hay que migrar el monto de suscripciones CLINICA preexistentes, la vía es `syncSubscriptionAmount` manual (botón "Actualizar monto" o invocación dirigida), nunca un UPDATE a mano ni tocar INDEPENDIENTE.

**Aceptación**: regresión completa + evidencia. **CHECKPOINT.**

### Fase F — Hardening final

Bajos restantes de auditoría (B1–B8 no resueltos en A), accesibilidad/estados de carga y error, snapshots visuales parametrizados por especialidad, regresión total (`typecheck + lint + test:unit + build + pgtap CI + e2e`), actualización de docs/PLAN.md y CLAUDE.md. **CHECKPOINT final.**

**Estado F-OPS (2026-06-10, worktree `fix/fase-f-hardening`) — readiness operacional + runbook de lanzamiento (sin commitear, sin migración nueva):**

- **`.env.local.example`**: agregado `PAYMENT_PROVIDER=mercadopago` (selector de `lib/payments`, default seguro); **eliminado `NEXT_PUBLIC_MP_PLAN_PRICE_ARS`** (sin uso real — el display deriva de `MP_PLAN_PRICE_CENTS`; verificado por grep, cero `process.env` de esa var; corregida también la referencia stale en `docs/architecture/mp-subscription.md`); documentados `MP_PLAN_PRICE_CENTS` (3000000) y los tiers Clínica `CLINIC_BASE_PRICE_CENTS`/`CLINIC_SEAT_PRICE_CENTS` (10000000 / 2500000); agregado `META_APP_SECRET` (firma HMAC de webhooks WhatsApp, usado en `lib/whatsapp/webhook-security.ts`); aclarado Sentry — `NEXT_PUBLIC_SENTRY_DSN` es el único requerido, `SENTRY_DSN` es fallback server/edge **realmente leído** (no se borró, solo se demotó a opcional), `SENTRY_AUTH_TOKEN` es build-only (source maps), el runtime no lo lee.
- **`/api/health`**: agregados a `integrations` los flags informativos `cron_secret = Boolean(CRON_SECRET)` y `mp_webhook_secret = Boolean(MP_WEBHOOK_SECRET && MP_ACCESS_TOKEN)`. No bajan `ok` (los crones/webhook no son dependencia de boot), pero deben estar `true` antes del go-live (documentado en runbook §2).
- **`maxDuration = 60`** agregado a los route handlers pesados que faltaban y hacen MP o cifrado pesado: `mercadopago/webhook` (GETs a MP + writes), `me/export` (descifra PII + agrega tablas), `cron/account-purge` (loop de pseudonimización), `google/callback` (OAuth exchange + cifrado + sync). Las server actions de billing (`activateSubscriptionAction`/`syncClinicAmountAction`) llaman a MP pero **no tienen route propio** — en Next 15 `maxDuration` no aplica a módulos `'use server'` sueltos, así que **no** se puso un export no-op engañoso; heredan la duración de la page POST y queda documentado en runbook §2.3.
- **`docs/LAUNCH-RUNBOOK.md`** (NUEVO): pre-vuelo de envs prod (críticas vs opcionales, con modo de falla verificado por grep de `process.env.`), verificación go-live (curl `/api/health` + smoke manual), recomendaciones fuertes (Upstash+`UPSTASH_FAIL_CLOSED=true` por M3, `RESEND_API_KEY`), rollback (revert + redeploy; migraciones aditivas sin down), gaps aceptados (M3/M4/M8/M9 con riesgo/mitigación/cierre) y tabla de crones de `vercel.json` con horarios UTC.

**Gaps post-launch documentados** (mitigación vigente + plan de cierre en `docs/LAUNCH-RUNBOOK.md` §5):

- **M4** — `signOut()` no revoca el access token JWT ya emitido. *Mitigación*: scope global revoca refresh tokens de todos los devices + JWT de vida corta (1h) + RLS bloquea sin JWT válido. *Cierre*: tabla de revocación / `session_version` en `profile` validado en `getActiveSession()`, post-launch si se requiere revocación inmediata.
- **M8** — helpers `SECURITY DEFINER` (`user_org_ids`, `can_read_clinical`, `can_read_admin`, `user_role_in`, `user_member_id_in`) ejecutables por `authenticated` vía RPC. *Mitigación*: filtran por `auth.uid()` (solo scope propio, sin filas), la app no los invoca por RPC, `anon`/PUBLIC ya revocados en prod. *Cierre*: migración post-launch `REVOKE EXECUTE ... FROM authenticated, public` (sin uso RPC → segura).
- **M9** — `pg_trgm`/`btree_gist` en schema `public`. *Mitigación*: extensiones no sensibles, tablas que las usan exigen `auth.uid() IS NOT NULL`. *Cierre*: migración post-launch que las mueve a schema `extensions`.

## Verificación end-to-end

1. **Cada fase**: `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm build` — output real como evidencia.
2. **RLS**: tests pgtap dos-tenants por cada policy nueva/modificada; replay completo M01→M51 en CI.
3. **Billing**: unit tests de webhook (firma, idempotencia, 23505), reconciliación y pricing por seats.
4. **Manual**: onboarding de una org nueva por cada especialidad en local (puerto 3010) → ficha → herramienta → cerrar sesión de atención → reabrir y verificar persistencia; booking público `/book/[slug]`.
5. **Deploy**: migración aplicada a prod (registrada canónica en `schema_migrations`) ANTES de mergear código que la usa; `scripts/diff-migrations.mjs` verde post-apply.
