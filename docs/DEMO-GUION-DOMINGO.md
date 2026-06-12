# Guion pre-demo — domingo 2026-06-14

Checklist operativo para el sábado (preparación) y el domingo (demo en vivo).
Producto: https://folio-app-ten.vercel.app · Salud: https://folio-app-ten.vercel.app/api/health

## Sábado — preparación (30–45 min)

### 1. Sanidad del sistema (5 min)

- [ ] `GET /api/health` → `ok: true`, y en `integrations`: `turnstile`, `mercadopago`,
      `sentry`, `cron_secret`, `google_calendar` en `true`. `email` idealmente
      `true` (ver acciones pendientes abajo); `upstash_redis` puede seguir `false`
      (rate-limit fail-open, mitigado por Turnstile — aceptado para la demo).
- [ ] La versión (`version`) coincide con el último merge a master.

### 2. Org de la demo (15 min)

Usar **tu org real** (`lautaro-amiune` — ya renombrada "Consultorio Lautaro
Amiune", `is_internal_account=true`, sin gate de billing):

- [ ] /configuracion: especialidad correcta para el cliente del domingo,
      nombre/dirección/logo presentables, **link público copiado y probado**
      (debe abrir /book/lautaro-amiune, no un 404).
      ⚠️ NO cambies la especialidad de una org que ya tiene sesiones cargadas
      (cambia la herramienta de TODA la ficha). Para demos de otra
      especialidad, usá una org aparte.
- [ ] Servicios: 2–3 activos con precios reales.
- [ ] Disponibilidad: franjas cargadas **incluyendo el domingo** (la agenda
      semanal muestra el día de la demo).
- [ ] Crear 2–3 turnos para el domingo con la UI (modal "Crear turno" en /hoy):
      pacientes con nombres verosímiles, horarios espaciados. Así /hoy no abre
      vacío frente al cliente.

### 3. Ensayo del flujo completo (10 min) — **el smoke que importa**

- [ ] En una ventana de incógnito (o el teléfono): /book/lautaro-amiune →
      servicio → slot → datos (tu propio email) → reservar. Debe terminar en
      «¡Turno confirmado!» y pasar el captcha de Turnstile real.
- [ ] Con /hoy abierto en otra ventana: el turno nuevo aparece (live update).
      ⚠️ El live update es polling cada 25 segundos: en vivo, narrá esa pausa
      («en unos segundos aparece solo») o refrescá a mano — no te quedes en
      silencio mirando la pantalla.
- [ ] Transiciones: confirmar → en sala → atendiendo → cerrar. Cancelar uno.
- [ ] Si `email: true` en health: revisar que llegó el email de confirmación.
- [ ] Cancelá el turno de ensayo para dejar la agenda limpia.

### 4. Si algo falla — diagnóstico (orden)

1. `GET /api/health` — ¿`ok`? ¿qué integración se cayó?
2. Sentry (proyecto Folio) — issues de la última hora.
3. Vercel → Deployments → Functions logs del endpoint que falló.
4. Rollback: Vercel → Deployments → promover el deploy anterior (instantáneo;
   las migraciones son aditivas, no hay down).

## Domingo — durante la demo

- Pestañas abiertas de antemano: /hoy · /calendario · /book/<slug> (incógnito) ·
  /api/health · Sentry.
- Guion sugerido: (1) /hoy con la agenda del día → (2) el cliente reserva desde
  SU teléfono en /book/<slug> → (3) el turno aparece solo en /hoy → (4) ficha
  del paciente + herramienta de la especialidad → (5) cerrar turno → /finanzas.
- Plan B si el wifi/booking falla en vivo: crear el turno manual desde /hoy
  (modal) — el flujo manual no depende de Turnstile ni del público.

## Acciones pendientes que solo puede hacer el founder

| Acción | Por qué | Dónde |
|---|---|---|
| Setear `RESEND_API_KEY` + `EMAIL_FROM` en Vercel Production | El email de confirmación de booking hoy NO sale (fail-safe silencioso) | Vercel → Settings → Environment Variables → redeploy |
| Pasar la OAuth app de Google a "In production" | En modo Testing los refresh tokens mueren a los 7 días (la integración de Lorenzo ya murió con invalid_grant) | Google Cloud Console → OAuth consent screen |
| Upgrade Supabase a plan Pro (o aceptar dumps manuales) | Plan FREE = **cero backups** de una DB con PHI; hay backup lógico manual del 2026-06-11 en `~\folio-backups\` | supabase.com → Billing |
| (Opcional) Provisionar Upstash Redis + envs | Rate-limit real en signup/booking (hoy fail-open, mitigado por Turnstile) | §3 del LAUNCH-RUNBOOK — **en ese orden**; jamás setear `UPSTASH_FAIL_CLOSED` sin provisionar antes |
| (Opcional) Habilitar leaked-password protection | Hardening de Auth gratis | Supabase Dashboard → Auth → Settings |
