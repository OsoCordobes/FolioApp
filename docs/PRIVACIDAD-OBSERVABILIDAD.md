# Privacidad de observabilidad (B3)

Implementado en código local; no configura ni limpia servicios de producción.

## Información que puede salir

- Sentry: tipo de error conocido, código SQLSTATE/HTTP de catálogo, operación registrada, contadores enteros acotados y ubicación del código (archivo exacto del catálogo y línea/columna). Se eliminan nombres de error arbitrarios, mensajes, funciones libres, variables, fragmentos fuente, datos de usuario, etiquetas desconocidas, contextos, cuerpo/cabeceras/cookies/URL/query y adjuntos. Un `captureException` existente pasa por esta reconstrucción antes de enviar.
- Session Replay, breadcrumbs, trazas/transacciones y logs propios del SDK están desactivados globalmente en cliente, servidor y edge. No se considera suficiente enmascarar texto del DOM clínico. El seguimiento automático de sesiones y los informes internos del cliente también están desactivados.
- PostHog servidor: sólo eventos expresamente registrados de signup, onboarding e importación agregada. No sale el `distinctId` recibido: se usa `folio-anonymous-aggregate`; no se crean perfiles ni se pide GeoIP. Los eventos de paciente/turno, SOAP, documento y booking individual se descartan en la frontera central, aunque un llamador antiguo aún intente producirlos.
- PostHog navegador: sólo eventos permitidos del landing `/`, con consentimiento vigente y sin DNT. No se inicializa en rutas clínicas/portal/token. La navegación hacia esas rutas o la revocación del consentimiento bloquean cada captura posterior. No se capturan páginas, referrer, campañas, replay, perfiles, flags ni identificadores persistentes. El payload se reconstruye después del enriquecimiento del SDK. La clave pública de ingestión se repone exclusivamente desde configuración: se necesita para enrutar el evento y no proviene de un atributo `token` del evento.
- Registros de aplicación: `safeLog` reemplaza las llamadas directas a console. Emite operación estática y hechos operativos permitidos; descarta strings arbitrarios, mensajes de proveedores y conversiones a texto de errores. Se conservan control de flujo y frecuencia de los logs. El catálogo vincula cada identificador a una ubicación del código; las operaciones desconocidas se registran como `operation_unknown`.

Los `Result` del data layer también normalizan `detail`: sólo permiten códigos del catálogo. `mapSupabaseError` utiliza el mensaje/constraint internamente para elegir una respuesta conocida, pero no devuelve el SQL ni sus detalles. El SQLSTATE 23514 produce una validación genérica comprensible, sin asumir que se trata de una especialidad.

## Cambiar o mantener los filtros

`lib/observability/privacy.ts` define la frontera; `catalog.ts` contiene sólo identificadores de código. Agregar una nueva operación o dato exige decidir explícitamente si debe salir. No agregar IDs de paciente/turno/org, correos, nombres, notas, diagnósticos, rutas privadas, tokens ni SQL libre para recuperar comodidad de diagnóstico. Los conteos deben derivarse de operaciones, no de campos de identidad.

Los filtros no cambian el audit log clínico interno: no es analítica de terceros. Tampoco eliminan registros ya enviados. Revisar retención, borrado y accesos históricos en Sentry/PostHog/Vercel con el operador autorizado, sin prometer limpieza retroactiva por este cambio.

La instrumentación propia no controla todos los logs generados por el proveedor de hosting, el proxy o dependencias antes de inicializarse. Verificar en preview los logs de acceso, query strings y fallos del runtime; los paneles de terceros no fueron inspeccionados ni modificados durante esta tarea.

## Evidencia

- `tests/unit/observability-privacy.test.ts`: pruebas RED→GREEN de los tres init reales de Sentry, PostHog servidor, consola y payloads con PII/PHI sintética, cookies, Authorization, URLs privadas, query tokens y detalles SQL. Comprueba también datos operativos conservados y prohibición de nuevos console directos en código de aplicación.
- `.flow/observability/browser.cjs`: Chromium, React y PostHog reales con ingestión HTTP local sintética. Verifica payload posterior al enriquecimiento del SDK, bloqueo al revocar consentimiento, navegación clínica y entrada directa clínica sin inicializar. Sin requests a servicios reales.
- Pruebas focalizadas adicionales de autenticación, rate limit, criptografía, auditoría, billing y transiciones. Las claves criptográficas usadas en tests son constantes sintéticas, no archivos de entorno reales.
- Del stash de auditoría se recuperaron sólo los diagnósticos de OTP y fallo de provisión de cuenta portal, adaptados a las RPC actuales y a `safeLog`. No se aplicó ni eliminó el stash completo.

Referencias: [Sentry: filtrado antes del envío](https://docs.sentry.io/platforms/javascript/configuration/filtering/), [Sentry: breadcrumbs](https://docs.sentry.io/platforms/javascript/guides/svelte/enriching-events/breadcrumbs/), [PostHog: SDK JavaScript](https://posthog.com/docs/libraries/js). Se contrastaron además los contratos del SDK instalado en este worktree.
