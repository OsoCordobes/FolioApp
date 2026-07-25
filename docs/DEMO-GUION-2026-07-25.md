# Guion de demo — primera llamada de venta

Checklist operativo: preparación (la mañana de la llamada) y demo en vivo.
Producto: **https://foliosalud.com** · Salud: https://foliosalud.com/api/health

Reemplaza a `DEMO-GUION-DOMINGO.md` (2026-06-14, construido sobre la org
`lautaro-amiune` — ELIMINADA el 2026-06-15). El setup vigente: la cuenta
`amiunelautaro@gmail.com` es soporte/demo con **una org demo por especialidad**
(`demo-quiropraxia`, `demo-cardiologia`, `demo-psicologia`, `demo-kinesiologia`,
`demo-nutricion`) + la org real — el **OrgSwitcher** del sidebar cambia entre
ellas. Cada org demo es interna (badge "Cuenta interna", sin gate de billing),
invisible en el directorio público y bookeable por link directo.

## Preparación (30 min, en este orden)

### 1. Sanidad ANTES de todo (5 min)

- [ ] `GET /api/health` → si `ok: false`, mirar qué check está en `false`:
      - `checks.db` / `checks.env` → **frená acá y resolvé primero** (el seed
        necesita `FOLIO_ENC_KEY` y la DB; si env falla, el seed también).
      - `checks.rate_limit` (Upstash sin configurar) → benigno **siempre que**
        `UPSTASH_FAIL_CLOSED` NO esté en `"true"` en Vercel (verificalo en el
        dashboard: debe estar unset o `"false"`).
      - `integrations.email: false` → **el email real no sale** (fail-safe: se
        loguea como `simulated`, no se marca como enviado). Sin
        `RESEND_API_KEY` no hay confirmación de reserva ni recordatorio 24h ni
        botón de confirmación 1-click en el buzón del paciente.
- [ ] Alta de cuenta, chequeo determinístico (5 seg, sin crear cuentas):
      `curl -s -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" https://grkpayhxndztlfwxobnt.supabase.co/auth/v1/settings`
      → `mailer_autoconfirm: true` = alta con email+contraseña operativa.
      Si es `false`, hay DOS caminos y conviene saber cuál vas a mostrar:
      - **Google** (`"google": true` en el mismo JSON) — funciona hoy tal cual,
        sin confirmación de email de por medio. Es el camino recomendado para
        la demo en vivo.
      - **Email + contraseña** — requiere Supabase → Auth → apagar "Confirm
        email" (o configurar el SMTP de Resend). Re-correr el curl hasta ver
        `true`, y de paso confirmar `disable_signup: false`.

### 2. Seed de las orgs demo (10 min)

**Camino recomendado (1 click, sin secretos a mano):** GitHub → Actions →
**"Demo · seed consultorios (manual)"** → Run workflow → `especialidad=all`,
`force=true`. Usa el `CRON_SECRET` guardado en Actions (el de Vercel es
*sensitive*/write-only: `vercel env pull` lo devuelve vacío).

Camino manual equivalente, si tenés el `CRON_SECRET` a mano:

```bash
for esp in quiropraxia cardiologia psicologia kinesiologia nutricion; do
  curl -sS -X POST "https://foliosalud.com/api/admin/seed-demo?especialidad=$esp&force=1" \
    -H "Authorization: Bearer $CRON_SECRET"; echo;
done
```

- Idempotente sin `force`: si la org ya tiene pacientes MOCK, se saltea
  (`skipped: true`). **Con `force=1`** borra los MOCK y re-siembra con la
  agenda "del día" fresca — correlo **la mañana de cada llamada**, así los
  turnos de HOY caen en el día de la demo.
- Solo borrar: `&cleanup=1`.
- El endpoint está triple-gateado (env `ALLOW_DEMO_SEED` + `CRON_SECRET` +
  guard que aborta si un slug `demo-*` NO es cuenta interna).
- Cada org queda con: 6 pacientes MOCK coherentes con la especialidad,
  historia (turnos pasados cerrados + sesiones con la herramienta clínica
  ACTUAL + pagos), agenda de HOY con un turno **EN SALA** (para mostrar
  transiciones en vivo) y turnos futuros. Psicología además: serie PHQ-9/GAD-7
  con mejoría (panel "Evolución de resultados"). Cobertura (obra social) ya
  cargada en parte de los pacientes.

### 3. Recorrido de verificación (10 min)

- [ ] Login `amiunelautaro@gmail.com` → el selector "Consultorio" del sidebar
      muestra la org real + 5 "· demo".
- [ ] Entrar a CADA org demo: /hoy con agenda del día (uno EN SALA), ficha de
      un paciente → la herramienta clínica es la de ESA especialidad (si ves
      una equivocada: DevTools → borrar cookie `folio_esp_override`),
      /finanzas SOLO muestra pagos de esa org (nada del consultorio real).
- [ ] Booking de ensayo desde el teléfono: `https://foliosalud.com/book/demo-<especialidad>`
      → servicio → slot → reservar (Turnstile real). El turno aparece en /hoy
      (polling ~25 s — narrá la pausa o refrescá).
- [ ] Los recordatorios NO salen para orgs demo (skip automático de internas) —
      podés agendar/cerrar turnos en vivo sin miedo a emails fantasma.
- [ ] Mobile: abrí /hoy, /calendario, /pacientes y una ficha **desde el
      teléfono**. Es el escenario real del médico entre consultas y es donde el
      cliente va a mirar más de cerca.

### 4. Si algo falla — diagnóstico (orden)

1. `GET /api/health` — ¿qué check/integración cayó?
2. "Demasiados intentos" en signup/booking → Vercel: `UPSTASH_FAIL_CLOSED="false"`
   + **Redeploy** (el env-flip solo NO aplica al deploy corriendo).
3. Sentry (proyecto Folio) — issues de la última hora.
4. Vercel → Deployments → Function logs del endpoint.
5. Rollback: promover el deploy anterior (instantáneo, sin migraciones).

## Durante la llamada

- Pestañas de antemano: /hoy (org demo de la especialidad del cliente) ·
  /calendario · /pacientes · /book/demo-\<esp\> (incógnito) · /api/health.
- Guion sugerido:
  1. **/hoy** — la agenda del día ya viva, un paciente EN SALA, y el card
     "Primeros pasos" si mostrás una cuenta nueva.
  2. El cliente reserva desde SU teléfono en `/book/demo-<esp>` → el turno
     aparece solo en /hoy. Contá que al paciente le llega la confirmación por
     email con **"Agregar al calendario"** (.ics) y que el recordatorio de 24 h
     trae **Confirmo / Cancelar en un click** — el reductor de ausentismo.
  3. **Ficha del paciente** — historia clínica + herramienta de SU especialidad
     (cardio: panel TA/FC + medicación + derivación; psico: escalas con curva
     de evolución + nota SOAP guiada; kinesio: NDI/ODI/ROM; nutrición:
     antropometría; quiro: mapa vertebral). Mostrá **obra social / prepaga** en
     el tab Información y **Exportar PDF** en el header.
  4. Transiciones: en sala → atendiendo → **cerrar turno** → el diálogo de
     cobro (monto + método + "quedó debiendo") → **/finanzas del mes** con
     "Por cobrar" y el export para el contador.
  5. Si vende multi-especialidad / clínica: switchear de org en vivo con el
     selector — "cada consultorio, su agenda, sus fichas, sus finanzas".
  6. Migración: **importar pacientes desde Excel/CSV** (Configuración →
     Importar pacientes) — es la barrera #1 para cambiar de sistema y la
     tenemos resuelta.
  7. Cierre: alta de cuenta en vivo (incógnito) — onboarding en 3 minutos con
     **30 días de prueba sin tarjeta**. Usá **Continuar con Google** si
     "Confirm email" sigue prendido en Supabase.
- Plan B si el wifi/booking falla: crear el turno manual desde /hoy (modal) —
  no depende de Turnstile ni del público.

## Qué NO prometer (honestidad de venta)

- **WhatsApp**: la landing lo muestra como "Próximamente" y así hay que
  contarlo. Los recordatorios de hoy son **por email**. Prometer WhatsApp para
  cerrar la venta es la forma más rápida de perder el cliente en el mes 2.
- **Recetas digitales, facturación AFIP, telemedicina**: no existen. Están
  fuera del alcance actual a propósito.
- **Testimonios**: la sección solo se renderiza si hay quotes reales cargadas.
  No inventamos testimonios en salud.

## Pendientes solo-founder

| Acción | Por qué |
|---|---|
| Supabase → Auth → "Confirm email" OFF (o SMTP de Resend) | Alta con email+contraseña bloqueada hasta entonces; Google ya funciona |
| `RESEND_API_KEY` + `EMAIL_FROM` (@foliosalud.com, SPF/DKIM) en Vercel | Sin eso NINGÚN email sale de verdad: confirmación, recordatorio y el 1-click |
| Supabase plan Pro (backups PITR) | Plan FREE = cero backups de una DB con PHI |
| Buzón `soporte@foliosalud.com` (forward a Gmail) | El dominio todavía no tiene MX; el soporte sigue apuntando a Gmail |
| 2-3 testimonios reales con permiso escrito | Desbloquea la sección de social proof de la landing |
| Keys de PostHog en prod | Sin eso el funnel signup → onboarding → primer turno no se mide |
| OAuth app de Google "In production" | Refresh tokens de Testing mueren a los 7 días |
