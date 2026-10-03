# Ensayo acotado Google real — PREPARED

Este paquete prepara un ensayo de **workers** con Google Calendar real y Supabase
efímero en un runner Linux de GitHub. Todavía no se ejecutó Google, OAuth, DB ni Docker
con este runner. Las pruebas locales son offline con transporte inyectado. No cierra
C05 ni acredita callback/UI, watch/webhook públicos o cron productivo.

Base: `8317f1871c2d8e41f3ee79463b3e80abd559cc8a`. Todos los archivos del paquete son
nuevos. `caller-proof/run.mjs`, `install-isolation.mjs`, producto y SQL no cambian.
`hosted.mjs` adapta sólo arranque, migraciones, Auth/MFA y fixture del runner aceptado;
reutiliza `ci-compose.yml` y `ci-loopback-bridge.mjs`, con proyecto propio
`folio_google_external_proof`. Conserva red Docker interna, claves/volúmenes nuevos,
PostgREST real y organización interna elegible con un profesional y paciente ficticios.
`is_synthetic=false` se usa para ejercitar la elegibilidad del worker, igual que la
prueba interna; sus datos siguen siendo ficticios y no existe suscripción inventada.
El pin Supabase es `8c7a4d9dbbaf8b552893822e89d7bf06f33f9220` de `self-hosted/v0.8.1`,
no una actualización de su gateway: el changelog actual anuncia Envoy para versiones
nuevas, mientras este paquete conserva el compose ya comprobado.

## Fronteras

- Cerrado por defecto. `run.mjs` exige `--execute`, GitHub-hosted Linux,
  `C05_EXECUTE=authorized`, manifest válido, grant válido y HEAD exacto.
- Una cuenta Google **exclusiva de pruebas**, sin datos personales/calendarios
  compartidos, autorizada por su titular. No impone Gmail. El ID real del calendario
  principal debe coincidir explícitamente con el correo de esa cuenta. Nunca envía
  `primary`; rechaza la cuenta personal conocida y sus alias Gmail con puntos.
- Scope exacto de Folio: `calendar.events`. No hay ampliación/fallback. Este scope
  permite eventos en calendarios accesibles; el aislamiento proviene de la cuenta
  dedicada y el transporte limitado al ID explícito. La identidad se sostiene en el
  recibo humano del consentimiento/custodia: no es identidad criptográfica OIDC.
- Sólo token refresh y eventos del ID fijado. Sin CalendarList/ACL, creación de
  calendarios, otros calendarios, watch/channels ni redirects HTTP. El token y los
  errores del proveedor nunca se escriben en recibos/consola.
- Preflight: `events.list` sin rango, `maxResults=1` y sólo campos
  `kind,etag,items(id),nextPageToken,nextSyncToken,defaultReminders,accessRole`.
  Exige owner, calendario vacío, snapshot completo y defaults vacíos; cualquier
  evento/página/default/omisión relevante detiene antes de DB o mutaciones. No imprime
  títulos. CalendarList.get no acepta el scope actual, por eso no se usa.
- Máximos por ejecución: **5 IDs, 60 requests** (cuenta también token refresh,
  preflight/readback/cleanup), **20 mutaciones, 30 minutos** y autorización vigente
  como máximo 24 h. Workflow tiene timeout total de 30 min. Sólo primer intento
  del **GitHub run ID** revisado; otro dispatch/re-run requiere autorización nueva.
- Títulos `Folio C05 prueba A–E`, zona `America/Argentina/Buenos_Aires`, fechas
  futuras dentro de 30 días. Transporte acepta únicamente payload ficticio esperado,
  elimina descripción, rechaza invitados/location/recurrencia/conferencia/ACL y fuerza
  `sendUpdates=none`. Respeta If-Match. Defaults deben estar vacíos porque el worker
  real conserva `reminders.useDefault=true`.
- Registro durable antes de cada request/mutación. Una escritura incierta sólo
  permite GET del mismo ID. Sólo propiedad `folio_operation=id` reconcilia la respuesta
  perdida; nunca insert repetido a ciegas. Un 404/410 en esa recuperación no autoriza
  reinserción. Errores definitivos 4xx se distinguen de red/5xx inciertos.

## Entradas pendientes, sin valores inferidos

No hay cuenta/cliente/redirect/Environment/grant reales en este repo. El operador y
titular deben completar personalmente estas entradas después de la revisión:

1. Cuenta Google dedicada y su ID principal explícito; autorización con referencia,
   aprobación y expiración para consentimiento + hasta cinco eventos ficticios.
2. Cliente Google Cloud expresamente autorizado, Calendar API habilitada, redirect
   registrado y usuario de prueba si corresponde. Los tokens del connector personal
   no son prestables. No se buscan credenciales de producto ni `.env`.
3. Environment **existente** con required reviewers para aprobación manual.
   El nombre no prueba custodia: el operador debe comprobar sus reglas y acceso a
   secrets antes del dispatch. El job `custody-gate` rechaza Environment inexistente
   o sin required reviewers mediante la API de GitHub; si el token no puede
   inspeccionarlas, falla cerrado. Respeta las reglas reales del Environment,
   incluida prevención de autoaprobación si está configurada: no la exige como una
   separación de identidades nueva ni la desactiva. No lo crea ni configura.
4. Variables del Environment: `C05_REVIEWED_SHA`, `C05_AUTHORIZATION_ID`,
   `C05_MANIFEST_JSON`, `C05_REVIEWED_RUN_ID`. La última se fija al run que espera la
   aprobación, antes de aprobarlo; no habilita otra ejecución. Procedimiento en dos
   fases: el titular hace dispatch con SHA/Environment/autorización; sólo corre el
   custody-gate sin secretos. GitHub crea el run ID y el job protegido queda esperando
   aprobación. El operador consulta ese ID y fija `C05_REVIEWED_RUN_ID` en el
   Environment antes de aprobar el job. Después se comprueba ID exacto y attempt=1
   antes de instalación o secretos. Este orden no exige conocer un ID antes de que
   exista; falta validarlo en un run autorizado y comprobar que las variables del
   Environment quedan disponibles al iniciar el job según las reglas reales.
5. Secrets de ese Environment: `C05_CLIENT_SECRET`, `C05_GRANT_JSON`. Sólo el paso
   explícito del ensayo recibe los secretos; instalación/tests no los reciben. Los
   subprocesses Docker/psql/git reciben entornos saneados, sin esas credenciales.

El manifest JSON tiene `version:1`, `runId` (32 hex aleatorios), `candidateSha`
(40 hex), `environment`, `accountEmail`, `calendarId`, `clientId`, `redirectUri` y
`authorization:{reference,approvedAt,expiresAt,dedicatedAccount:true,
noSharedCalendars:true,allowConsent:true,allowCreateMoveDeleteFiveEvents:true}`.
El grant privado tiene `version:1`, `clientId`, `accountEmail`, `calendarId`,
`scopes:["https://www.googleapis.com/auth/calendar.events"]`, `refreshToken`,
`consentAt` y `custodianConfirmedDedicatedAccount:true`.

## Bootstrap humano y custodia

`oauth-bootstrap.mjs --prepare <manifest privado> <directorio privado>` no ejecuta
red. Reusa `lib/google/oauth.ts:getAuthUrl`, añade PKCE/state aleatorios y login_hint;
escribe `challenge.json` y `consent-url.txt` con creación exclusiva, nunca la URL en
consola. Se ejecuta con `node --conditions=react-server --import tsx` y las referencias
`C05_CANDIDATE`, `C05_ENVIRONMENT`, `C05_AUTHORIZATION_ID` explícitas.

El directorio queda fuera del repo, con permiso 0700 en Linux/ACL equivalente
verificada por el titular en Windows; archivos 0600/ACL privada. No guardarlos en
carpetas sincronizadas ni artifacts. El titular abre personalmente la URL, elige la
cuenta autorizada y verifica la pantalla de consentimiento. El redirect elegido
debe entregar `code` y `state` a ese titular, quien los deposita en `callback.json`
privado. Este paquete **no** provee un callback público ni acredita la UI de Folio.
Si no existe un redirect controlado, ésa es una entrada faltante, no un fallback.

`--exchange` exige además `C05_CONSENT_EXCHANGE=authorized`,
`C05_CUSTODIAN_CONFIRMED_ACCOUNT=<cuenta exacta>` y `client.json` privado
`{clientId,clientSecret}`. Rechaza state/nonce vencido/scope inesperado; escribe
`exchange-attempt.json` antes de intercambiar una vez y `grant.json` privado. Si el
exchange queda incierto, no repetir: revisar/reiniciar consentimiento sólo con una
nueva decisión humana. No imprime tokens/respuestas del proveedor. El titular
transfiere grant/client secret directamente a secrets del Environment; no consola,
repositorio, log, artifact ni credenciales productivas. La revocación posterior debe
ser sólo de este grant dedicado, según decisión del titular.

## Casos y recuperación

`prove.mjs` conserva los cuatro casos de la prueba interna: lifecycle crear/reagendar/
cancelar/inasistencia (cuatro turnos), insert aceptado con una respuesta perdida,
evento externo ficticio E crear/mover/borrar y disponibilidad, edición propia D con
turnos/paciente intactos y sin doble bloqueo. Invoca outbound por turno e inbound
por integración, nunca cron global. La reagenda crea un turno nuevo B por el contrato
M119; el ID de cada job/turno se conserva y el transporte no genera sustitutos.

Cleanup sólo usa los cinco IDs registrados. Primero reconcilia incertidumbre y
comprueba propiedad de eventos activos; los ya cancelados/deleted no justifican
otra mutación. Readback final exige calendario vacío. Ante escritura incierta no
limpia Google; guarda ID/estado/contadores, snapshot saneado de turnos/jobs/bloqueos y
detiene. El backend efímero se elimina y se registra su cleanup; preserva el recibo
para que el operador use el **mismo manifest/grant** para inspeccionar ese ID antes
de decidir cualquier limpieza. Este paquete no tiene modo de reinicio/reintento
automático ni declara éxito por eliminar contenedores. Un timeout duro del runner
puede impedir el readback/finally o upload; conservar el último recibo si existe y
tratarlo como incompleto. No repetir dispatch para recuperar salida.

El único artifact permitido es `folio-google-external-proof.json`: SHA/tree/run ID,
hashes de cuenta/calendario, booleans de cuatro casos, IDs ficticios, estados,
contadores y snapshot saneado DB. Nunca tokens, direcciones, títulos, HTTP bodies,
errores crudos, `.env`, fixture de acceso ni trazas de navegador.

## Verificación offline

```powershell
node --test scripts/testing/google-c05-external-proof/offline.test.mjs
pnpm exec eslint scripts/testing/google-c05-external-proof/*.mjs
```

Las pruebas usan exclusivamente `fetchImpl` en memoria; incluyen compatibilidad del
googleapis del lockfile (refresh/insert/patch/If-Match/watch denegado), contratos,
fronteras/topes, saneamiento, journal previo, respuesta perdida y PKCE. No reutilizan
una campaña de DB loopback ni ejecutan el runner externo. Un workflow publicado
seguiría retenido por cuenta/cliente/redirect/grant/custodia/autorización y aprobación
del SHA: PREPARED no significa una ejecución externa autorizada o comprobada.

Referencias primarias verificadas durante la preparación:
[Google OAuth web server](https://developers.google.com/identity/protocols/oauth2/web-server),
[Events.list y defaultReminders](https://developers.google.com/workspace/calendar/api/v3/reference/events/list),
[CalendarList.get y scopes](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/get),
[Supabase cambio de gateway](https://supabase.com/changelog/48048-self-hosted-supabase-envoy-becomes-the-default-api-gateway-b).
