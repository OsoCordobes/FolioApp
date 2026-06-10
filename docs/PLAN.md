# PLAN — Folio multi-especialidad

> Plan maestro aprobado el 2026-06-10 (FASE 1 del proyecto multi-especialidad). La auditoría que lo fundamenta está en [docs/AUDIT.md](AUDIT.md). Este documento se actualiza al cerrar cada fase.

## Estado

| Fase | Descripción | Estado |
|------|-------------|--------|
| FASE 0 | Auditoría (workflow 27 agentes + verificación adversarial) | ✅ Completa — [AUDIT.md](AUDIT.md) |
| Paso 0 | docs/AUDIT.md + docs/PLAN.md | ✅ Completa (PR #26) |
| Fase A.1 | C1: drift de migraciones | ✅ Completa — M44–M48 ya estaban en repo vía PR #25; **M49 pendiente aplicada a prod el 10-jun (resolvió outage 42703 de ~11 h)**; fidelidad verificada por replay+diff; duplicados del ledger documentados (ver Addendum en AUDIT.md) |
| Fase A (resto) | A1, A2, M1/M2/M5/M6 | ⏳ En curso |
| Fase B | Specialty registry + slot genérico | ⏳ Pendiente |
| Fase C | Onboarding con especialidad + tiers Solo/Clinic | ⏳ Pendiente |
| Fase D | Herramientas clínicas cardiología + psicología | ⏳ Pendiente |
| Fase E | Integración E2E + PaymentProvider + cobro Clinic | ⏳ Pendiente |
| Fase F | Hardening final + regresión completa | ⏳ Pendiente |

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
- **Tiers (M51, aditiva)**: anclados en `organization.tipo` (M49: `INDEPENDIENTE|CLINICA`) — evaluar si hace falta columna extra; gate de seats: SOLO = 1 member activo (invitar staff exige CLINIC); CLINIC = base ARS 100.000 + 25.000 × seat adicional (display + modelo; el cobro MP variable va en Fase E). Selección de tier en onboarding + /configuracion/billing. `computeAccessGate()` no cambia.

**Aceptación**: onboarding nuevo permite elegir especialidad y tier, persiste, servicios default coherentes. **CHECKPOINT humano (confirmar supuesto de seats).**

### Fase D — Herramientas de cardiología y psicología

Con la interfaz congelada en Fase B, generación en paralelo con subagentes (un agente por herramienta + uno de tests), revisión secuencial en hilo principal:

- **Cardiología** `lib/especialidades/cardiologia/`: (1) Panel CV — TA sistólica/diastólica, FC por sesión; checklist de factores de riesgo (tabaquismo, diabetes, dislipemia, HTA, antecedentes, sedentarismo); score de riesgo CV OMS/OPS; curva de evolución TA/FC. (2) Estudios — registros tipados (ECG/eco/ergometría/Holter/lab) con fecha, hallazgos, conclusión.
- **Psicología** `lib/especialidades/psicologia/`: (1) PHQ-9 (9 ítems 0–3) y GAD-7 (7 ítems 0–3) — scoring automático, banda de severidad estándar, curva longitudinal. (2) Registro estructurado — estado mental (apariencia, ánimo, afecto, pensamiento, riesgo), objetivos terapéuticos con progreso.
- Ambas: zod schema versionado (`v: 1`), cifrado app-side, tokens de folio.css (sin hex off-theme), es-AR voseo, estados de carga/error, a11y.

**Aceptación**: paciente + sesión en org de cada especialidad → herramienta correcta, persiste, reload muestra datos, historial con `resumenSesion`. Suite verde. **CHECKPOINT.**

### Fase E — Integración E2E + PaymentProvider + cobro Clinic

- **E2E**: flujo completo por especialidad (onboarding → ficha → herramienta → sesión → booking público); booking muestra servicios por especialidad.
- **PaymentProvider**: interfaz `lib/payments/provider.ts` (`createSubscription/cancelSubscription/fetchSubscription/parseWebhook/planPricing`) con implementación MercadoPago (refactor sin cambio de comportamiento); interfaz lista para proveedor europeo, sin implementarlo.
- **Cobro Clinic en MP**: monto variable por seats (PUT preapproval al cambiar seats) + unit tests. **Checkpoint billing obligatorio antes de commit/deploy.**

**Aceptación**: regresión completa + evidencia. **CHECKPOINT.**

### Fase F — Hardening final

Bajos restantes de auditoría (B1–B8 no resueltos en A), accesibilidad/estados de carga y error, snapshots visuales parametrizados por especialidad, regresión total (`typecheck + lint + test:unit + build + pgtap CI + e2e`), actualización de docs/PLAN.md y CLAUDE.md. **CHECKPOINT final.**

## Verificación end-to-end

1. **Cada fase**: `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm build` — output real como evidencia.
2. **RLS**: tests pgtap dos-tenants por cada policy nueva/modificada; replay completo M01→M51 en CI.
3. **Billing**: unit tests de webhook (firma, idempotencia, 23505), reconciliación y pricing por seats.
4. **Manual**: onboarding de una org nueva por cada especialidad en local (puerto 3010) → ficha → herramienta → cerrar sesión de atención → reabrir y verificar persistencia; booking público `/book/[slug]`.
5. **Deploy**: migración aplicada a prod (registrada canónica en `schema_migrations`) ANTES de mergear código que la usa; `scripts/diff-migrations.mjs` verde post-apply.
