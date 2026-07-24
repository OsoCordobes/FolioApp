# Guion pre-demo — viernes 2026-07-25 (primera llamada de venta)

Checklist operativo: preparación (la noche anterior / la mañana) y demo en vivo.
Producto: https://folio-app-ten.vercel.app · Salud: https://folio-app-ten.vercel.app/api/health

Reemplaza a `DEMO-GUION-DOMINGO.md` (2026-06-14, construido sobre la org
`lautaro-amiune` — ELIMINADA el 2026-06-15). El setup nuevo: la cuenta
`amiunelautaro@gmail.com` es soporte/demo con **una org demo por especialidad**
(`demo-quiropraxia`, `demo-cardiologia`, `demo-psicologia`, `demo-kinesiologia`,
`demo-nutricion`) + la org real — el **OrgSwitcher** del sidebar cambia entre
ellas. Cada org demo es interna (badge "Cuenta interna", sin gate de billing),
invisible en el directorio público y bookeable por link directo.

## Preparación (30 min, en este orden)

### 1. Sanidad ANTES de todo (5 min)

- [ ] `GET /api/health` → si `ok: false`, mirar qué check está en `false`:
      - `checks.db` / `checks.env` → **frena acá y resolvé primero** (el seed
        necesita `FOLIO_ENC_KEY` y la DB; si env falla, el seed también).
      - `checks.rate_limit` (Upstash sin configurar) → benigno **siempre que**
        `UPSTASH_FAIL_CLOSED` NO esté en `"true"` en Vercel (verificalo en el
        dashboard: debe estar unset o `"false"`).
- [ ] Signup sano, chequeo determinístico (5 seg, sin crear cuentas):
      `curl -s -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" https://grkpayhxndztlfwxobnt.supabase.co/auth/v1/settings`
      → `mailer_autoconfirm: true` = OK. Si es `false`: Supabase → Auth →
      apagar "Confirm email", re-correr el curl hasta ver `true`, y de paso
      confirmar `disable_signup: false` y captcha de Supabase Auth OFF
      (LAUNCH-RUNBOOK §7).

### 2. Seed de las orgs demo (10 min)

Requiere el deploy del PR de esta rama y la env `ALLOW_DEMO_SEED=yes-demo-2026`
en Vercel Production **seteada ANTES del merge** (los cambios de env solo
aplican a deploys nuevos). Con el `CRON_SECRET` vigente (rotado 2026-07-18):

```bash
# Un curl POR especialidad (no ?especialidad=all — acota timeouts y blast radius)
for esp in quiropraxia cardiologia psicologia kinesiologia nutricion; do
  curl -sS -X POST "https://folio-app-ten.vercel.app/api/admin/seed-demo?especialidad=$esp" \
    -H "Authorization: Bearer $CRON_SECRET"; echo;
done
```

- Idempotente: si la org ya tiene pacientes MOCK, se saltea (`skipped: true`).
- **Reset entre llamadas de venta**: agregar `&force=1` → borra los MOCK y
  re-siembra con la agenda "del día" fresca (correrlo la mañana de cada demo,
  así los turnos de HOY caen en el día de la llamada).
- Solo borrar: `&cleanup=1`. Quitar `ALLOW_DEMO_SEED` de Vercel post-seed.
- Cada org queda con: 6 pacientes MOCK coherentes con la especialidad,
  historia (turnos pasados cerrados + sesiones con la herramienta clínica
  ACTUAL + pagos), agenda de HOY con un turno **EN SALA** (para mostrar
  transiciones en vivo) y turnos futuros. Psicología además: serie PHQ-9/GAD-7
  con mejoría (panel "Evolución de resultados").

### 3. Recorrido de verificación (10 min)

- [ ] Login `amiunelautaro@gmail.com` → el selector "Consultorio" del sidebar
      muestra la org real + 5 "· demo".
- [ ] Entrar a CADA org demo: /hoy con agenda del día (uno EN SALA), ficha de
      un paciente → la herramienta clínica es la de ESA especialidad (si ves
      una equivocada: DevTools → borrar cookie `folio_esp_override`),
      /finanzas SOLO muestra pagos de esa org (nada del consultorio real).
- [ ] Booking de ensayo desde el teléfono: `/book/demo-<especialidad>` →
      servicio → slot → reservar (Turnstile real). El turno aparece en /hoy
      (polling ~25 s — narrá la pausa o refrescá).
- [ ] Los recordatorios NO salen para orgs demo (skip automático de internas) —
      podés agendar/cerrar turnos en vivo sin miedo a WhatsApps fantasma.

### 4. Si algo falla — diagnóstico (orden)

1. `GET /api/health` — ¿qué check/integración cayó?
2. "Demasiados intentos" en signup/booking → Vercel: `UPSTASH_FAIL_CLOSED="false"`
   + **Redeploy** (el env-flip solo NO aplica al deploy corriendo).
3. Sentry (proyecto Folio) — issues de la última hora.
4. Vercel → Deployments → Function logs del endpoint.
5. Rollback: promover el deploy anterior (instantáneo, sin migraciones).

## Durante la llamada

- Pestañas de antemano: /hoy (org demo de la especialidad del cliente) ·
  /calendario · /book/demo-<esp> (incógnito) · /api/health.
- Guion sugerido:
  1. **/hoy** — la agenda del día ya viva, un paciente EN SALA.
  2. El cliente reserva desde SU teléfono en `/book/demo-<esp>` → el turno
     aparece solo en /hoy.
  3. **Ficha del paciente** — historia clínica + herramienta de SU especialidad
     (cardio: panel TA/FC + medicación + derivación; psico: escalas con curva
     de evolución + nota SOAP guiada; kinesio: NDI/ODI/ROM; nutrición:
     antropometría; quiro: mapa vertebral).
  4. Transiciones: en sala → atendiendo → **cerrar turno** → /finanzas del mes.
  5. Si vende multi-especialidad / clínica: switchear de org en vivo con el
     selector — "cada consultorio, su agenda, sus fichas, sus finanzas".
  6. Cierre: alta de cuenta en vivo (incógnito) — onboarding en 3 minutos con
     **30 días de prueba sin tarjeta**.
- Plan B si el wifi/booking falla: crear el turno manual desde /hoy (modal) —
  no depende de Turnstile ni del público.

## Pendientes solo-founder (mismos del guion anterior, siguen vigentes)

| Acción | Por qué |
|---|---|
| `RESEND_API_KEY` + `EMAIL_FROM` en Vercel (opcional para hoy) | Sin eso el email de confirmación de booking no sale (fail-safe silencioso) |
| Supabase plan Pro (backups) | Plan FREE = cero backups de una DB con PHI |
| OAuth app de Google "In production" | Refresh tokens de Testing mueren a los 7 días |
