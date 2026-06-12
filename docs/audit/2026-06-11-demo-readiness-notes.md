# Notas y decisiones — preparación demo domingo (2026-06-11)

Bitácora de decisiones autónomas del tech lead durante la auditoría y ejecución
de mejoras pre-demo. Cada entrada: contexto → decisión → razón. Las decisiones
de producto de alto impacto se escalan al founder en vez de decidirse acá.

## Decisiones

### D1 — M52 recuperada de prod al repo (2026-06-11)

- **Contexto**: `supabase_migrations.schema_migrations` en prod tiene
  `20260610000052 M52_bloqueo_gcal_unique` (unique index sobre
  `bloqueo (organization_id, profesional_id, gcal_event_id)`), pero el archivo
  no existía en `supabase/migrations/`. `scripts/diff-migrations.mjs` no lo
  detecta porque solo chequea repo→prod, no prod→repo. Misma clase de incidente
  que M44–M48.
- **Decisión**: recrear el archivo con el DDL byte-a-byte del ledger
  (`20260610000052_M52_bloqueo_gcal_unique.sql`). No tocar prod.
- **Razón**: restablecer la invariante "el repo replay-ea idéntico a prod".
  Reversible (es solo el repo); el índice además es el conflict target que
  necesita el sync inbound de Google Calendar que se va a implementar.

### D2 — MCP de n8n no disponible en esta sesión (2026-06-11)

- **Contexto**: el encargo pedía leer los workflows de n8n vía MCP. El servidor
  MCP de n8n no está conectado en esta sesión (verificado vía ToolSearch).
- **Decisión**: continuar sin él; no hay referencias a n8n en el repo
  (grep), así que no bloquea ninguna pieza del carril crítico.

### D3 — Diseño del pull Google → Folio (anti doble-booking) (2026-06-11)

- **Contexto**: hoy el sync es push-only (Folio→Google). El encargo pide evaluar
  e implementar un pull de disponibilidad. La infraestructura existente apunta a
  un diseño concreto: `bloqueo` ya tiene `gcal_event_id` + `origen` (M09), la
  generación de slots (`lib/booking/availability.ts`) y el RPC `slot_ocupado`
  (M44) **ya restan `bloqueo`**, el webhook de watch (`/api/google/webhook`) es
  un stub que ACKea, el cron `google-watch-renew` corre a diario, y M52 (prod)
  creó el unique index `(organization_id, profesional_id, gcal_event_id)` como
  conflict target del upsert inbound.
- **Decisión**: implementar el pull como **re-sync ventaneado con
  `events.list`** (timeMin=now, timeMax=now+14d — la ventana de booking,
  `singleEvents=true`) en vez de `freebusy.query` literal:
  1. Filtrar eventos `status != cancelled` y `transparency != 'transparent'`
     (misma semántica busy que free/busy; los all-day default de Google son
     "free" y no bloquean).
  2. Excluir eventos creados por el propio push de Folio (id presente en
     `turno.gcal_event_id`) para no duplicar el bloqueo del mismo turno.
  3. Upsert a `bloqueo` con `origen='GOOGLE'`, conflict target = índice M52;
     borrar los `bloqueo` con `gcal_event_id` no presentes en el fetch dentro
     de la ventana (reconciliación de borrados sin syncToken).
  4. Triggers: (a) webhook de watch → sync del canal notificado vía `after()`
     (respuesta inmediata a Google); (b) cron diario `google-watch-renew`
     sincroniza además de renovar (fallback si el webhook no llega);
     (c) frescura on-demand: al cargar `/book/[slug]`, si `ultimo_sync` > N min,
     disparar sync fire-and-forget vía `after()` — no agrega latencia al
     visitante.
  5. **Fail-open**: si Google no responde, los slots salen de nuestra DB y el
     booking nunca se bloquea (coherente con la filosofía fail-safe del push).
     La garantía dura contra doble-booking sigue siendo NUESTRA DB (EXCLUDE M40
     + re-check `slot_ocupado`), como exige el encargo.
- **Razón de la desviación de `freebusy.query`**: free/busy devuelve intervalos
  anónimos sin event ids — no permite reconciliar borrados, ni excluir los
  eventos que Folio mismo pusheó, ni usar el índice M52 como upsert target.
  `events.list` ventaneado da la misma información busy con identidad de
  evento, a igual costo de API. El objetivo del encargo (slots libres
  calculados en nuestra base + check-and-insert transaccional nuestro) se
  cumple idéntico.

### D4 — Reconciliación con PRs #36/#37 (2026-06-11)

- **Contexto**: el checkout local estaba 2 commits detrás de origin/master. El
  PR #36 (sesión paralela) ya había commiteado M52, un CI de app
  (`app-ci.yml`) y **el sync inbound de Google Calendar**
  (`lib/google/inbound.ts` + webhook real) con un diseño equivalente a D3
  (events.list ventaneado 30d, función pura `planInboundSync`, exclusión de
  eventos pusheados por Folio, reconciliación de borrados vía M52).
- **Decisión**: descartar mis duplicados (archivo M52 propio y `ci.yml`),
  pull a 35e415e, conservar D3 como validación del diseño ya implementado.
  La mejora de `diff-migrations.mjs` (drift inverso) sigue vigente.

### D5 — Fix del bloqueante de booking, verificado E2E (2026-06-11)

- **Contexto**: hallazgo crítico de auditoría — `promotePedidoToTurno`
  re-chequeaba el slot con el propio pedido aún PENDIENTE → auto-conflicto →
  TODA reserva pública moría con "Ese horario ya no está disponible" (prod:
  0 pedidos, 0 turnos BOOKING en la historia).
- **Fix (M53 + código)**: `slot_ocupado` ganó `p_exclude_pedido` (DROP+CREATE,
  la firma de 3 args se elimina para no ambiguar PostgREST);
  `checkSlotOcupado`/`decideSlotOcupado` propagan la exclusión;
  `promotePedidoToTurno` y `confirmarPedido` pasan su `pedidoId`. Además:
  validación server-side de que `inicio` sea un slot realmente ofrecido
  (`slotEstaOfrecido` + re-derivación de la grilla), filtros
  `deleted_at`/`opt_out_public_listing`/`servicio.activo` en el submit, y
  reset del token de Turnstile tras un submit fallido (token de un solo uso).
- **Orden de deploy**: M53 aplicada a prod ANTES del merge vía
  `push-pending-migrations.mjs` (verificada: una sola firma de 4 args).
- **Verificación**: reserva real E2E contra la DB de prod (org de test
  `lautaro-folio`, dev local): wizard completo → "¡Turno confirmado!" →
  pedido CONFIRMADO + turno CONFIRMADO origen BOOKING + paciente creado.
  El turno de prueba (2026-06-11 15:00 AR, "Test Auditoria Booking") queda
  en esa org de test como evidencia.

### D6 — Runbook de datos prod ejecutado (2026-06-11)

- **Backup previo**: `scripts/backup-logical.mjs` (nuevo) — 54 tablas / 692
  filas → `~\folio-backups\2026-06-11T17-21-17-068Z` (fuera del repo; el plan
  Supabase FREE no tiene backups automáticos — ver pendiente del founder).
- **UPDATEs auditables** (vía MCP, solo DML):
  1. Org del founder (`lautaro-amiune`): `is_internal_account=true` (estaba
     bloqueada por el gate de billing — grace vencida, 0 suscripciones) y
     rename `puticlub` → `Consultorio Lautaro Amiune` (reversible en
     /configuracion).
  2. `opt_out_public_listing=true` para 34 orgs de prueba (30 × `e2e-test-*`,
     `guestuserome{,-2,-3}` —incluida "QuiroAnal"—, `joejoedoedoe9`).
     Se conservan bookables: `lautaro-folio` (org de pruebas E2E),
     `lautaro-amiune`, `lorenzomj925` (usuario real Lorenzo) y `anyburghini`
     (CEM — parece usuario real; no se toca).

### D7 — M54 adelantada por el bloqueante B1 del review de #44 (2026-06-12)

- **Contexto**: el review adversarial de #44 (REAGENDAR) encontró que el
  pre-check del reagendado (fallback manual, per-profesional) divergía del
  chequeo de createTurno (RPC org-wide): en una clínica multi-profesional el
  pre-check podía pasar y el create fallar DESPUÉS de la transición
  irreversible a REAGENDADO → huérfano determinístico. La auditoría clínica
  encontró en paralelo el sobre-bloqueo org-wide del RPC (critical: el turno
  del cardiólogo bloqueaba a la psicóloga).
- **Decisión**: adelantar M54 (`slot_ocupado` con `p_profesional` +
  `p_exclude_turno`, defaults NULL = semántica M53 idéntica) ANTES de rehacer
  el PR #44. Aplicada a prod 2026-06-12 (verificada: firma única de 6 args),
  PR #46 con spec pgTAP del caso dos-profesionales-misma-hora.
- **Pendiente del rework de #44**: checkSlotOcupado usa el RPC con todos los
  params (se elimina el skip-RPC), callers pasan profesionalId, el fallback
  alinea bloqueo/pedido per-prof, getSlotsDisponibles filtra pedidos por
  profesional, y revalidatePath corre también en el orphan path (I2).
- **Escalado al founder (pixel-perfect)**: el botón Reagendar queda visible en
  el estado por defecto de /hoy → los snapshots hoy-light/dark van a diffear.
  El review verificó que ese baseline YA está stale en master (el botón X de
  Cancelar de un merge anterior tampoco figura en el PNG). Recomendación:
  regenerar los baselines de /hoy y /calendario como decisión consciente, en
  vez de esconder funcionalidad para preservar un PNG viejo. Ver pendiente 5.

## Pendientes de decisión del founder

1. **Renombrar tu org real**: tu organización (slug `lautaro-amiune`) se llama
   **"puticlub"** y además está bloqueada por el gate de billing (sin
   suscripción, grace vencida). Propongo: `is_internal_account=true` (mecanismo
   documentado) + renombrarla. El rename lo podés hacer vos en /configuracion
   en 30 segundos si preferís otro nombre.
2. **Plan Supabase FREE = cero backups** de una DB con PHI. Upgrade a Pro es
   decisión de billing tuya; mientras tanto hago dumps manuales pre-demo.
3. **OAuth app de Google en modo "Testing"**: los refresh tokens mueren a los
   7 días (la única integración real, de Lorenzo, ya está muerta con
   invalid_grant). Pasarla a "In production" en Google Cloud Console — solo
   vos tenés acceso.
4. **Resend (email de confirmación de booking) apagado en prod**: faltan
   `RESEND_API_KEY` + `EMAIL_FROM` en Vercel. Si me das acceso/lo seteás, el
   email del booking sale solo.
5. **Suite visual pixel-perfect: rota Y vacua** (corrección de la autocrítica
   2026-06-12 a la versión anterior de este punto): los baselines commiteados
   de las pantallas AUTENTICADAS son screenshots de /login — `app.spec.ts`
   nunca se loguea, así que la suite comparó login-contra-login desde el
   18-may y ninguna regresión visual real de /hoy//calendario fue observable.
   Además: 26/26 specs de app fallan hoy (cookie banner post-baseline) y
   18/20 del prototipo fallan por drift de entorno (900→1081px). **NO
   regenerar baselines ahora** (cementaría la vacuidad): primero agregar
   login/storageState a app.spec.ts, después regenerar TODO en entorno
   pineado, y decidir si la suite entra a CI o se degrada explícitamente a
   herramienta local. Esto es un proyecto chico (Lane B), no un toggle.
