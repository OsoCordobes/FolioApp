# Ensayo externo mínimo de transporte de correo

Estado: preparado para revisión offline. No autoriza ejecutar, enviar correo ni configurar un proveedor. Prueba el cliente real `lib/email/client.ts` sin inyectar `dependencies`: cliente → POST de Resend → aceptación. La recepción requiere observación humana posterior del único buzón controlado. No prueba el recorrido joined/outbox, ni Auth SMTP, ni modifica el comportamiento 409 del producto.

## Límite concreto

Dos mensajes ficticios A/B para un destinatario y remitente exactos, como máximo tres POST, 15 minutos desde crear el transporte y 10 segundos por petición. A obtiene aceptación; B obtiene un ID válido, guarda el receipt y luego el wrapper oculta deliberadamente la respuesta al cliente. Sólo esa pérdida controlada, con ambos escritos exitosos, habilita un único replay idéntico de B. El mismo ID debe regresar. Un timeout real, rechazo, receipt ausente/inconsistente, concurrencia o fallo de journal detiene la campaña. No hay retry general, GET, redirecciones ni reanudación automática; ante incertidumbre preservar evidencia y reconciliar manualmente antes de autorizar otro ensayo.

El wrapper permite exclusivamente `https://api.resend.com/emails`, POST, tres headers enumerados y los dos sobres exactos. Genera dos keys `folio-email/<UUID>` en memoria. Antes de cada petición guarda contador y huellas SHA256 de key/sobre; al aceptar guarda UUID del proveedor. El journal usa creación exclusiva, flush de archivo, rename atómico y fsync del directorio en Linux. Un error de persistencia nunca habilita replay. No conserva dirección, key cruda, asunto, cuerpo, respuesta cruda ni headers. El resultado conserva SHA/tree/nonce, hashes, IDs, estados y contadores; `reception=not_observed`, `joined=false`, `authSmtp=false` incluso cuando pasa transporte.

## Inputs aún pendientes

El titular debe identificar el único buzón controlado y remitente exacto con dominio verificado, autorizar expresamente dos mensajes/tres POST y la inyección, confirmar presupuesto/cuota de Resend compartida y custodiar una key dedicada de envío con el menor permiso aplicable. Este arnés no consulta cuentas privadas ni crea credenciales. Un eventual GET del ID se realiza manualmente y por separado con permisos ya autorizados; no amplía la key del ensayo a lectura.

Se necesita un Environment existente con sus reglas reales de revisión manual. El nombre no acredita protección: antes de dispatch el operador verifica reglas, revisores, identidad y permisos, sin modificarlos ni imponer `prevent_self_review`. El gate consulta únicamente metadata GitHub y rechaza si faltan required reviewers; no demuestra que la aprobación humana ocurrió ni que la key tenga el scope correcto.

Variables del Environment: `MAIL_PROOF_REVIEWED_SHA` (commit revisado), `MAIL_PROOF_AUTHORIZATION_ID`, `MAIL_PROOF_REVIEWED_NONCE` (32 hex), `MAIL_PROOF_MANIFEST_JSON`, `MAIL_PROOF_REVIEWED_RUN_ID`. Secret: `MAIL_PROOF_RESEND_API_KEY`, expuesto sólo al paso de ejecución, después de preflight, instalación y pruebas offline. No secret en env global ni archivos `.env`.

Manifest v1, sin valores reales inventados: `version`, `runId` (nonce), `candidateSha`, `environment`, `from`, `to`, `authorization` con `reference`, `approvedAt`, `expiresAt` (vigencia ≤24h), `allowTwoMessagesThreePosts=true`, `allowControlledResponseLossReplay=true`. La autorización humana debe revisar el manifest completo exacto y sus inputs; SHA/nonce/referencia son bindings, no prueban por sí solos control del buzón o consentimiento. Ausencias o diferencias se rechazan sin mostrar el manifest.

## Procedimiento futuro, retenido

1. Revisar candidato/manifest y custodiar inputs en un Environment ya protegido. No cambiar configuración real sin autorización.
2. Dispatch manual con SHA/Environment/referencia autorizados. El run ID existe recién después de dispatch: esperar el job protegido pendiente, verificar SHA/nonce/referencia y fijar `MAIL_PROOF_REVIEWED_RUN_ID` a ese run concreto antes de aprobar. Sólo intento 1; nunca re-run. No pedir un ID inexistente antes de dispatch.
3. Tras aprobación, el job vuelve a comprobar los bindings antes de instalar y ejecutar. La ejecución revalida manifest/vigencia/HEAD/Linux/attempt/run ID antes de leer la key. Las reglas y disponibilidad temporal de vars en GitHub se deben verificar en ese ensayo futuro; el YAML/offline no certifican ese mecanismo vivo.
4. Conservar el receipt saneado incluso si falla. IDs iguales de B acreditan dedupe/aceptación del proveedor; observar en el buzón dos mensajes únicos acredita recepción para ese buzón. No subir MIME/cuerpo/direcciones: agregar recibo humano saneado con nonce, IDs, cantidad y hora. `email.delivered` sólo acredita entrega al servidor destinatario. No provocar 429, abusos ni rechazos para completar evidencia.

## Verificación offline

Node 22 y dependencias de `pnpm-lock.yaml`, sin instalar paquetes nuevos:

```text
node --conditions=react-server --import tsx --test scripts/testing/mail-external-proof/offline.test.mjs
pnpm exec eslint scripts/testing/mail-external-proof/*.mjs --max-warnings 0
```

Las pruebas llaman `sendEmail` real y sustituyen sólo fetch por respuestas sintéticas, sin red externa/DB. Cubren scopes, métodos, cuerpos, keys, topes, deadline, fallos de persistencia, timeouts, IDs incorrectos, pérdida controlada, replay, saneamiento y concurrencia. Windows verifica flush/rename de archivo; fsync de directorio Linux queda para el futuro runner autorizado. No ejecutar `run.mjs --execute` como prueba offline.

Fuentes oficiales contrastadas el 2026-10-03: [idempotencia](https://resend.com/docs/dashboard/emails/idempotency-keys) (retención 24h), [send](https://resend.com/docs/api-reference/emails/send-email), [retrieve manual](https://resend.com/docs/api-reference/emails/retrieve-email), [eventos](https://resend.com/docs/webhooks/event-types), [errores](https://resend.com/docs/api-reference/errors), [rate limits/cuota](https://resend.com/docs/api-reference/rate-limit), [permisos de key](https://resend.com/docs/api-reference/api-keys/create-api-key) y [dominios](https://resend.com/docs/dashboard/domains/introduction). No se promete forzar 429/409 ni acreditar inbox con aceptación.
