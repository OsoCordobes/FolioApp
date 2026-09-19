# Guion de demostración con datos sintéticos

Actualización del 8 de septiembre de 2026. Las instrucciones antiguas para
reescribir las organizaciones de demo mediante una URL quedaron retiradas; su
historial permanece en Git. Ver [operaciones administrativas](OPERACIONES-ADMINISTRATIVAS.md).

## Preparación

- Usar únicamente una organización sintética identificada, sin pacientes reales.
- Conservar los datos existentes. No ejecutar reinicios, limpieza de historias ni
  opciones `force` para actualizar la fecha de una demostración.
- Mantener bloqueadas sus comunicaciones externas. Una cuenta interna que evita
  el cobro no demuestra por sí sola que sea una organización sintética.
- Verificar acceso, segundo factor y estado de las integraciones con el entorno
  de prueba preparado. La verificación de correo permanece activa; si el correo
  no llega, revisar SMTP y sus cuotas en lugar de desactivar la verificación.
- Las señales de salud describen la comprobación que realmente hicieron. No
  equivalen a una prueba de entrega de correo, un cobro o una restauración.
- Crear los turnos de la demostración mediante los flujos probados. La carga
  masiva de ensayo tendrá una herramienta separada, con límites y rechazo de
  producción por defecto.

El recorrido siguiente se conserva como material de revisión. Cada prestación
se debe demostrar y aprobar antes de presentarla como parte de la oferta.
Los instrumentos requieren validación profesional y de población; mostrar una
pantalla o una puntuación sintética no acredita su validez clínica.

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

