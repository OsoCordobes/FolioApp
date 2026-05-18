# ADR-001 · Persistencia del wizard de onboarding

**Status:** Aceptado · 2026-05-19
**Sprint:** S2 T-2.2
**Decisores:** Lautaro (founder), Claude (senior eng)

## Contexto

El onboarding de Folio es un wizard de ~9 pasos en `/onboarding`:
1. Email + password (signup)
2. Nombre / apellido / matrícula
3. Teléfono
4. Consultorio (nombre, rubro, dirección, ciudad, provincia, instagram, acento)
5. Confirmación visual
6. Horarios de atención (días + franjas + slot)
7. Servicios (nombre, duración, precio)
8. Review
9. Finish → `completeOnboarding(data)` atómico que crea organization + profile + member + servicios + disponibilidad

El usuario puede cerrar la pestaña a mitad. ¿Cómo retomamos donde estaba?

## Decisión

**Para el MVP usamos `localStorage` por step + commit a DB en step 9 (finish).**

Razones:
- Simple. Cada step persiste su slice en `folio.onboarding.v1` (un object JSON con todos los campos acumulados).
- Atomic en server: `completeOnboarding` ya crea TODO de una en la DB; si falla, NADA persiste y el usuario reintenta el step 9 sin perder los datos del browser.
- Cero round-trips a server entre steps → wizard ágil.
- Cero código DB nuevo para "estado parcial".
- Trade-off aceptado: si el usuario cambia de browser/device a mitad, pierde el progreso. Es una situación rara para MVP solo-founder; el costo de un schema "organization en estado onboarding_in_progress" + cleanup tras 7 días no se justifica.

## Alternativas evaluadas

### A) DB-per-step

Crear `organization` desde step 4 con flag `is_onboarding=true`. Cada step actualiza la fila. Step 9 limpia el flag.

**Pros:**
- Multi-device resume.
- Server-side analytics (dropoff rates por step).

**Contras:**
- Schema cambios (flag + cleanup cron).
- Compatibilidad con RLS (org "fantasma" con member OWNER ya creado pero datos incompletos).
- Si el usuario abandona, hay registros zombi que hay que GC-ear.
- 5-8 round-trips extra durante el wizard.

**Veredicto:** mejor en F2-F3 cuando tengamos analytics maduros. Postponed.

### B) Session storage server-side

Guardar `onboarding_draft` en cookie firmada o KV (Upstash).

**Pros:**
- Sobrevive a cambios de browser dentro del mismo session token.
- No persistencia pesada en DB.

**Contras:**
- Cookie firmada tiene límite de 4kb (los servicios pueden empujar el límite).
- Upstash KV: agrega dependencia + costo + bloqueante por user-input (REST URL/token).

**Veredicto:** equivalent funcionalmente a localStorage para single-device. No vale la complejidad.

## Consecuencias

- El client persiste a `localStorage.setItem("folio.onboarding.v1", JSON.stringify(state))` en cada step submit.
- Al cargar `/onboarding`, el wizard hidrata el state desde localStorage si existe.
- El step 9 dispara `completeOnboarding(state)` que valida con Zod ([[lib/onboarding/schemas.ts]]) y crea TODO atómicamente.
- Tras éxito, `localStorage.removeItem("folio.onboarding.v1")` para limpiar.
- Si falla, el localStorage queda intacto para retry.

## Migración futura

Cuando movamos a DB-per-step (F11+):
1. Migration M-N agrega `organization.onboarding_status enum('IN_PROGRESS', 'COMPLETE')`.
2. Server actions de cada step UPDATE.
3. Step 9 cambia status → COMPLETE.
4. Cron diario limpia `IN_PROGRESS` con `created_at < now() - 7 days`.

No breaking del cliente: la API de `completeOnboarding(data)` puede aceptar `data` parcial (lo nuevo en DB) Y/O completo (lo viejo de localStorage); ambos paths coexisten durante la migración.

## Tracking

- Decisión validada por: ningún usuario reportó el dolor de perder progreso (test users hasta ahora hicieron el wizard en una sola sesión).
- Revisar cuando: lleguemos a 50+ signups y veamos data de dropoff (necesita PostHog wired en F11).
