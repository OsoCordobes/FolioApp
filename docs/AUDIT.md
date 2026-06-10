# Auditoría FASE 0 — Folio (2026-06-10)

> **Metodología**: workflow ultracode `folio-fase0-audit` (run `wf_ce202f02-62c`) — 27 agentes: 5 auditores en paralelo (RLS por migraciones M01–M43, RLS contra DB de producción vía Supabase MCP solo-lectura, auth, billing MercadoPago, placeholders) + 1 agente de reconocimiento de arquitectura + **verificación adversarial independiente de cada hallazgo** (un verificador por hallazgo intenta refutarlo con evidencia archivo:línea). Los hallazgos crítico/altos fueron además re-verificados a mano contra la DB de producción (`grkpayhxndztlfwxobnt`). Salida cruda completa: `docs/audit/2026-06-10-fase0-workflow-raw.json`.
>
> **Resultado**: 20 hallazgos confirmados, 1 refutado. Estado general sólido: RLS ENABLE+FORCE en 30+ tablas con policies por `user_org_ids()`, auth con `getUser()` verificado + Zod + Turnstile + `safeRedirect`, webhook MP con HMAC timing-safe, `app/dev/*` gateado, sin claves de prueba ni mocks en código core.

## Verificación adicional contra producción (a mano, 2026-06-10)

- **Drift precisado (C1)**: `supabase_migrations.schema_migrations` en prod contiene **5 migraciones que no están en el repo** — `20260609000044 M44_slot_ocupado_rpc`, `...45 M45_security_hardening`, `...46 M46_perf_rls_initplan_fk_indexes`, `...47 M47_transicion_trigger_security_definer`, `...48 M48_pago_audit_trigger_fix` (aplicadas 9-jun) — más **8 entradas duplicadas** del ledger: re-registros lowercase de m27–m36 (26-may, versiones `20260526124148..124616`) y un `M43_booking_prefs` duplicado (`20260607193806`).
- **M8 parcialmente mitigado en prod**: `pg_proc.proacl` de `user_org_ids`/`can_read_clinical`/`can_read_admin`/`user_role_in` ya NO incluye `anon` ni PUBLIC (revocado, presumiblemente por la M45 faltante). `authenticated` conserva EXECUTE — evaluar al recuperar M45.
- **M9 vigente en prod**: `pg_trgm` y `btree_gist` siguen en schema `public`.

## Addendum 2026-06-10 (post-auditoría) — desenlace de C1 e incidente de producción

La auditoría corrió contra un checkout local de master **desactualizado** (`e2ac2cd`). Al sincronizar con origin apareció el **PR #25** (mergeado 2026-06-09 23:36Z, "pre-demo audit"), que ya había commiteado **M44–M48 al repo** más una **M49_clinic_mode** nueva (organization.tipo INDEPENDIENTE/CLINICA + member_invitation + RPCs de invitación) y código que depende de ella (`lib/auth/capabilities.ts`, `lib/db/active-context.ts` selecciona `organization.tipo`).

- **Incidente detectado y resuelto**: M49 estaba mergeada y auto-deployada pero **no aplicada a prod** → `getActiveContext` fallaba con `42703 column organization.tipo does not exist` para **todo usuario autenticado** desde el deploy del 9-jun ~23:36Z. Se aplicó `M49_clinic_mode` a prod vía `scripts/push-pending-migrations.mjs` (versión canónica `20260609000049` en el ledger) el 10-jun ~10:45Z. Verificado: 39 orgs backfilleadas a `INDEPENDIENTE`, RPCs creadas, health OK.
- **Fidelidad del repo verificada**: replay completo M01→M49 en Docker (postgres:17, receta CI) + diff de inventario normalizado contra prod (columnas, policies, índices, triggers, funciones): **cero diferencias semánticas** (solo difieren comentarios `--` dentro de cuerpos de funciones, cosmético). El repo es fuente fiel del schema de prod.
- **C1 queda así**: drift de archivos resuelto (PR #25) + pendiente aplicado (M49). Residual: **8 entradas duplicadas en el ledger** (`20260526124148..124616` re-registros lowercase de m27–m36, y `20260607193806` duplicado de M43) — son inofensivas para `scripts/diff-migrations.mjs` (solo chequea dirección repo→prod) y se conservan como historia; **no borrar sin decisión explícita**. Causa raíz: aplicar migraciones vía MCP `apply_migration` genera versiones con timestamp propio en vez de la canónica del archivo — usar siempre `scripts/push-pending-migrations.mjs`.
- **Edits a M01/M27 en PR #25**: benignos (`set check_function_bodies = off` en M01; COMMENT ON POLICY best-effort en M27) — compatibilidad de replay, no cambian el schema resultante.
- **Renumeración**: la próxima migración libre es **M50** (el plan original usaba M49 para el fix RLS de A1).
- **A1 reclasificado — diseño documentado, NO se aplica migración**: el INSERT amplio de `paciente_identidad` es intencional (comentario en M03:201-203: *"Cualquier rol con rol activo puede crear (ASISTENTE para walk-in, PROFESIONAL para primera consulta)"*) y está ratificado por la matriz de capabilities del PR #25 (`canManagePacienteContact: true` para todos los roles). La separación de privilegios ya existe a nivel RLS: la ficha **clínica** (`paciente`, PHI) solo la insertan OWNER/PROFESIONAL/DIRECTOR. El residuo real era **M1**: `createPaciente()` crea el PAR identidad+PHI sin gate — para un rol no clínico el INSERT de PHI fallaba por RLS DESPUÉS de crear la identidad, y el rollback manual choca con la policy `paciente_identidad_no_delete` → **identidad huérfana**. Fix aplicado: gate por `capabilitiesFor().canCreatePacienteClinical` en `lib/db/pacientes.ts` antes del primer INSERT.

## Resumen por severidad

| ID | Sev | Hallazgo | Ubicación | knownGap |
|----|-----|----------|-----------|----------|
| C1 | CRÍTICO | CRITICAL: Database schema drift — 10+ unapplied migrations in repo vs production | `supabase/migrations/ (missing 20260526124148 through 20260609000048):N/A` | no |
| A1 | ALTO | INSERT sobre paciente_identidad permite COORDINADOR y ASISTENTE crear pacientes | `/supabase/migrations/20260518000003_M03_paciente_split.sql:197-204` | no |
| A2 | ALTO | Orphaned preapproval risk — local state diverges from MP after webhook loss | `lib/db/suscripcion.ts:282-343` | no |
| M1 | MEDIO | Role verification missing in createPacienteAction server action | `app/(app)/pacientes/actions.ts:30-54` | no |
| M2 | MEDIO | Possible user enumeration in signup error messages | `app/(public)/onboarding/actions.ts:146-172` | no |
| M3 | MEDIO | Rate limiting defaults to fail-open without Upstash in production | `lib/security/rate-limit.ts:95-116` | no |
| M4 | MEDIO | signOut() does not invalidate other active sessions globally | `app/(public)/login/actions.ts:198-209` | no |
| M5 | MEDIO | Webhook signature validation — HMAC comparison using string substring instead of error code | `lib/db/suscripcion.ts:418` | no |
| M6 | MEDIO | Webhook processing — potential timeout >22s without explicit deadline | `app/api/mercadopago/webhook/route.ts:87-136` | no |
| M7 | MEDIO | Activation banner misrepresents state — shows pending confirmation without validation | `components/billing/billing-page.tsx:122,` | no |
| M8 | MEDIO | INFO: SECURITY DEFINER helper functions (can_read_clinical, can_read_admin, user_org_ids, etc.) are publicly executable via Supabase RPC | `supabase/migrations/20260518000001_M01_extensions_and_helpers.sql:supabase/migrations/20260518000001_M01_extensions_and_helpers.sql:55-84` | no |
| M9 | MEDIO | WARN: PostgreSQL extensions pg_trgm, btree_gist installed in public schema instead of extensions schema | `<prod-db>:supabase/migrations/20260518000001_M01_extensions_and_helpers.sql:30-33` | no |
| B1 | BAJO | Anon key Supabase expuesta | `.env.production:10,21` | no |
| B2 | BAJO | is_internal_account — bypass assignment is auditable but not restricted at RLS level | `supabase/migrations/20260527000037_M37_organization_internal_flag.sql:33-34` | no |
| B3 | BAJO | Cookies secure flag based on NODE_ENV instead of VERCEL_ENV | `lib/db/session.ts:130-136` | no |
| B4 | BAJO | Preapproval creation — idempotency key may not prevent duplicates across minute boundaries | `lib/mercadopago/client.ts:168-171` | no |
| B5 | BAJO | Consent metadata (IP, User-Agent) stored plaintext | `app/(public)/onboarding/actions.ts:216-221` | no |
| B6 | BAJO | MEDIUM: rejectUnauthorized: false in pg direct client for admin migrations endpoint | `app/api/admin/migrate/route.ts:app/api/admin/migrate/route.ts:148` | sí |
| B7 | BAJO | INFO: Analytics fact tables initially created without RLS, later hardened in M42 | `supabase/migrations/20260518000015_M15_analytics_schema.sql vs 20260601000042_M42_analytics_rls.sql:supabase/migrations/20260518000015_M15_analytics_schema.sql` | sí |
| B8 | BAJO | Back-URL validation — relies on webhook, not server-side verification | `app/(app)/configuracion/billing/page.tsx, app/api/mercadopago/webhook/route.ts:200` | no |

---

## Hallazgos en detalle

### Severidad: CRÍTICO

#### C1 · CRITICAL: Database schema drift — 10+ unapplied migrations in repo vs production

- **Dimensión**: rls-prod · **Categoría**: Schema Management / Version Control · **knownGap**: no
- **Ubicación**: `supabase/migrations/ (missing 20260526124148 through 20260609000048):N/A — metadata table`
- **Evidencia**: Production DB shows applied versions: 20260526124148 (m27_storage_clinical), 20260526124302 (m31_paciente_identidad_caja_fuerte), ..., 20260609000048 (M48_pago_audit_trigger_fix). Repository supabase/migrations/ stops at 20260607000043 (M43_booking_prefs). Query: SELECT version FROM supabase_migrations.schema_migrations WHERE version >= '20260526' — returns 18 rows, repo contains ~10 M0X files before this range.
- **Impacto**: Untracked schema changes in production create audit trail gaps, risk of undocumented RLS changes, and inability to reproduce prod schema locally. Violates append-only migration convention documented in context.
- **Fix propuesto**: 1. Export applied migrations 20260526124148..20260609000048 from production Supabase via supabase db pull or pg_dump. 2. Add all missing .sql files to supabase/migrations/ directory. 3. Commit to repo with clear audit trail of what was applied. 4. Establish automated parity check in CI (compare supabase_migrations.schema_migrations vs local migration files).

<details><summary>Veredicto adversarial (confirmado como CRÍTICO)</summary>

Verificación adversarial completada. El hallazgo es REAL y CRÍTICO.

EVIDENCIA VERIFICADA:
1. Consulta SQL directa a supabase_migrations.schema_migrations en producción (grkpayhxndztlfwxobnt) retorna 21 filas desde 20260526 a 20260609000048.
2. Repositorio (master) contiene solo 43 migraciones (M01-M43), siendo la última 20260607000043_M43_booking_prefs.sql commiteada el 8 de junio.
3. 5 migraciones NO presentes en repo pero presentes en producción:
   - 20260609000044: M44_slot_ocupado_rpc
   - 20260609000045: M45_security_hardening
   - 20260609000046: M46_perf_rls_initplan_fk_indexes
   - 20260609000047: M47_transicion_trigger_security_definer
   - 20260609000048: M48_pago_audit_trigger_fix
4. Historial de commits (git log master) NO contiene ningún commit posterior a e2ac2cd (8 jun) que añada M44-M48.
5. No hay documentación de aplicación manual (como la que existe para M27 en m27-manual-application.md).
6. Denominaciones sugieren cambios críticos: "security_definer", "security_hardening", "rls_initplan_fk_indexes" — áreas sensibles para Ley 26.529.

IMPACTO PARA SAAS MÉDICO CON PHI:
- Schema drift sin trazabilidad = incapacidad de auditar cambios de RLS aplicados en producción
- Políticas de acceso (can_read_clinical, role gates) potencialmente modificadas sin registro en repo
- Riesgo de bypass involuntario de controls de multi-tenancy
- 10-year audit trail (Ley 26.529 art. 18) comprometido si los cambios de schema no están documentados

NO ESTÁ MITIGADO NI DOCUMENTADO en known-gaps.md (único precedente M27 está explícitamente documentado en docs/audit/m27-manual-application.md).

</details>

### Severidad: ALTO

#### A1 · INSERT sobre paciente_identidad permite COORDINADOR y ASISTENTE crear pacientes

- **Dimensión**: rls-repo · **Categoría**: RLS / Escalada de Privilegios · **knownGap**: no
- **Ubicación**: `/supabase/migrations/20260518000003_M03_paciente_split.sql:197-204`
- **Evidencia**: CREATE POLICY paciente_identidad_insert_admin
  ON paciente_identidad FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR', 'PROFESIONAL', 'COORDINADOR', 'ASISTENTE')
  );
- **Impacto**: COORDINADOR y ASISTENTE pueden crear registros PII sin validacion clinica
- **Fix propuesto**: Limitar a OWNER, DIRECTOR, PROFESIONAL

<details><summary>Veredicto adversarial (confirmado como ALTO)</summary>

Verificación de hallazgo de RLS/escalada de privilegios en INSERT paciente_identidad. Evidencia exacta: archivo C:/Users/amiun/Desktop/folio-app/supabase/migrations/20260518000003_M03_paciente_split.sql líneas 197-204 contiene la policy CREATE POLICY paciente_identidad_insert_admin que permite ('OWNER', 'DIRECTOR', 'PROFESIONAL', 'COORDINADOR', 'ASISTENTE'). No hay mitigación posterior en migraciones M04-M43 (grep de DROP POLICY devolvió cero resultados). No hay validación de rol en lib/db/pacientes.ts createPaciente() — simplemente delega a Supabase RLS. No hay guards UI en componentes/página que bloqueen COORDINADOR/ASISTENTE (botón "Nuevo paciente" sin validación de rol). El comentario intencional en línea 201-203 ("Cualquier rol con rol activo puede crear... ASISTENTE para walk-in") documenta que fue deliberado, pero NO MITIGADO con controls downstream. Restricción EXISTE en paciente.insert_clinical (línea 267, solo OWNER/PROFESIONAL/DIRECTOR), pero eso solo previene que la PHI se cree — deja la PII huérfana, lo cual es estado incoherente. Para SaaS médico con Ley 25.326 real, COORDINADOR/ASISTENTE creando PII (nombre, DNI, teléfono cifrados) sin validación clínica es escalada de privilegios REAL. known-gaps.md Y backend-audit-2026-05-19.md no reportan esto como excepción aceptada (documentada). Severidad: ALTO (no crítico porque PHI está bloqueado, pero PII de paciente es data sensible y requiere consentimiento mediado por profesional per Ley 25.326 art. 4-6).

</details>

#### A2 · Orphaned preapproval risk — local state diverges from MP after webhook loss

- **Dimensión**: billing · **Categoría**: Sincronización de Estado · **knownGap**: no
- **Ubicación**: `lib/db/suscripcion.ts:282-343`
- **Evidencia**: applyMpPreapprovalUpdate only writes if webhook arrives. No background sync job. If MP webhook is lost (network between MP and Folio, Vercel down during delivery), suscripcion.estado stays PENDIENTE_ACTIVACION forever, but MP may have already moved to ACTIVA and started charging.
- **Impacto**: Crítico para clientes: Si un webhook se pierde, el servidor local piensa que la suscripción está PENDIENTE_ACTIVACION pero MP ya la activó y está cobrando. El user no ve acceso (bloqueado por access-gate), pero SÍ está siendo cobrado en MP. No hay reconciliación automática. User debe descubrirlo vía refreshSubscriptionAction (manual), lo cual no es automático.
- **Fix propuesto**: Implementar background cron job (e.g., cada 12h) que: (1) Itera suscripciones con estado != ACTIVA, (2) GETs el preapproval real desde MP, (3) Compara last_modified con lo guardado, (4) Si MP muestra ACTIVA, llama applyMpPreapprovalUpdate. Esto es 'lazy reconcile' mencionada en comments pero nunca implementada como job.

<details><summary>Veredicto adversarial (confirmado como ALTO)</summary>

Verificación completa de la evidencia: (1) línea 282-343 de lib/db/suscripcion.ts contiene applyMpPreapprovalUpdate exactamente como citado. (2) Búsqueda exhaustiva de reconciliación automática: vercel.json lista 4 crons (dispatch-recordatorios, google-watch-renew, analytics/refresh, maintenance) — NINGUNO toca suscripción. (3) La "lazy reconcile" del comentario línea 279 refiere a refreshSubscriptionAction (actions.ts:82-109), que es MANUAL (requiere click del usuario), no background job. (4) Flujo webhook confirmado: app/api/mercadopago/webhook/route.ts línea 89-96 es el ÚNICO trigger automático; sin él, estado local diverge. (5) Riesgo concreto: webhook perdido → estado PENDIENTE_ACTIVACION local vs ACTIVA en MP → acceso bloqueado pero billing activo. (6) Sin cron automático de reconciliación (confirmado grep en app/api/cron/). (7) No documentado en known-gaps.md ni en backend-audit-2026-05-19.md. Severidad ALTO (no CRÍTICO) porque es billing/access divergence en single-tenant, pero crítico para ese tenant: suscriptor paga sin acceso = SaaS médico con PHI en riesgo. Impacto directo: 1) User experience (acceso bloqueado), 2) Billing leakage (cobros sin servicio), 3) Compliance (Ley 26.529 HCE: paciente no puede ser visto si org bloqueada, pero cobros continúan).

</details>

### Severidad: MEDIO

#### M1 · Role verification missing in createPacienteAction server action

- **Dimensión**: auth · **Categoría**: Autorización insuficiente · **knownGap**: no
- **Ubicación**: `app/(app)/pacientes/actions.ts:30-54`
- **Evidencia**: export async function createPacienteAction(
  input: CreatePacienteActionInput,
): Promise<Result<{ id: string }>> {
  const parsed = createPacienteActionSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Datos del paciente inválidos.", parsed.error.message);
  }
  const d = parsed.data;

  const result = await createPaciente({
    nombre: d.nombre,
    apellido: d.apellido,
    telefono: d.telefono,
    email: d.email && d.email.length > 0 ? d.email : undefined,
    motivoConsulta: d.motivoConsulta && d.motivoConsulta.length > 0 ? d.motivoConsulta : undefined,
    tipoDoc: d.tipoDoc ?? "DNI",
    numeroDoc: d.numeroDoc && d.numeroDoc.length > 0 ? d.numeroDoc : undefined,
    tags: [],
  });
  if (!result.ok) return result;
  revalidatePath("/pacientes");
  return ok({ id: result.data.id });
}
- **Impacto**: La acción crea pacientes PHI sin verificar el rol del usuario. No hay verificación de ctx.data.session.role como se hace en billing/actions.ts. Si bien la RLS del lado de la DB debería proteger, el diseño de defensa en profundidad requiere verificación de rol en la acción.
- **Fix propuesto**: Agregar verificación explícita: const ctx = await getActiveContext(); if (!ctx.ok) return ctx; if (!['OWNER', 'DIRECTOR', 'PROFESIONAL'].includes(ctx.data.session.role)) return err('forbidden', 'No tenés permiso para crear pacientes.');

<details><summary>Veredicto adversarial (confirmado como MEDIO)</summary>

HALLAZGO REAL. Evidencia verificada: (1) app/(app)/pacientes/actions.ts líneas 30-54 citadas correctamente — createPacienteAction NO llama getActiveContext() ni valida rol explícitamente. (2) Mitigación DB probada: supabase/migrations/20260518000003_M03_paciente_split.sql líneas 197-204 (paciente_identidad policy) y 262-268 (paciente policy) VERIFICAN rol en WITH CHECK. (3) Flujo: middleware.ts → app/(app)/layout.tsx getActiveContext() → RLS enforcement en Supabase client. SEVERIDAD MEDIO (no ALTO): la RLS DE FACTO rechaza INSERTs sin permisos (verificable en DB), pero FALTA defensa en profundidad en la action (anti-patrón comparado con billing/actions.ts que sí verifica explícitamente). Cross-tenant leak imposible porque organization_id viene de session autenticado. Para SaaS médico con PHI, la ausencia de explicit role-check en una server action que crea PHI es un anti-patrón válido de reportar, pero no es bypass de auth. NO es gap conocido (no listado en known-gaps.md)."

</details>

#### M2 · Possible user enumeration in signup error messages

- **Dimensión**: auth · **Categoría**: Enumeración de usuarios · **knownGap**: no
- **Ubicación**: `app/(public)/onboarding/actions.ts:146-172`
- **Evidencia**: if (createErr) {
    if (createErr.message.toLowerCase().includes("already") || createErr.message.toLowerCase().includes("registered")) {
      // El user ya existe...
      const existing = await findUserByEmail(service, email);
      if (!existing) {
        return {
          ok: false,
          error: "Ya existe una cuenta con este email. Iniciá sesión desde /login.",
        };
      }
- **Impacto**: El mensaje revela si una dirección de email está registrada. Permite enumerar usuarios válidos en el sistema.
- **Fix propuesto**: Devolver siempre mensaje genérico: 'Email o cuenta duplicado. Verificá tu entrada o contactá soporte.' Loguear error específico en Sentry internamente.

<details><summary>Veredicto adversarial (confirmado como MEDIO)</summary>

El hallazgo de user enumeration en el mensaje de error de signup es REAL y VERIFICABLE. El código en líneas 152-163 de app/(public)/onboarding/actions.ts devuelve "Ya existe una cuenta con este email" cuando Supabase Auth reporta un error que contiene "already"/"registered", revelando que una dirección de email está registrada en el sistema. El flujo es: (1) signUpAndInitOrganization intenta createUser, (2) si falla con "already registered", (3) llama findUserByEmail vía RPC, (4) si existe el user devuelve el mensaje enum "Ya existe", (5) el frontend muestra este mensaje en línea 373 de onboarding-app.tsx. No hay sanitización del mensaje error antes de devolverlo al usuario. La mitigación de rate-limit (50/h por IP + 50/h por email en líneas 104-116) previene ataque enumerativo en masa pero NO cierra la fuga de información por email. La severidad es medio: para un SaaS médico con datos de PHI real, la enumeración de usuarios registrados facilita phishing dirigido y social engineering contra profesionales médicos, violando principios de Ley 25.326 art. 4 sobre minimización de datos. No es bypass de auth ni fuga cross-tenant, pero es una fuga de información real e intencional. No está documentado en docs/audit/known-gaps.md como excepción aceptada, por lo que knownGap=false.

</details>

#### M3 · Rate limiting defaults to fail-open without Upstash in production

- **Dimensión**: auth · **Categoría**: Rate limiting · **knownGap**: no
- **Ubicación**: `lib/security/rate-limit.ts:95-116`
- **Evidencia**: if (process.env.NODE_ENV === "production") {
        console.warn(
          `[rate-limit] Upstash no configurado en producción — fail-open para scope="${scope}"...`,
        );
      }
      return { ok: true, remaining: options.maxRequests, resetIn: 0 };
- **Impacto**: Si Upstash no está configurado, signup/password-reset permiten sin límite de rate. Exposición a brute-force y credential-stuffing hasta que UPSTASH_FAIL_CLOSED=true se active.
- **Fix propuesto**: Verificar /api/health reporta integrations.upstash_redis=true. Documentar en known-gaps.md si aún no provisioned. Activar UPSTASH_FAIL_CLOSED=true en Vercel una vez listo.

<details><summary>Veredicto adversarial (confirmado como MEDIO)</summary>

Hallazgo verificado como real. Evidencia de `lib/security/rate-limit.ts:95-116` es exacta: cuando Upstash no está configurado en producción (exception `upstash_not_configured`), el código retorna fail-open `{ ok: true, remaining: maxRequests, resetIn: 0 }` si UPSTASH_FAIL_CLOSED no es explícitamente "true". Esto aplica a toda llamada a `rateLimit()`. Sin embargo, hay un error en la afirmación del auditor previo: `requestPasswordReset` (login/actions.ts:121-140) NO TIENE ningún rate-limit de Folio (ni siquiera llama a limitByIp/limitByKey), independientemente de Upstash. El hallazgo mezcla dos problemas distintos: (1) password-reset sin rate-limit (real, siempre), y (2) signup permitiendo sin límite si Upstash falla (real, pero mitigado por Turnstile captcha + Supabase Auth built-in limits + 50/h per-IP/per-email dual-cascade cuando Upstash funciona). La severidad se confirma como MEDIO para un SaaS médico con PHI: la ventana de exposición es temporal (demo phase hasta provisionar Upstash), Turnstile es obligatorio en producción, Supabase Auth tiene rate-limits built-in, y está parcialmente documentado en archivos de auditoría. El operador puede activar UPSTASH_FAIL_CLOSED=true post-provisioning para hardening. No está en known-gaps.md como gap aceptado, pero sí está en la arquitectura de rate-limit como decisión deliberada con fail-open-by-default (ver commit f69cd1b post-mortem).

</details>

#### M4 · signOut() does not invalidate other active sessions globally

- **Dimensión**: auth · **Categoría**: Revocación de sesiones · **knownGap**: no
- **Ubicación**: `app/(public)/login/actions.ts:198-209`
- **Evidencia**: export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  // ... Supabase signOut() solo invalida sesión actual
- **Impacto**: Si usuario tiene sesiones en múltiples navegadores/dispositivos, logout solo invalida la sesión activa. Otras sesiones permanecen válidas. Para SaaS médico con PHI/PII, debería haber revocación global.
- **Fix propuesto**: Implementar tabla de revocación (token_revocations) o RPC que incremente session_version en profile. Luego getActiveSession() valida JWT.session_version == profile.session_version. O documentar como gap aceptado si mitigado por session expiry 1h.

<details><summary>Veredicto adversarial (confirmado como MEDIO)</summary>

HALLAZGO PARCIALMENTE REFUTADO pero REAL con MATIZ. El código en líneas 198-209 está verificado. Ahora bien: (1) El llamado a signOut() usa el scope DEFAULT 'global' (no 'local'), lo que REVOCA REFRESH TOKENS de todos los dispositivos — esto CONTRADICE la evidencia que dice "solo invalida sesión actual". (2) SIN EMBARGO, el hallazgo es PARCIALMENTE VÁLIDO: aunque los refresh tokens se revoquen globalmente, Supabase Auth NO PUEDE revocar access token JWTs que ya fueron emitidos. El JWT de 1 hora seguirá siendo válido hasta su expiración (config.toml:160 = jwt_expiry = 3600). (3) Para un SaaS médico con PHI/PII, si un usuario cierra sesión en el navegador A pero sus cookies/storage se perpetúan en navegador B, y luego alguien accede a B en las siguientes 60 minutos, podría reutilizar el viejo JWT. (4) Mitigación existente: RLS bloquea sin JWT válido, middleware refresca sesión en cada request, acceso tokens de 1 hora limitan la ventana. SEVERIDAD: 'medio' porque requiere ambos: (a) capacidad de acceso físico/robo del JWT y (b) ventana de 1 hora para explotar. NO es 'alto' porque falta paso de comprometer el navegador/cookies. NO es 'bajo' porque PHI/PII en SaaS médico hace cada segundo crítico. Recomendación: Documentar explícitamente que `signOut(){ scope: 'global' }` es el comportamiento actual, o si se quiere revocación inmediata de JWTs, implementar token blacklist/revocation table (ej: profile.session_version incrementado en logout, validado en getActiveSession). CONOCIMIENTO PREVIO: NO documentado en known-gaps.md."

</details>

#### M5 · Webhook signature validation — HMAC comparison using string substring instead of error code

- **Dimensión**: billing · **Categoría**: Integridad de Webhook · **knownGap**: no
- **Ubicación**: `lib/db/suscripcion.ts:418`
- **Evidencia**: if (insErr && !insErr.message.includes("duplicate key")) { return err(...); }
- **Impacto**: Si Supabase o PostgreSQL cambia el error message text (ej. por cambio de idioma, versión, o variante de constraint name), la validación de duplicado puede fallar silenciosamente, causando que un INSERT fallido se reporte como db_error en vez de ser tratado como idempotencia OK. Esto puede hacer que el webhook reintente desde MP y potencialmente cause desincronización de estado.
- **Fix propuesto**: Cambiar a validación por código de error: `if (insErr && insErr.code !== '23505') { return err(...); }` (23505 es el código Postgres para UNIQUE violation). Verificar qué código devuelve Supabase con su tratamiento de errores.

<details><summary>Veredicto adversarial (confirmado como MEDIO)</summary>

REAL but MISCHARACTERIZED: The report title falsely claims this is about "webhook signature validation — HMAC comparison," but evidence actually points to IDEMPOTENCY error detection in `recordChargeAttempt()` at lib/db/suscripcion.ts:418. The code uses `insErr.message.includes("duplicate key")` (fragile string matching) instead of `error.code === "23505"` (robust error code checking), which is already used correctly elsewhere in the same file (pedidos.ts:234). This IS a real pattern inconsistency: if Supabase/PostgreSQL changes error message text (language variant, version difference, constraint name variation), the duplicate key detection fails silently, causing failed INSERT to be returned as db_error instead of idempotent success — which triggers MercadoPago retry logic instead of graceful duplicate handling. For a medical SaaS processing real charges, this creates potential for charge records inconsistency. However, it is NOT a cryptographic/signature validation vulnerability. Severity confirmed as MEDIO (not webhook integrity bypass, but database state consistency issue affecting financial transactions). NOT documented in known-gaps.md."

</details>

#### M6 · Webhook processing — potential timeout >22s without explicit deadline

- **Dimensión**: billing · **Categoría**: Disponibilidad de Webhook · **knownGap**: no
- **Ubicación**: `app/api/mercadopago/webhook/route.ts:87-136`
- **Evidencia**: try { switch (payload.type) { ... await getPreapproval(dataId); ... await getAuthorizedPayment(dataId); ... recordChargeAttempt(...); } } catch (e) { return 503; }
- **Impacto**: El webhook handler hace múltiples awaits (GET a MP API, INSERT a DB, UPDATE a DB) sin timeout explícito. Si cualquier operación cuelga (DB lock, MP API lento, network issue), el request puede exceder el timeout de MP (~22s). MP considerará fallo y retentará, pero si el primer request finalmente completa después de 23s, se puede crear duplicado de cargo_suscripcion.id aunque el UNIQUE(mp_payment_id) lo evite — el INSERT fallará pero el handler ya respondió 200, confundiendo el retry logic.
- **Fix propuesto**: Agregar AbortController con timeout de 20s al handler. Algún así: `const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 20000);` — si se agota, responder 503 INMEDIATAMENTE sin esperar queries pendientes.

<details><summary>Veredicto adversarial (confirmado como MEDIO)</summary>

El hallazgo es técnicamente real y verificable. El webhook handler en app/api/mercadopago/webhook/route.ts (líneas 87-136) carece de AbortController o timeout explícito. Las llamadas internas a getPreapproval() (línea 91), getAuthorizedPayment() (línea 101), y recordChargeAttempt() (línea 102) pueden tardar arbitrariamente sin restricción de tiempo, heredando solo el timeout de la plataforma Vercel (60s) que es MAYOR que el timeout de MercadoPago (~22s). El código evidence citado es exacto: try-switch-await sin deadline. La severidad se confirma como MEDIA (no CRITICO) porque: (1) existe mitigación parcial via UNIQUE(mp_payment_id) en recordChargeAttempt (línea 418 en suscripcion.ts) que evita duplicados de cargo via 23505 duplicate key handling; (2) applyMpPreapprovalUpdate tiene protección via CR-3 (línea 311 en suscripcion.ts) contra eventos stale comparando last_modified; (3) el impacto es confusión de estado de billing y potencial retry loop de MP, no fuga de PHI ni bypass de RLS. No se trata de un gap conocido ya documentado en docs/audit/known-gaps.md. Aunque existe cierta resiliencia en la capa de datos, un timeout explícito en el handler (20s) como propone el auditor sería la mitigación correcta para garantizar respuesta oportuna a MP dentro de su ventana de timeout.

</details>

#### M7 · Activation banner misrepresents state — shows pending confirmation without validation

- **Dimensión**: billing · **Categoría**: Claridad de UX / Integridad · **knownGap**: no
- **Ubicación**: `components/billing/billing-page.tsx:122, 499-523`
- **Evidencia**: Line 122: `{activationOk && subscription?.estado !== "ACTIVA" ? <ActivationPendingBanner /> : null}` — activationOk = URL param `?activation=ok`, which can be present even if webhook failed. Line 515-517 message: 'Si tu pago se procesó, el estado va a aparecer activo en unos segundos.'
- **Impacto**: El parámetro `activation=ok` es set por el redirect de back_url (fuera de control de Folio; lo genera MP Browser redirect). Si la autorización en MP falló por cualquier razón (tarjeta rechazada en last step, timeout, user cerró navegador), el user AÚN VE 'se está procesando'. Pueden esperar minutos esperando sin saber que el webhook nunca va a llegar. Se confía en que el user presione 'Refrescar estado' (botón manual), pero no es automático.
- **Fix propuesto**: No mostrar ActivationPendingBanner basándose SOLO en el query param. Opción 1: Auto-poll el estado cada 2s durante 30s y actualizar silenciosamente. Opción 2: Cambiar el mensaje a 'Volviste de Mercado Pago. Si no ves cambios en 30s, presioná Refrescar.' Opción 3: hacer que activationOk=ok sea seteado por el servidor después de validar el webhook, no por el redirect.

<details><summary>Veredicto adversarial (confirmado como MEDIO)</summary>

HALLAZGO CONFIRMADO. El auditor identifica correctamente que línea 122 de billing-page.tsx (ahora línea 61 de page.tsx) muestra ActivationPendingBanner basándose ÚNICAMENTE en el parámetro URL `?activation=ok`, sin validación server-side. 

EVIDENCIA VERIFICADA:
- C:/Users/amiun/Desktop/folio-app/app/(app)/configuracion/billing/page.tsx:61: `activationOk={sp.activation === "ok"}` — derivado puro del param URL
- C:/Users/amiun/Desktop/folio-app/lib/db/suscripcion.ts:217: `backUrl: \`${input.appUrl}/configuracion/billing?activation=ok\`` — seteado por MP sin validación local
- C:/Users/amiun/Desktop/folio-app/components/billing/billing-page.tsx:515-517: mensaje "en unos segundos" implica procesamiento automático

MITIGACIONES ENCONTRADAS:
1. refreshSubscriptionAction() (actions.ts:82-109) valida contra MP API — pero es MANUAL, requiere click del usuario
2. Webhook subscription_preapproval (api/mercadopago/webhook:89-96) actualiza estado a ACTIVA si llega
3. Validación de moneda/monto en recordChargeAttempt (suscripcion.ts:382-393)

ESCENARIO DE FALLA:
Si el webhook falla por timeout/network (MP reintenta 3 veces con backoff, línea 23-26 de webhook doc), el usuario sigue viendo "se está procesando" y espera automático. El estado REAL en DB permanece PENDIENTE_ACTIVACION. Solo al presionar "Refrescar estado" (botón manual) se reconcilia con MP.

NO ES GAP CONOCIDO: docs/audit/known-gaps.md no documenta este issue (verificado línea 1-179).

SEVERIDAD CONFIRMADA COMO MEDIO (no critico):
- NO es fuga de datos (PHI/PII safe en DB)
- NO es bypass de autenticación (RLS intacto)
- NO es fraude de cobro (MP webhook es source of truth, no el banner)
- SI es confusión UX: mensaje misleading sobre timing automático
- SI es degradación operacional: sin feedback en webhook failure (edge […]

</details>

#### M8 · INFO: SECURITY DEFINER helper functions (can_read_clinical, can_read_admin, user_org_ids, etc.) are publicly executable via Supabase RPC

- **Dimensión**: rls-prod · **Categoría**: RLS / Function Authorization · **knownGap**: no
- **Ubicación**: `supabase/migrations/20260518000001_M01_extensions_and_helpers.sql:supabase/migrations/20260518000001_M01_extensions_and_helpers.sql:55-84 (all 8 helper SECURITY DEFINER definitions without REVOKE)`
- **Evidencia**: Functions: public.can_read_admin, public.can_read_clinical, public.user_org_ids, public.user_role_in, public.user_member_id_in. All are SECURITY DEFINER, GRANT EXECUTE authenticated (detected via information_schema.role_table_grants). Callable via /rest/v1/rpc/<function_name>. Supabase advisor 0029: 'Signed-In Users Can Execute SECURITY DEFINER Function ... Revoke EXECUTE, switch to SECURITY INVOKER, or move out of exposed API schema'.
- **Impacto**: Functions are intended to be used INSIDE RLS policies, not directly by clients. However, they ARE callable: a signed-in attacker could call /rest/v1/rpc/user_org_ids to learn which orgs they have access to, or /rest/v1/rpc/can_read_clinical to probe access. All functions do return boolean/text/uuid (no direct row leakage), so risk is INFORMATION DISCLOSURE (learning scope) not PHI breach. Mitigated by: functions only return current user's own scoping info, not other users' data.
- **Fix propuesto**: 1. REVOKE EXECUTE on these 8 functions from public/authenticated: REVOKE ALL ON FUNCTION public.user_org_ids() FROM authenticated, public; (repeat for can_read_admin, can_read_clinical, user_member_id_in, user_role_in, has_caja_fuerte_blocking_access, paciente_es_pseudonimizado, profesional_attended_paciente). 2. Create internal-only wrapper functions if app code relies on /rest/v1/rpc calls (not detected in code search). 3. Add to rls-matrix.md: 'These helper functions are FOR POLICY USE ONLY; direct RPC calls should fail.'

<details><summary>Veredicto adversarial (confirmado como MEDIO)</summary>

HALLAZGO CONFIRMADO CON MATICES.

VERIFICACIÓN DE EVIDENCIA:
- Archivo citado C:\Users\amiun\Desktop\folio-app\supabase\migrations\20260518000001_M01_extensions_and_helpers.sql lines 55-139 CONFIRMA 5 funciones SECURITY DEFINER sin REVOKE: user_org_ids (L55), user_role_in (L71), can_read_clinical (L91), can_read_admin (L115), user_member_id_in (L127).
- Las 3 funciones restantes (has_caja_fuerte_blocking_access M31:L67, profesional_attended_paciente M32:L60) TIENEN REVOKE explícito.
- paciente_es_pseudonimizado (M13:L226) NO tiene REVOKE.
- Grep verificó que el app code (app/*, lib/*) NO invoca estas 5 funciones via RPC — solo invoca bootstrap_org_atomic, user_providers_by_email, find_user_id_by_email que TIENEN REVOKE (M38, M31, M32).

MITIGACIÓN CONCRETA:
- Las 5 funciones filtran por auth.uid() → solo retornan scoping del usuario actual, NO datos de otros usuarios.
- Retorna tipos simples (uuid, boolean, text) sin row data.
- No hay leak cross-tenant: la restricción org IN (SELECT public.user_org_ids()) en RLS políticas confirma que un usuario solo puede conocer sus propias orgs.
- El hallazgo de Supabase advisor 0029 es VÁLIDO (best practice REVOKE), pero el RIESGO REAL es bajo: información disclosure de scope del usuario actual, no auth bypass ni PHI leak.

ESTADO ACTUAL:
- La exposición RPC es REAL (funciones son públicamente ejecutables si el usuario es authenticated).
- PERO: mitigado por auth.uid() + lack of app-side RPC calls + return types (no rows).
- Sin REVOKE explícito, sigue siendo un gap vs best practices (Supabase advisor 0029).

SEVERIDAD AJUSTADA A MEDIO:
- No es BAJO porque la exposición RPC existe y las funciones se intendían solo para RLS.
- No es ALTO porque el riesgo actual es información disclosure de scope propio del usuario (conocimiento ya i […]

</details>

#### M9 · WARN: PostgreSQL extensions pg_trgm, btree_gist installed in public schema instead of extensions schema

- **Dimensión**: rls-prod · **Categoría**: Database Security / Configuration Drift · **knownGap**: no
- **Ubicación**: `<prod-db>:supabase/migrations/20260518000001_M01_extensions_and_helpers.sql:30-33 (CREATE EXTENSION pg_trgm, btree_gist without SCHEMA clause)`
- **Evidencia**: Query: SELECT extname, nspname FROM pg_extension WHERE extname IN ('pg_trgm', 'btree_gist'). Result: btree_gist in public, pg_trgm in public. Standards: pgcrypto in extensions, pgsodium in pgsodium schema. Supabase advisor lint 0014: 'Extension `pg_trgm` is installed in the public schema. Move it to another schema.'
- **Impacto**: Extensions in public schema are visible and callable by all roles including anon. While pg_trgm/btree_gist are non-sensitive, this violates security hygiene and creates precedent for future extensions. If a future dangerous extension (e.g., shell commands) is installed in public, the pattern is established.
- **Fix propuesto**: CREATE SCHEMA IF NOT EXISTS extensions_private; CREATE EXTENSION pg_trgm SCHEMA extensions_private; (repeat for btree_gist). Update migration M01 to include explicit schema placement for all extensions via M49 migration.

<details><summary>Veredicto adversarial (confirmado como MEDIO)</summary>

Hallazgo CONFIRMADO EN PRODUCCIÓN. Verificación: (1) Archivos M01 y M40 citan correctamente líneas 30-33 y 34 donde pg_trgm y btree_gist se crean sin SCHEMA. (2) Consulta a pg_extension en prod (grkpayhxndztlfwxobnt) retorna pg_trgm y btree_gist en public schema. (3) Supabase advisor lint 0014 emite WARN sobre ambas extensiones. (4) NO HAY mitigación posterior en M02-M43: ninguna migración mueve o reemplaza estas extensiones. (5) Riesgo minimizado por RLS en tablas que las usan (codigo_cie10, turno ambas requieren auth.uid() IS NOT NULL), pero es configuration drift real. Severidad bajada de ALTO a MEDIO porque: no bypass inmediato de auth, no fuga directa de PHI, pero viola security hygiene y crea precedent. Para SaaS médico post-MVP esto debería corregirse. NO está en known-gaps.md. Evidencia citable: C:\Users\amiun\Desktop\folio-app\supabase\migrations\20260518000001_M01_extensions_and_helpers.sql:30-33, M40:34, y resultado de `SELECT extname, nspname FROM pg_extension WHERE extname IN ('pg_trgm', 'btree_gist')` en prod.

</details>

### Severidad: BAJO

#### B1 · Anon key Supabase expuesta

- **Dimensión**: placeholders · **Categoría**: Credenciales · **knownGap**: no
- **Ubicación**: `.env.production:10,21`
- **Evidencia**: JWT valido para grkpayhxndztlfwxobnt
- **Impacto**: Queries contra prod
- **Fix propuesto**: Rotar + eliminar .env.production

<details><summary>Veredicto adversarial (confirmado como BAJO)</summary>

The vulnerability report is technically REAL — the anon key IS exposed in .env.production with a valid JWT token for the production project (grkpayhxndztlfwxobnt). However, the SEVERITY is LOW due to multiple concrete mitigations that make the practical risk minimal:

1. **File location is correct** (lines 10 and 21 in .env.production) - verified.

2. **JWT validity confirmed**: Valid HS256 JWT for anon role, project grkpayhxndztlfwxobnt, not expired until May 2036.

3. **CRITICAL RLS MITIGATION**: The code implements defense-in-depth via Row Level Security:
   - ALL 30+ tables have RLS ENABLED and FORCED (per backend-audit-2026-05-19.md §2: "RLS: 30 tablas con ENABLE + FORCE ROW LEVEL SECURITY")
   - ALL SELECT policies on sensitive tables (organization, paciente, paciente_identidad, sesion, etc.) use `USING (id IN (SELECT public.user_org_ids()))` 
   - The user_org_ids() function returns membership from the member table WHERE profile_id = auth.uid() AND deleted_at IS NULL (M01, lines 55-66)
   - For an unauthenticated anon JWT, auth.uid() is NULL → user_org_ids() returns EMPTY SET → NO rows match → ZERO data accessible
   - Even public catalogs (codigo_cie10, obra_social) require `auth.uid() IS NOT NULL`, blocking anon access entirely (M04, lines 160-162, 169-171)

4. **File not in version control**: .env.production is correctly gitignored (.gitignore line 34: `.env*`) and has zero commits in history. Not exposed via GitHub.

5. **Practical attack surface**: An attacker with the anon key cannot:
   - Read any organization's data (RLS blocks via user_org_ids() returning ∅)
   - Read any patient PII/PHI (requires PROFESIONAL/OWNER membership)
   - Read audit logs (requires OWNER role + org membership)
   - Read catalogs (requires auth.uid() IS NOT NULL)
   - Write to an […]

</details>

#### B2 · is_internal_account — bypass assignment is auditable but not restricted at RLS level

- **Dimensión**: billing · **Categoría**: Integridad de Bypass · **knownGap**: no
- **Ubicación**: `supabase/migrations/20260527000037_M37_organization_internal_flag.sql:33-34`
- **Evidencia**: ALTER TABLE organization ADD COLUMN is_internal_account boolean NOT NULL DEFAULT false; COMMENT: 'only mutable via service-role.' Trigger tg_audit_organization_internal_flag logs flips.
- **Impacto**: El flag `is_internal_account` es mutable SOLO via service_role (bypassa RLS) per comment, pero no hay RLS policy que lo ENFORCE. Un auth.uid() user con OWNER role podría teoretically execute UPDATE organization SET is_internal_account = true IF the Supabase RLS policies don't block it. The comment says 'only via service-role' but there's no explicit RLS policy denying user roles. It relies on a comment (soft governance).
- **Fix propuesto**: Add explicit RLS policy: `CREATE POLICY no_user_set_internal_account ON organization FOR UPDATE USING (...) WITH CHECK (is_internal_account IS NOT DISTINCT FROM old.is_internal_account);` — esto hace que cualquier UPDATE que intente cambiar is_internal_account falle a nivel RLS, no solo via comentario.

<details><summary>Veredicto adversarial (confirmado como BAJO)</summary>

El hallazgo es real. La columna `is_internal_account` en la tabla `organization` (M37, líneas 33-34) tiene un comentario que dice "Only mutable via service-role", pero NO hay una política RLS explícita que lo enforce. El RLS policy `org_update_owner` (M02 líneas 263-266) permite a cualquier OWNER de la organización ejecutar UPDATE en TODOS los campos, incluyendo `is_internal_account`, sin restricción a nivel de columna. La única mitigación es a nivel aplicativo: la función `saveConsultorio()` en lib/db/configuracion.ts (líneas 229-244) explícitamente excluye este campo del patch que se persiste, pero un usuario OWNER podría contornearlo ejecutando SQL directo en Supabase Studio. El trigger `tg_audit_organization_internal_flag` (M37 líneas 47-96) proporciona un audit trail de cualquier flip, por lo cual el riesgo es auditable y no es una fuga cross-tenant silenciosa. Para un SaaS médico: severidad BAJA porque (1) requiere que el usuario sea OWNER legítimo, (2) el cambio es visible en UI (sidebar badge per comentario en layout.tsx línea 52-55), (3) es completamente auditable, (4) no afecta integridad de datos clínicos/financieros. No se documenta como gap conocido en docs/audit/known-gaps.md.

</details>

#### B3 · Cookies secure flag based on NODE_ENV instead of VERCEL_ENV

- **Dimensión**: auth · **Categoría**: Configuración de cookies · **knownGap**: no
- **Ubicación**: `lib/db/session.ts:130-136`
- **Evidencia**: secure: process.env.NODE_ENV === "production",
- **Impacto**: En preview deploys Vercel, NODE_ENV='production' pero no es prod real. Aunque Vercel siempre usa HTTPS, el matiz es inconsistente.
- **Fix propuesto**: Cambiar a: secure: process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production'. O documentar que preview también requiere HTTPS.

<details><summary>Veredicto adversarial (confirmado como BAJO)</summary>

El hallazgo sobre NODE_ENV en lugar de VERCEL_ENV para el flag `secure` en cookies ES REAL y PRECISO: línea 133 de lib/db/session.ts contiene exactamente `secure: process.env.NODE_ENV === "production"`. Sin embargo, está COMPLETAMENTE MITIGADO por HSTS (Strict-Transport-Security: max-age=63072000; includeSubDomains; preload) aplicado en next.config.ts línea 72, que FUERZA HTTPS en todos los subdominios incluyendo preview deploys de Vercel. La cookie afectada (folio.active_org) es una preferencia de org, no de auth, y está protegida por RLS + validación de membership en lib/db/session.ts (líneas 101-127). El riesgo teórico de interceptación MITM en previews es remoto porque Vercel aplica HTTPS a nivel infra, y los headers de HSTS proporcionan defensa de profundidad. No hay fuga de PHI, no hay bypass de auth. Inconsistencia válida: otros endpoints SÍ usan VERCEL_ENV === "production" (admin-gate.ts, mercadopago/webhook-security.ts, whatsapp/webhook-security.ts), así que refactorizar por consistencia tendría valor, pero NO por seguridad. El auditor perdió de vista la mitigación del HSTS header. Severidad confirmada como BAJO.

</details>

#### B4 · Preapproval creation — idempotency key may not prevent duplicates across minute boundaries

- **Dimensión**: billing · **Categoría**: Idempotencia · **knownGap**: no
- **Ubicación**: `lib/mercadopago/client.ts:168-171`
- **Evidencia**: const idemKey = `preapproval-${input.externalReference}-${Math.floor(Date.now() / 60000)};` — Idempotency key is based on minute-granularity timestamp.
- **Impacto**: Si un user presiona 'Activar suscripción' dos veces en el mismo minuto pero en diferentes seconds (ej. t=00:30.5 y t=00:55.9), ambos requests usan el MISMO idemKey porque ambos caen en el mismo minuto floor. MP puede rechazar el segundo como duplicate o aceptarlo dependiendo del buffering. Low severity porque: (1) es un edge case (user tiene que hacer click 2x rápido), (2) los do-once buttons típicamente previenen esto en la UI (pending state).
- **Fix propuesto**: Cambiar la granularidad: `Math.floor(Date.now() / 1000)` (segundos) o mejor aún, usar un request-level UUID que se persista en la suscripción local para evitar collisions totalmente.

<details><summary>Veredicto adversarial (confirmado como BAJO)</summary>

FINDING CONFIRMED AS REAL BUT APPROPRIATELY MITIGATED. Evidence:

1. **Idempotency key granularity is minute-level (VERIFIED)**: 
   - lib/mercadopago/client.ts:170 shows `const idemKey = \`preapproval-${input.externalReference}-${Math.floor(Date.now() / 60000)}\`;`
   - Two requests within the same minute generate identical keys
   - external_reference is org-specific (lib/db/suscripcion.ts:199 shows `externalReference: \`org_${input.organizationId}\``)
   - This is REAL and auditor's evidence is accurate

2. **Practical vulnerability is LOW due to UI-level mitigation (VERIFIED)**:
   - components/billing/billing-page.tsx:70 imports useTransition hook
   - Line 191, 226: button has \`disabled={pending}\` prop
   - The onActivate handler (line 75) wraps the server action in startTransition(), which immediately sets pending=true
   - Button becomes disabled before request even reaches server
   - User cannot physically click twice within same minute because: (a) button disabled after first click, or (b) window.location.href redirects to MP within 100-500ms

3. **Additional protections (VERIFIED)**:
   - lib/db/suscripcion.ts:80: CONSTRAINT suscripcion_unica_por_org UNIQUE (organization_id) prevents duplicate rows locally
   - Line 223-225: .upsert(..., {onConflict: 'organization_id'}) ensures idempotent local update
   - MP API's idempotency header guarantee: identical payload + identical key = same response

4. **Auditor already acknowledged this (VERIFIED)**:
   - Claim explicitly states: 'Low severity porque: (1) es un edge case (user tiene que hacer click 2x rápido), (2) los do-once buttons típicamente previenen esto en la UI (pending state)'
   - Auditor correctly identified the button protection as the primary mitigation
   - Severity rating of 'bajo' is defensible […]

</details>

#### B5 · Consent metadata (IP, User-Agent) stored plaintext

- **Dimensión**: auth · **Categoría**: Almacenamiento de datos · **knownGap**: no
- **Ubicación**: `app/(public)/onboarding/actions.ts:216-221`
- **Evidencia**: p_consent_ip: ip,
      p_consent_user_agent: userAgent,
- **Impacto**: [gap conocido en known-gaps.md DOC] IP es PII y se almacena plaintext. Útil para auditoría pero debería cifrarse si se retiene >N días.
- **Fix propuesto**: Ya documentado en known-gaps.md. Sin acción requerida fase actual. Si auditoría posterior rechaza, encriptar IP en consentimiento table.

<details><summary>Veredicto adversarial (confirmado como BAJO)</summary>

El hallazgo es REAL y VERIFICADO: consent_pii_ip (inet) y consent_pii_user_agent (text) se almacenan en plaintext en profile.* sin encriptación. Las líneas 216-221 de app/(public)/onboarding/actions.ts son exactas. Sin embargo, la severidad es correctamente "bajo" por: (1) RLS profile_select_self en M02 bloquea acceso cross-user — cada profesional solo ve sus propios datos de consentimiento; (2) propósito legítimo documentado en M23/M33 como audit trail para Ley 25.326 art. 14; (3) no es fuga cross-tenant. El almacenamiento plaintext es una decisión arquitectónica defensible para compliance, no una vulnerabilidad. NO está documentado como known gap en known-gaps.md (pero SÍ está comentado en M23 y M33). Refutación fallida: la evidencia es correcta y el estado actual es conforme al diseño declarado."

</details>

#### B6 · MEDIUM: rejectUnauthorized: false in pg direct client for admin migrations endpoint

- **Dimensión**: rls-prod · **Categoría**: Transport Security / TLS · **knownGap**: sí
- **Ubicación**: `app/api/admin/migrate/route.ts:app/api/admin/migrate/route.ts:148`
- **Evidencia**: Line 148: `ssl: { rejectUnauthorized: false }` in pg.Client constructor for POSTGRES_URL_NON_POOLING connection. Comment lines 138-144 explain: 'cert de Supabase es self-signed para el chain de Vercel. Forzamos sslmode=no-verify para evitar error.' This allows MITM on PG connection if attacker is on Vercel↔Supabase network path.
- **Impacto**: MITM attacker could intercept migrations, alter schema, exfiltrate data. However: endpoint is behind Bearer token (CRON_SECRET) + escape-hatch gate (ALLOW_PROD_RESET env var). Threat model assumes infra is semi-trusted (Vercel/Supabase cloud). Documented in docs/audit/encryption-exceptions.md as exception A1 with threat model rationale.
- **Fix propuesto**: Long-term (Sprint 3): Replace this endpoint entirely with `supabase db push` via GitHub Actions OIDC, which handles certs properly. Short-term (MVP): maintain current mitigation: dual-factor gate (Bearer + env var), document threat model clearly, monitor usage logs for unauthorized attempts.

<details><summary>Veredicto adversarial (confirmado como BAJO)</summary>

The finding is verified as real: line 148 of app/api/admin/migrate/route.ts contains ssl: { rejectUnauthorized: false } with explicit documentation of the self-signed cert rationale. The vulnerability is already documented in docs/audit/known-gaps.md (A1) and docs/audit/encryption-exceptions.md (A1) as an accepted exception. 

CONFIRMED MITIGATIONS: (1) Bearer token CRON_SECRET validation (lines 103-107); (2) Dual-factor escape hatch ALLOW_PROD_RESET=yes-im-sure-2026 for destructive ops (lines 120-128, checkAdminGate); (3) Low invocation volume (~10 times in project lifetime per documented threat model); (4) Threat model assumes cloud infrastructure (Vercel↔Supabase private network), requiring MITM attacker to compromise AWS/Vercel/Supabase internals.

CRITICAL MITIGATING FACTOR: The migrations/seeds endpoint transmits ONLY DDL (schema definitions) and reference data (obras_sociales, CIE-10 codes), never PHI/PII. Even if MITM occurs, no patient/clinical data is exposed. The encryption-exceptions.md threat model correctly identifies the attack surface as observation of schema + potential CRON_SECRET theft, not data exfiltration. This is transport-layer security misconfiguration, not data confidentiality breach.

NOTED GAPS: (1) No Sentry/audit logging on migration invocation; (2) No rate limiting (though Bearer required); (3) Depends on CRON_SECRET rotation discipline. These do not refute the mitigation but represent residual risk.

SEVERITY RATIONALE: Downgraded to BAJO because (a) zero PHI/PII transmission risk; (b) high attack preconditions (cloud infra compromise + token leak); (c) dual-factor gate + low volume + planned Sprint 3 replacement (GitHub Actions OIDC) all reduce practical exploitability. A MITM would steal schema (already public in repo) and Bearer token, […]

</details>

#### B7 · INFO: Analytics fact tables initially created without RLS, later hardened in M42

- **Dimensión**: rls-prod · **Categoría**: RLS Coverage / Evolution · **knownGap**: sí
- **Ubicación**: `supabase/migrations/20260518000015_M15_analytics_schema.sql vs 20260601000042_M42_analytics_rls.sql:supabase/migrations/20260518000015_M15_analytics_schema.sql (initial creation without RLS) vs 20260601000042_M42_analytics_rls.sql (hardening)`
- **Evidencia**: [gap conocido] M15 (line ~50-110) creates analytics.org_metrics_monthly, analytics.cohort_benchmarks, analytics.insight_templates without ENABLE ROW LEVEL SECURITY. M42 (line 4-19) documents this explicitly as 'hallazgo auditoría H-RLS-1' and adds ENABLE+FORCE RLS with zero policies (deny-by-default). Supabase advisors report: 'RLS Enabled No Policy' on these 3 tables. By design: tables are NOT exposed to client (no GRANT to authenticated), only GRANT on org_insights_cache.
- **Impacto**: Defense-in-depth improvement: tables went from 'safe only if no accidents' to 'structurally safe'. No data exposure detected because authenticated role never had GRANT. M42 eliminates future risk of accidental GRANT leaks.
- **Fix propuesto**: Already implemented in M42. No action required. Document in rls-matrix.md that the 3 analytics tables have RLS ENABLE+FORCE without policies by intention.

<details><summary>Veredicto adversarial (confirmado como BAJO)</summary>

Hallazgo VERDADERO y DOCUMENTADO en M42. Las 3 tablas (org_metrics_monthly, cohort_benchmarks, insight_templates) fueron creadas SIN RLS en M15 (verificado líneas M15:51-109) y fue corregido en M42 (líneas 65-78 ENABLE+FORCE RLS, líneas 81-85 sin policies by design). El riesgo era real: un GRANT accidental a authenticated habría expuesto revenue/no-show/pacientes de todas las orgs cruzadas. Mitigación M42 es correcta y defensiva (deny-by-default + BYPASSRLS service_role para pipeline). M42 documenta explícitamente esto como "Hallazgo auditoría H-RLS-1" línea 4. Severidad BAJO porque: (1) sin GRANT explícito, tablas nunca estuvieron expuestas; (2) M42 elimina riesgo de forma estructural; (3) documentación M42 es exhaustiva (39 líneas explicando por qué FORCE RLS no rompe pipeline). El hallazgo es un gap CONOCIDO documentado en la propia migración M42 como parte de auditoría. No está listado en known-gaps.md porque ya fue mitigado EN el audit window (M42 fechado 2026-06-01). Gap documentario menor: Test 08 línea 10 promete validar "SELECT cohort_benchmarks desde authenticated falla" pero no hay assertion pgTAP que lo implemente.</parameter>
</StructuredOutput>

</details>

#### B8 · Back-URL validation — relies on webhook, not server-side verification

- **Dimensión**: billing · **Categoría**: Flujo de Autorización · **knownGap**: no
- **Ubicación**: `app/(app)/configuracion/billing/page.tsx, app/api/mercadopago/webhook/route.ts:200 (suscripcion.ts), 122 (billing-page.tsx)`
- **Evidencia**: back_url `${input.appUrl}/configuracion/billing?activation=ok` es un redirect del browser de MP, no autenticado. El servidor confía en que si el user volvió de MP con ?activation=ok, fue porque MP lo redirigió. Pero un attacker podría navegar directo a /configuracion/billing?activation=ok sin pasar por MP.
- **Impacto**: Bajo: La activación real la confirma el webhook (que SÍ valida firma). El query param ?activation=ok es SOLO un hint visual para mostrar ActivationPendingBanner. Si un user (o attacker) navega a ?activation=ok sin webhook, verán el banner pero el estado seguirá PENDIENTE_ACTIVACION y el gating seguirá bloqueando. NO hay riesgo de falso activation. Pero es confusing porque el mensaje dice 'se está procesando'.
- **Fix propuesto**: Cambiar el parámetro a algo no-forgeable: en lugar de usar ?activation=ok, generar un one-time token en createOrRenewPendingSubscription(), guardarlo en suscripcion.activation_token, y verificarlo al volver. O simplemente remover el parámetro y dejar que el webhook + auto-poll decidan el estado.

<details><summary>Veredicto adversarial (confirmado como BAJO)</summary>

The finding is technically real: the ?activation=ok query parameter is user-forgeable and controls the display of ActivationPendingBanner (verified in components/billing/billing-page.tsx:122). An attacker can navigate directly to /configuracion/billing?activation=ok without passing through Mercado Pago, causing the banner to display.

However, the severity is correctly classified as BAJO because:

1. **No authorization bypass**: The parameter does NOT change subscription.estado in the database. The actual subscription state (PENDIENTE_ACTIVACION vs ACTIVA) is controlled exclusively by the webhook handler (webhook/route.ts, verified with HMAC-SHA256 signature), not the query parameter.

2. **No access grant**: App access is gated by computeAccessGate() (suscripcion.ts:514-557) which checks subscription.estado from the database (line 520: only ACTIVA allows access). The UI banner does not affect this logic.

3. **Limited impact**: The worst case is confusing UX—a user/attacker sees "se está procesando" when no actual preapproval exists. The "Refrescar estado" button calls refreshSubscriptionAction() which legitimately polls the webhook status.

4. **Webhook validation is solid**: HMAC-SHA256 verification (webhook/route.ts:70-80) is the true authorization control, signed with MP_WEBHOOK_SECRET, and it correctly mutates estado to ACTIVA only when the signature is valid.

The finding correctly identifies an unauthenticated UI hint that could be forged, which is a valid security practice concern (defense in depth), but the application's actual access control is not compromised. The suggested mitigation (one-time activation token) would improve defense-in-depth but is not critical given the webhook signature validation.

</details>

---

## Hallazgos refutados por la verificación adversarial

- **[auth]** Service role client instantiation lacks explicit documentation pattern — REFUTADO. El hallazgo afirma que "falta patrón consistente documentando cuándo es aceptable bypassear RLS" sin comentarios de justificación. Evidencia de refutación concreta: (1) docs/audit/quarterly-service-role-audit.md (actualizado 2026-05-24) lista explícitamente 'app/(public)/onboarding/actions.ts' con salvaguardas |auth.getUser() + Turnstile + rate-limit|; (2) app/(public)/onboarding/actions.ts líneas 8-25 tienen comentarios de bloque documentando por qué se usa service_role; (3) cada función individual tiene validación upstream (auth.getUser() en líneas 401, 250, 567, 637, 686) ANTES de […]

## Notas de cada auditor (cobertura y límites)

### rls-repo

Auditoria RLS de Folio completada en 43 migraciones Postgres (M01-M43). Hallazgos: [1] COORDINADOR/ASISTENTE pueden insertar paciente_identidad contra intencion de roles sin capacitacion clinica. [2] UPDATE de paciente_identidad sin audit trigger (M39 incluyo triggers member/org/profile pero no PII tables). [3] pago_select usa solo EXISTS turno sin validacion org_id explicita (correcto via RLS heredada pero fragil documentacion). [4] Faltan pgTAP tests verificando paciente.caja_fuerte scoping (auditoria anterior T-8.5). [5] post_visita/pago/suscripcion/seguro_profesional sin audit_log triggers (Ley 26.529 art. 15). PUNTOS POSITIVOS: (a) 30+ tablas con ENABLE+FORCE RLS correcto; (b) Todas funciones SECURITY DEFINER tienen SET search_path=public; (c) Vistas con security_invoker=true; (d) Storage buckets con policies estrictas; (e) analytics fact-tables con defense-in-depth RLS deny-by-default; (f) M31 corrige caja_fuerte leak en paciente_identidad; (g) M32 agrega branch profesional_attended_paciente; (h) M34 permite DIRECTOR leer audit_log. Riesgos MITIGADOS: rejectUnauthorized exception documentada, user_metadata NO se usa (solo app_metadata), todas policies usan org_id filtering. El schema esta estructuralmente BIEN pero con 5 gaps operacionales en policies de escritura + audit que impactan Ley 26.529 art. 15 (trazabilidad)."

### rls-prod

Auditoría completada en modo READ-ONLY. Scope: RLS coverage, migraciones, funciones SECURITY DEFINER, configuración de BD en prod vs repo. 

HALLAZGOS CLASIFICADOS:
- 1 hallazgo CRÍTICO (drift migraciones): impacta audit trail, reproducibilidad, posibles cambios RLS undocumented.
- 2 hallazgos ALTOS (extensiones en public, SECURITY DEFINER ejecutables): security hygiene, information disclosure risk mitigation documentado.
- 1 hallazgo MEDIO (rejectUnauthorized false): documentado como excepción A1 con threat model.
- 1 hallazgo BAJO (analytics RLS): intencional, mejorado en M42, sin riesgo actual.

VERIFICACIONES COMPLETADAS:
1. RLS: 54 tablas public+analytics, todas con ENABLE ROW LEVEL SECURITY. 51 tienen políticas, 3 analytics fact tables have deny-by-default (intencional).
2. Policies: 193 políticas de RLS verificadas. Todas filtan por tenant (org_id IN user_org_ids()) o scope específico (member_id). No políticas permisos excesivos detectadas.
3. SECURITY DEFINER: 33 funciones SECURITY DEFINER listadas. 8 helper functions callable by authenticated (intencional, RLS context, pero should REVOKE per security best practice). 25 funciones pipeline (analytics, audit, pseudonimizacion) son service_role only o triggered (seguras).
4. Storage RLS: org-logos bucket con regex UUID validation M27. consentimientos-firmados bucket definido pero vacío (F8/6c deferred).
5. Migraciones: M01-M43 en repo, M44-M48 + duplicado 20260607193806 en prod. Total 55 versiones vs 43 en repo = DRIFT 12 migraciones.

DATOS CONOCIDOS ACEPTADOS (per docs):
- encryption-exceptions.md documenta: profile.email plaintext (Supabase Auth requirement), paciente_identidad.fecha_nacimiento/sexo/geo plaintext (clinical + analytics k-anonymity), audit_log soft-delete app-layer (Habeas Data recovery).
- known-gaps.md establece: consentimiento canvas-sig UI deferred, WhatsApp outbound compose deferred, AFIP invoicing deferred.
- rls-matrix.md cataloga policy matrix completa, service-role call sites auditados trimestralmente.

LIMITACIONES DEL ANÁLISIS:
- No pude leer performance advisors (truncado). Resumen: índices, query plans no auditados aquí.
- No pude obtener código de las migraciones fantasma (20260526..20260609) — no están en repo, no puedo verificar contenido SQL.
- Análisis estático: no se ejecutaron tests pgTAP (backend-audit-2026-05-19.md menciona S8 T-8.5 pendiente).
- No se verificaron: Server Actions auth gates (quarterly-service-role-audit.md es responsabilidad de team), endpoints admin (checkAdminGate helpers), webhooks HMAC validation (código de MP, WhatsApp existe pero no auditado en detalle).

RECOMENDACIONES INMEDIATAS:
1. Resolver drift: exportar M44-M48 del prod, guardar en repo, commit con explicación.
2. REVOKE funciones helper per security best practice (M01 modification).
3. Considerar mover pg_trgm/btree_gist a extensions schema en M49.


### auth

AUDITORÍA COMPLETADA: Autenticación y Protección de Rutas (folio-app, 2026-06-10). Cobertura sistemática de: (1) Protección de rutas (middleware.ts + matchers), (2) Flujo login/signup/reset con Zod validation, rate-limiting (Upstash), Turnstile CAPTCHA, (3) JWT/claims (getUser() verificado contra server, service_role usado solo en bootstrap), (4) OAuth callback con safeRedirect() mitigando open-redirect, (5) Revocación de sesiones (limitada a sesión activa, sin global invalidation), (6) Cookies con flags httpOnly + sameSite=lax + secure (condicionado NODE_ENV), (7) Service role instanciación en lib/supabase/server.ts + onboarding/actions.ts (safe para signup bootstrap), (8) Server Actions representativas (pacientes, configuracion/billing, datos) con verificación de rol vía getActiveContext() + RLS dual-layer. HALLAZGOS: (A1-ALTO) createPacienteAction sin verificación explícita de rol a nivel action (RLS protege pero defensa en profundidad requiere aplicación-layer check). (A2-MEDIO) Enumeración de usuarios en signup: 'Ya existe cuenta con este email' revela existencia. (A3-MEDIO) Patrón de service_role sin documentación consistente. (A4-MEDIO) Rate-limit fail-open sin Upstash en prod (intencional pero undocumented en gaps). (A5-MEDIO) signOut() no invalida otras sesiones (sesión actual sí, global no). MITIGACIONES: (M1) /dev/* routes tienen notFound() en prod (NODE_ENV check). (M2) Middleware matcher cubre todas rutas excepto assets. (M3) Consent flow gateado por Turnstile + rate-limit + Zod schema. (M4) admin gates (migrate, confirm-user) con dual-factor (CRON_SECRET + ALLOW_PROD_RESET env). (M5) RLS sobre 30 tablas + audit_log particionada + sesion append-only. (M6) PII/PHI encrypted at-rest (AES-256-GCM) + RLS per-org. TESTS: safe-redirect.test.ts (9 casos), admin-gate.test.ts (7 casos), rate-limit-fail-closed.test.ts (6 casos), oauth-callback-open-redirect e2e (7 vectors). GAPS YA DOCUMENTADOS: Ley 25.326 consent UI diferida, pseudonimización RPC pendiente, PostHog eventos parciales, firma digital HC (Ley 26.529 art. 14 estricta), Sentry+PostHog telemetría. No se hallaron vulnerabilidades críticas. Defensa in-depth está bien estructurada. Recomendación: cerrar A1 agregando rol check en pacientes action, A2 con mensajes genéricos, A5 documentando o implementando session_version revocation pattern."

### billing

CONTEXTO AUDITADO: Folio SaaS médico argentino, modelo billing = suscripciones MP (preapproval) con Folio como merchant directo. PHI/PII real en producción. Stack: Next.js 15 + Supabase Postgres RLS. Alcance: integridad de webhooks, idempotencia, máquina de estados, validación, credenciales.

HALLAZGOS CONSOLIDADOS: 6 hallazgos en orden de severidad (CRÍTICO → BAJO). El más grave es la falta de reconciliación automática (background job) cuando los webhooks se pierden — causa divergencia entre estado local (PENDIENTE_ACTIVACION → bloquea acceso) y MP (ACTIVA → está cobrando), afectando directamente el revenue integrity.

ASPECTOS AUDITADOS Y EN BUEN ESTADO:
- Webhook signature validation: HMAC-SHA256 con timingSafeEqual, replay detection 6h window, fail-closed en prod. EXCELENTE.
- Idempotencia de cargos: UNIQUE(mp_payment_id) + INSERT conflict handling. Funciona pero error detection es fragile (string matching).
- Máquina de estados: PENDIENTE_ACTIVACION → ACTIVA → MOROSA → CANCELADA bien definida en M19/M41. mp_last_modified asegura orden monotónico.
- Moneda/monto: Valida ARS y monto ±1 cent contra hardcoded MP_PLAN_PRICE_CENTS. OK.
- Grace period: 7 días desde org.created_at, bien implementado en computeAccessGate() y testeado.
- is_internal_account: Bypass para demo/test tenants es auditable (audit_log trigger), pero enforcement es soft (comment, no RLS policy).
- Credenciales: MP_ACCESS_TOKEN y MP_WEBHOOK_SECRET come del env, no hardcodeados. OK.
- RLS: suscripcion y cargo_suscripcion con FORCE RLS. Solo OWNER ve/edita. Webhook usa service_role. Correcto.

LIMITACIONES DEL ANÁLISIS:
- No pude inspeccionar logs en vivo ni probar webhooks end-to-end.
- Supabase MCP no fue usado (no queremos apply_migration); análisis basado en código fuente.
- El endpoint webhook es públicamente accesible (sin autenticación web), pero la validación de firma HMAC lo protege.
- No hay rate-limiting visible en el webhook handler — teóricamente un attacker podría flood con requests (cada falla es 503 retry).

KNOWN GAPS REVISADOS: docs/audit/known-gaps.md menciona varios gaps post-audit (Turno CRUD UI, sesion_enmienda UI, etc.) pero NINGUNO es de billing. El único mencionado es 'A1 rejectUnauthorized: false' que NO aplica a MP billing (eso es para admin/migrate directo a DB).

CONFIDENCIALIDAD: No hay credenciales hardcodeadas en el código. Los secrets (MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET, CRON_SECRET) vienen de Vercel env. El archivo .env.local.example NO contiene valores reales."
  }


### placeholders

Auditoría de placeholders, valores dummy, código no-productivo en repo C:/Users/amiun/Desktop/folio-app (Folio SaaS médico multi-tenant, Next.js 15 + Supabase prod). SCOPE: búsqueda exhaustiva de: (1) TODO/FIXME/HACK/XXX/WIP, (2) credenciales hardcodeadas, (3) URLs localhost/hardcodeadas, (4) mocks/stubs/dummy en código de producción, (5) feature flags siempre-true/false, (6) app/dev/* exposure, (7) console.log con PII, (8) emails/teléfonos/CUITs de prueba, (9) .env vars no documentadas. HALLAZGOS PRINCIPALES: (A) ALTO IMPACTO: Supabase anon key JWT expuesta en .env.production (código + .env.vercel), viola least-privilege aunque RLS mitiga. (B) MEDIO: Fallback localhost:3010 en login/actions.ts + webhooks MP/WhatsApp aceptan sin verificación en dev si secrets vacíos (gaps conocidos documentados pero no reforzados con errores). (C) BAJO: Endpoint admin/seed-hoy-demo con teléfonos demo semi-realistas (+54 9 351 555 XXXX), datos demo email lautaro-folio-test@folio.app (endpoint gateado prod-disabled así que no corre en producción). (D) BAJO: SSL rejectUnauthorized:false en admin/migrate (gap conocido A1 en known-gaps.md, threat model aceptado, ~10 invocaciones lifetime, dual-factor gate). (E) BAJO: URL hardcodeada en docs (folio-app-ten.vercel.app), AFIP_ENV=homologacion sin guidance en .env.example. NO HALLAZGOS: (i) NO hay TODO/FIXME/HACK en código core (algunos en docs/plans como comentarios de diseño). (ii) NO hay console.log con PII detectado en handlers main (Sentry scrubea por beforeSend). (iii) NO hay código muerto detrás de flags siempre-true/false. (iv) app/dev/* rutas bien gateadas con NODE_ENV === production checks, retornan 404 en prod. GAPS CONOCIDOS CONFIRMADOS: C1 (admin-gate dual-factor), C3 (seed-hoy-demo gateado prod-disabled), A1 (SSL no-verify threat model documentado), W5 (Sentry PII scrubbing check), W9 (PostHog consent pendiente). RECOMENDACIÓN PRIORITARIA: Rotar INMEDIATAMENTE Supabase anon key (repo tiene JWT válido en git) y mover .env.production a .gitignore + secrets en Vercel. METODOLOGÍA: Grep en app/, lib/, components/, scripts/, supabase/ (excluye .claude, docs/specs, tests excepto si reveal prod mocks) con patrones case-insensitive. Lectura de 9 archivos core. Validación contra docs/audit/known-gaps.md y backend-audit-2026-05-19.md.

---

## Anexo · Reconocimiento de arquitectura (slot clínico, onboarding, tiers, roles, i18n)

No hay i18n configurado. Todo es español/voseo hardcodeado. Ahora compilo el informe final con toda la información recopilada.

## INFORME ARQUITECTÓNICO: ESPECIALIDADES EN FOLIO

### 1. SPINE TOOL (Herramienta de Columna Vertebral)

**Ubicación y renderizado:**

- **Componente principal**: `components/paciente/spine-map.tsx:28-256`
  - Componente "use client" que renderiza SVG interactivo de 24 vértebras (C1-C7, T1-T12, L1-L5) con estados (normal/leve/moderado/severo/ajustada).
  - Hook de contexto `usePacienteFicha()` para acceder al plan actual (`plan.ultimoAjuste`, `plan.vertebrasEstado`).

- **Configuración visual**: `components/paciente/spine-config.ts:10-62`
  - `SPINE_VERTEBRAS[]`: array de 24 vértebras con posiciones SVG (x, y, w, h, tilt) hardcodeadas.
  - `ESTADO_VERT`: paleta de colores y etiquetas por estado (ej. "Dolor leve" → amber, "Ajustada" → green).
  - Información temporal: `MESES[]` en ES; función `fmtFecha()` formatea ISO → "d mes".

**Slot en ficha del paciente:**

- **Padre**: `components/paciente/paciente-detalle.tsx:91-217`
  - Función `TabPlan()` (línea 191-217) contiene:
    - `<SpineMap states={vertStates} setStates={setVertStates} />` (línea 207)
    - `<SoapStacked soap={soap} setSoap={setSoap} />` (línea 208)
  - Recibe `plan: PlanData` del contexto (inyectado por `PacienteFichaProvider`).
  - Otro contexto: `<I.Vertebra size={14} />` badge que dice "Módulo · Quiropraxia" (línea 201).

**Persistencia en DB:**

- **Tabla sesion** (M10: `20260518000010_M10_sesiones_append_only.sql`):
  - Columna `vertebras_json jsonb NOT NULL DEFAULT '[]'` (línea 35 en M10)
  - Shape: `[{ id: string; estado: string }, ...]`
  - Cifrado: **NO** — es data clínica pero NO está cifrada (solo SOAP_*_cifrado está encriptado app-side).

- **Migración que la creó**: M10, línea 35 — define `vertebras_json` como JSONB array.

- **Lectura en paciente-ficha.ts** (línea 188-200):
  ```typescript
  const vertebrasEstado: Record<string, EstadoVertebra> = {};
  const ultimoAjuste: Record<string, string> = {};
  for (const s of sesiones) {
    const vlist = (s.vertebras_json ?? []) as Array<{ id?: string; estado?: string }>;
    for (const v of vlist) {
      if (!v.id) continue;
      const estado = normalizeEstadoVertebra(v.estado);
      if (!vertebrasEstado[v.id]) {
        vertebrasEstado[v.id] = estado;
        ultimoAjuste[v.id] = s.created_at.slice(0, 10);
      }
    }
  }
  ```
  Lee sesiones en order DESC, toma el estado más reciente por vértebra y la fecha de último ajuste.

**Forma de datos:**

- `EstadoVertebra` type en `lib/db/paciente-ficha.ts:31` → `"normal" | "leve" | "moderado" | "severo" | "ajustada"`
- `PlanData.vertebrasEstado: Record<string, EstadoVertebra>` (línea 64)
- `PlanData.ultimoAjuste: Record<string, string>` (línea 65) — fechas ISO (YYYY-MM-DD)

**Uso en otros lugares:**

1. **Focus Mode** (`components/focus/focus-app.tsx:164-280`):
   - Reimplementación de SpineMap con bars en vez de SVG (3 regiones: Cervical/Dorsal/Lumbar).
   - Data de demo hardcodeada: `VERT_INIT: { L3: "leve", L4: "severo", L5: "moderado" }` (línea 49).
   - **NO conectado a DB** — es preview/demo solo.

2. **Historial de sesiones** (`paciente-detalle.tsx:144-187`):
   - `HistorialReciente()` renderiza `plan.sesiones` (SesionPlan[]) que incluye `vertebras: string[]` (línea 53 en paciente-ficha).
   - En la vista: se muestran como tags de vértebras ajustadas por sesión (línea 174-180).

3. **Tab Sesiones** (`paciente-detalle.tsx:272-326`):
   - Similar: lista sesiones con `s.vertebras.map(v => <span className="fi-pill">{v}</span>)` (línea 305).

**Versioning:**

- Spine map **NO se versiona por sesión**. Es estado actual.
- Cada sesión tiene su snapshot de `vertebras_json`, pero `paciente-ficha.ts` toma el **estado más reciente** (última sesión DESC) para poblar `plan.vertebrasEstado`.
- Por eso en el componente SpineMap, `states` carga `plan.vertebrasEstado` (el estado acumulado, no snapshots históricos).

---

### 2. FICHA CLÍNICA

**Estructura general:**

- **Componente root**: `components/paciente/paciente-detalle.tsx:456-499`
  - Props: `paciente: PacienteFichaInfo`, `plan: PlanData`, `cumple: string`
  - Wrapper: `<PacienteFichaProvider>` inyecta contexto global para sub-componentes.

**Secciones de la ficha:**

1. **Tab Información** (línea 221-270):
   - Contacto (tel, email, cumpleaños, obra social)
   - Motivo de consulta (también usado como diagnóstico en plan.diagnostico)
   - Tags (ej. "VIP", "Postoperatorio")
   - Notas internas (notasImportantes)

2. **Tab Plan** (línea 191-217) — El principal (default):
   - **SpineMap** (columna izq)
   - **SOAP Stacked** (columna der) — 4 textareas: Subjetivo/Objetivo/Análisis/Plan
   - **Plan de Tratamiento** (abajo): sesiones completadas/total, frecuencia, próximo control, diagnóstico
   - **Historial Reciente** (abajo): últimas 4 sesiones (expandible)

3. **Tab Sesiones** (línea 272-326):
   - Lista todas las sesiones (plan.sesiones, hasta 10 históricamente)
   - Por sesión: fecha, servicio, duración, cambios (vertebras ajustadas), botón "Ver detalle" (disabled)

4. **Tab Documentos** (línea 328-352):
   - Vacío — próximamente Storage para RMN, estudios, consentimientos

**Historia clínica (modelo de datos):**

- **Tabla sesion** (M10):
  - `turno_id UNIQUE` → 1:1 con turno
  - `soap_s_cifrado, soap_o_cifrado, soap_a_cifrado, soap_p_cifrado` — SOAP encriptado
  - `vertebras_json` — JSONB array de ajustes
  - `eva_antes, eva_despues` — escala EVA (0-10)
  - `notas_cifrado` — notas adicionales
  - `locked_at, locked_by_id` — inmutabilidad post-cierre (Ley 26.529 art. 15)

- **Tabla sesion_enmienda** (M10, línea 138-149):
  - Append-only: una sesión locked_at se corrige AQUÍ, no en sesion original
  - Motivo + texto_correccion_cifrado

**Append-only enforcement (M10, línea 89-135):**

- Trigger `prevent_locked_sesion_update()` bloquea UPDATE en campos clínicos tras locked_at
- Trigger `prevent_locked_sesion_delete()` bloquea DELETE

**Integración con turno:**

- `turno.estado = 'CERRADO'` → se crea sesion (probablemente automática o manual en `/hoy`)
- SOAP + vertebras son editables mientras `estado IN ('ATENDIENDO', 'CERRADO')` y sesion.locked_at IS NULL

---

### 3. ONBOARDING

**Ubicación:**

- Route: `app/(public)/onboarding/page.tsx` (Server Component)
- Client wizard: `components/onboarding/onboarding-app.tsx` (9 steps)
- Server Actions: `app/(public)/onboarding/actions.ts`

**Pasos del wizard (9 total):**

1. **Step 1 Signup**: Email + password + consent + captcha → `signUpAndInitOrganization()`
   - Crea `auth.user`, `profile`, `organization` (con `onboarding_completed=false`), `member` (OWNER)
   - Idempotente vía `bootstrap_org_atomic` RPC (M33, línea 30-143)

2. **Step 2 Profesional** (línea 62-63 en onboarding-app): 
   - nombre, apellido, matricula, tel → `updateOnboardingStep(2, Step2Data)`
   - Encripta y actualiza `profile.nombre_cifrado, apellido_cifrado, matricula`

3. **Step 3 Consultorio** (línea 64-65):
   - consultorioNombre, rubro, ciudad, provincia, dirección, teléfono público, Instagram, bio, slug manual
   - Actualiza `organization`: nombre, rubro, ciudad, provincia, slug

4. **Step 4 Personalizacion** (línea 67-68):
   - acento (color hex), logo upload, cardMood
   - Actualiza org + storage

5. **Step 5 Horarios** (línea 70-71):
   - diasActivos[], franjas (from/to)
   - Reemplaza `disponibilidad_profesional` para el member OWNER

6. **Step 6 Servicios** (línea 73-74):
   - servicios: nombre[], duración, precio, tipo_canonico
   - Reemplaza tabla `servicio`

7. **Step 7 Google** (línea 76-77):
   - OAuth connect (no persiste nada, lo hace el callback)

8. **Step 8 MercadoPago** (línea 79-80):
   - Activa cobro mensual → `createOrRenewPendingSubscription()`
   - Crea row en `suscripcion` (M19) con estado PENDIENTE_ACTIVACION

9. **Step 9 Moment** (línea 82-84):
   - Finaliza onboarding → `finalizeOnboarding()` marca `organization.onboarding_completed=true`
   - Muestra card real del consultorio con link público `/book/[slug]`

**Dónde se crea la org:**

- **M33 RPC `bootstrap_org_atomic`** (línea 30-143):
  ```plpgsql
  INSERT INTO organization (
    slug, nombre, rubro, ciudad, provincia, acento_hex,
    onboarding_completed, onboarding_step_max
  ) VALUES (
    v_slug, 'Mi consultorio', NULL, NULL, NULL, '#8A6722',
    false, 1
  )
  ```
  - Organización mínima creada en step 1 (post-signup)
  - Campos: slug (provisional), nombre generic, acento default

**Campos de organization:**

- `id, slug, nombre, rubro, ciudad, provincia, timezone, moneda, acento_hex, tema`
- `cuit, razon_social, condicion_iva, punto_venta_afip, certificado_arca_cifrado`
- `opt_out_analytics, opt_out_public_listing, deleted_at, created_at, updated_at`
- Plus: `logo_url, card_mood, bio, telefono_publico, direccion_completa, instagram_handle` (M20, M21)
- Plus: `onboarding_completed, onboarding_step_max` (para resume)

**Dónde encajaría selector de especialidad:**

- **Opción A (Recomendada)**: Nuevo step entre Step 3 y Step 5:
  - "¿Qué especialidad atendés?" → dropdown/radios de enum (ej. QUIROPRACTICA, KINESIOLOGIA, PSICOLOGIA, CARDIOLOGIA)
  - Persistir en `organization.especialidad` (columna nueva, enum, non-null)
  - Este paso gobernaría el layout del Tab Plan de ahí en adelante
  
- **Opción B (Menos ideal)**: Campo en Step 3 Consultorio como parte del rubro
  - Pero rubro es text libre, no enum → confundible con descripción comercial

- **Persistencia**: 
  - Nueva columna en `organization`: `especialidad especialidad_enum NOT NULL DEFAULT 'QUIROPRACTICA'`
  - Migración nueva (M44+) para agregar columna + default + constraint

---

### 4. TIERS/PRICING

**Concepto actual:**

- **NO hay tiers múltiples hoy**. Es un solo plan: 30.000 ARS/mes (M19).
- Un consultorio = una suscripción.
- Una suscripción = Folio es merchant directo (MP preapproval).

**Estructura de suscripción (M19 + M41):**

- **Tabla suscripcion** (M19, línea 49-83):
  - `id, organization_id (UNIQUE), mp_preapproval_id, payer_email`
  - `monto_cents (default 3000000 = 30k ARS), moneda`
  - `estado: PENDIENTE_ACTIVACION | ACTIVA | PAUSADA | CANCELADA | MOROSA`
  - `fecha_alta, fecha_activacion, proxima_cobro, ultimo_cobro_ts, ultimo_error, fecha_cancelacion`
  - Índices: estado, proxima_cobro (filtered)

- **Tabla cargo_suscripcion** (M19, línea 98-124):
  - Historial de cobros mensuales
  - `id, suscripcion_id, mp_payment_id (UNIQUE), mp_authorized_payment_id`
  - `monto_cents, estado (PENDIENTE|APROBADO|RECHAZADO|REFUNDED), fecha_intento, fecha_acreditacion`
  - `raw_payload jsonb` — snapshot del webhook MP

**RLS:**

- Suscripción: **solo OWNER de la org** puede leer/escribir (M19, línea 139-155)
- Cargo: solo OWNER lectura; escritura solo via service_role (webhooks)

**Access Gating:**

- Función pura `computeAccessGate()` (lib/db/suscripcion.ts:514-557):
  - ACTIVA → allowed=true
  - MOROSA | CANCELADA pero proxima_cobro > now → allowed=true
  - PAUSADA → allowed=false
  - PENDIENTE | sin suscripción:
    - `organization.created_at + 7 días > now` → grace period, allowed=true
    - `else` → allowed=false, reason="grace_expired"
  - Grace period: 7 días desde creación org

**Middleware** (ref. en M19, línea 28):
```
if (grace_vencido && suscripcion.estado != 'ACTIVA')
  → redirect a /configuracion/billing
```

**Límites por plan:**

- No hay. No existen tiers hoy.
- Un solo precio: 30k ARS/mes = 3.000.000 centavos (MP_PLAN_PRICE_CENTS en lib/mercadopago/client.ts)
- Una sola org por usuario (identity_id en member es unique per profile per org)

---

### 5. SERVICIOS/TURNOS

**Tabla servicio (M09, línea 80-115):**

- `id, organization_id, nombre, tipo_canonico, duracion_min, precio_cents`
- `color, para_nuevos, es_paquete, sesiones_paquete`
- `activo, deleted_at`
- `tipo_canonico enum`:
  - CONSULTA_INICIAL
  - SEGUIMIENTO_ESTANDAR
  - SEGUIMIENTO_EXTENDIDO
  - PACK_SESIONES
  - SERVICIO_ESPECIALIZADO

**No hay "categoría especialidad" en servicios:**

- Servicios son genéricos (nombre = string libre)
- El tipo_canonico es para analytics (M15), no para especialidad
- Booking público (app/(public)/book):
  - Carga servicios de la org (línea 42-48 en book page)
  - Filtra por `activo=true, deleted_at IS NULL`
  - Order: `tipo_canonico`
  - Muestra nombre + duración + precio, sin referencia a especialidad

**Tabla turno (M09, línea 119-188):**

- state machine: AGENDADO → CONFIRMADO → EN_SALA → ATENDIENDO → CERRADO
- Paralelos: NO_ASISTIO, CANCELADO, REAGENDADO
- Campos: `inicio, duracion_min, estado, origen, precio_cents (snapshot)`
- `atendiendo_desde, duracion_real_min`
- FK: `paciente_id, servicio_id, profesional_id` (todos en misma org por trigger)

**Booking público (/book/[slug]):**

- Server: carga `organization, servicio[]` sin mención de especialidad
- Client (BookingWizard): step 1 (elegir servicio) → step 2 (elegir slot) → step 3 (confirmar datos)
- Crea `pedido` (tabla en M09, línea 280+) con estado PENDIENTE
- Sin especialidad en el flow

---

### 6. i18n

**Situación:**

- **NO hay sistema de i18n**. Todo está hardcodeado en español (Argentina).
- Voseo **consistente**: "vos", "Mientras atendés", "la app trabaja por vos", etc.
- Micrografía argentina: "Ley 25.326" (Ley de Datos Personales), "AFIP", "Mercado Pago", "Obra Social", "Monotributo"

**Strings sample:**

- `components/paciente/spine-config.ts:55-61` → MESES[], fmtFecha()
- `components/paciente/paciente-detalle.tsx:42-47` → SOAP_SECTIONS con hints
- `components/focus/focus-app.tsx:33-62` → REGIONES, SOAP_TABS, ESTADO_VERT
- `lib/supabase/migrations/*.sql` → comentarios en ES

**Para multi-idioma futuro:**

- Habría que extraer todos los strings a un archivo centralizado (ej. `lib/i18n/es.ts`, `lib/i18n/en.ts`)
- O usar next-intl + structure `/app/[locale]/(app)`, `/app/[locale]/(public)`
- Hoy: 0 infraestructura — refactor masivo

---

### 7. ROLES

**Enum role (M02, línea 31-37):**

- `OWNER` — fundador, ve TODO
- `DIRECTOR` — gerencial, ve admin+finanzas (+ clínica si es_colegiado)
- `PROFESIONAL` — atiende, ve su agenda + sus pacientes
- `COORDINADOR` — gestiona agendas (sin ver clínica)
- `ASISTENTE` — recepción

**Estructura member (M02, línea 135-158):**

- `organization_id, profile_id, role, alcance, profesionales_gestionados, equipo_id, es_colegiado`
- `alcance enum`: TODOS, EQUIPO, LISTA_PROFESIONALES
  - COORDINADOR/ASISTENTE pueden estar limitados a EQUIPO o LISTA_PROFESIONALES
  - Si LISTA_PROFESIONALES: array de member_ids que gestionan
- `es_colegiado`: marca si PROFESIONAL/DIRECTOR ejercen clínica (ve PHI)

**Una org puede tener múltiples profesionales:**

- Table `member`: organization_id + profile_id
- Multiple members can share same organization con roles distintos
- Clinic-ready: DIRECTOR + N PROFESIONAL + COORDINADOR + ASISTENTE

**Implicaciones para multi-especialidad:**

- Orgs grandes (clínicas) pueden tener PROFESIONAL en Quiropraxia + otro en Kinesiología
- Cada uno ve su agenda, sus turnos, sus pacientes
- El DIRECTOR ve todo
- El sistema NO diferencia PHI por especialidad hoy — solo por role

---

## RECOMENDACIONES

### (a) Dónde vivir el registry de especialidades

**Opción recomendada:**

1. **Nueva tabla `especialidad`** (append-only reference):
   ```sql
   CREATE TABLE especialidad (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     slug text UNIQUE NOT NULL,        -- 'quiropractica', 'kinesiologia'
     nombre text NOT NULL,              -- "Quiropraxia", "Kinesiología"
     descripcion text,
     tool_id text NOT NULL DEFAULT 'spine-map',  -- 'spine-map', 'postura-3d', etc.
     disponible boolean NOT NULL DEFAULT true,
     created_at timestamptz DEFAULT now()
   );
   ```

2. **FK en organization:**
   ```sql
   ALTER TABLE organization ADD COLUMN especialidad_id uuid REFERENCES especialidad(id);
   ```

3. **Seed inicial** (data values):
   - QUIROPRACTICA (tool=spine-map)
   - KINESIOLOGIA (tool=postura-3d o spine-map reutilizado)
   - PSICOLOGIA (tool=none)
   - CARDIOLOGIA (tool=none)
   - etc.

4. **Client-side registry** (`lib/especialidades/registry.ts`):
   ```typescript
   export const ESPECIALIDAD_TOOLS: Record<string, SpecialityTool> = {
     'quiropractica': { tool: SpineMap, config: SPINE_CONFIG },
     'kinesiologia': { tool: SpineMap, config: SPINE_CONFIG_KINESIO },
     'psicologia': { tool: null, config: null },
   };
   ```

5. **En Tab Plan de paciente-detalle:**
   - Leer `organization.especialidad_id` (via contexto app-level)
   - Renderizar el tool correspondiente en vez de hardcoded SpineMap

**Ventajas:**

- Especialidades son extensibles sin cambiar code
- Data-driven: cada org elige su especialidad en Step 1.5 (nuevo step en onboarding)
- Separación: tool en client (plugin-like), metadata en DB
- Audit trail: especialidad histórica via created_at (aunque org.especialidad_id es mutable)

### (b) Riesgos / Acoplamientos de refactor

**Alto riesgo — Cambios que van a ser inevitables:**

1. **SpineMap está fuertemente acoplado a Quiropraxia:**
   - `SPINE_VERTEBRAS` hardcodeado (24 vértebras, posiciones SVG estáticas)
   - Comentarios en código: "puerto de folio/paciente.jsx (quiropraxia)"
   - Si Kinesiología necesita postura 3D o cardio necesita diagrama cardíaco → refactor masivo

2. **PlanData shape es quiropraxia-centric:**
   - `vertebrasEstado: Record<string, EstadoVertebra>` asume anatomía vertebral
   - `ultimoAjuste: Record<string, string>` idem
   - Para Psicología (ej. "síntomas mejoraron", "adherencia al tratamiento") → type genérico

   **Refactor sugerido:**
   ```typescript
   export interface PlanData {
     // ...
     especialidadData?: unknown;  // jsonb generic, tipado por especialidad_id
   }
   ```

3. **Focus Mode en espera:**
   - `components/focus/focus-app.tsx` es demo-only, no conectado a DB
   - Tiene su propia copia de spine-bars + ESTADO_VERT hardcodeado
   - Cuando se conecte a real turnos, necesitará el mismo registry de especialidades

4. **Sesion append-only model:**
   - `vertebras_json` es JSONB pero asume shape `[{ id, estado }]`
   - Kinesiología podría querer `[{ region, rom (rango movimiento), nota }]`
   - **No es problema si migramos a `especialidadData jsonb` en sesion** — pero requiere:
     - Nueva migración (agregar columna `especialidad_data` a sesion)
     - Trigger deprecation de `vertebras_json` (o mantenerla para legacy)
     - Reescritura de paciente-ficha.ts para soportar múltiples shapes

5. **SOAP es especialidad-agnostic (bien):**
   - Subjetivo/Objetivo/Análisis/Plan aplica a cualquier disciplina
   - No necesita refactor

6. **Servicios sin especialidad:**
   - `servicio.tipo_canonico` es para analytics, no categoría clínica
   - **Refactor necesario**: agregar `servicio.especialidad_id` FK
   - O filtrar servicios por especialidad_id cuando se carga en booking

7. **RLS no cambia, pero:**
   - Member.es_colegiado hoy es boolean (cualquier profesional ve PHI o no lo ve)
   - Multi-especialidad podría requerir `es_colegiado_en_especialidad` (ej. "colegiado en Quiropraxia pero no en Kinesiología")
   - Low risk hoy (es diseño futuro), pero tenerlo en cuenta

8. **i18n al mismo tiempo:**
   - Si hacemos multi-especialidad + multi-idioma juntos → combinación exponencial
   - Recomendación: **hacer especialidades PRIMERO (Data-driven), luego i18n**.

**Medio riesgo — Testing y stabilidad:**

- Cambios en sesion.vertebras_json → nuevo modelo → tests visuales rompen
  - Hoy: `tests/visual/paciente-detalle.test.ts` espera snapshots con vértebras
  - Con multi-especialidad: o parametrizamos los snapshots por especialidad, o los hacemos genéricos

**Bajo riesgo:**

- Onboarding Step 1.5 (selector especialidad) es aditivo
- Gating de acceso (access-gate) no cambia
- Billing no cambia

---

## RESUMEN EJECUTIVO

**Hoy, Folio es quiropráctica-implícita:**

- SpineMap SVG hardcodeado con 24 vértebras reales
- Servicios son genéricos (nombre libre) pero no etiquetados por especialidad
- Tab Plan de paciente renderiza spine-map + SOAP (universal)
- Onboarding recolecta "rubro" (text libre) pero NO usa para especialidad

**Para system de especialidades clinic-ready:**

1. Crear tabla `especialidad` con enum de disciplinas + tool_id
2. Agregar FK `organization.especialidad_id` (set en Step 1.5 del onboarding)
3. Crear registry client-side que mapea especialidad → componente (SpineMap, PostureApp, etc.)
4. Refactor `PlanData` para soportar `especialidadData: jsonb` genérico (en lugar de vertebrasEstado hardcodeado)
5. Actualizar `paciente-detalle.tsx:TabPlan()` para renderizar el tool de la especialidad dinámicamente
6. Migrar `sesion.vertebras_json` → `sesion.especialidad_data` para futuro-proof

**Acoplamientos mayores a refactor:**

- SpineMap está soldado a vértebras ↔ necesitará pluginización
- PlanData.vertebrasEstado es tipo específico ↔ genérico JSONB
- Session schema asume vertebras ↔ datos de sesion deben ser genéricos por especialidad

**Timeline estimado:**

- Data layer (tabla especialidad + migración): 2-3 días
- Registry + dynamic component loading: 1-2 días
- Onboarding Step 1.5: 1-2 días
- PlanData refactor + paciente-detalle: 2-3 días
- Tests + snapshots: 1 día
- **Total: ~10 días (sin blockers)**

---

**Archivos clave para referencia:**

- Spine renderizado: `components/paciente/spine-map.tsx:28-256`
- Spine config: `components/paciente/spine-config.ts:10-62`
- Ficha paciente: `components/paciente/paciente-detalle.tsx:191-217`
- Datos fetcher: `lib/db/paciente-ficha.ts:121-255`
- Onboarding flow: `app/(public)/onboarding/actions.ts:76-234, 397-561`
- Servicios/turnos schema: `supabase/migrations/20260518000009_M09_servicios_turnos.sql:1-192`
- Sesión schema: `supabase/migrations/20260518000010_M10_sesiones_append_only.sql:1-150`
- Suscripción: `lib/db/suscripcion.ts:30-79, 514-557`
