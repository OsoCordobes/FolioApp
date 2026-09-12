# Ensayo clínico con Supabase local real

Estado al 12 de septiembre de 2026: infraestructura de ensayo implementada;
**recorrido real todavía no ejecutado**. Docker Desktop está detenido. No se
intentó iniciarlo después del rechazo de la revisión automática. La validación
de tipos, lint y las pruebas del aislamiento no acreditan Auth, Storage ni el
recorrido del profesional.

## Preparación de la instancia

El perfil de `supabase/config.toml` se llama `folio-local-clinical` para separarlo
del antiguo `folio-app`. Usa PostgreSQL 17, API 54321, base 54322 y aplicación
4420. El puerto 4410 queda reservado para el runner ordinario y el ensayo visual;
el conflicto observado entre ambos fue la razón para separar el ensayo clínico.
TOTP está habilitado; teléfono, OAuth externos y proveedores adicionales
permanecen deshabilitados. El correo de Auth usa el servicio local Inbucket.
No introducir claves de producción, SMTP externo, túneles ni proxies.

Antes de cualquier CLI que pueda escribir configuración, conservar las copias
protegidas de `.env*`. Con Docker ya disponible, revisar la ayuda de la versión
instalada y levantar **este perfil local**, con todas las migraciones del checkout.
El ensayo no inicia Docker o Supabase, no aplica migraciones y no reinicia bases.
Si el perfil ya existe, inspeccionar su contenido antes de decidir cómo preparar
otra ejecución; no usar `db reset` para descartar datos desconocidos.

La lista de seeds referencia los cinco archivos reales en `supabase/seed/`, en
orden: obras sociales, CIE-10, plantillas, geografía y textos de analítica. Son
catálogos sin cuentas, pacientes, tokens o claves. Se revisaron sus columnas y
destinos contra las migraciones; la ejecución completa de esos seeds en Supabase
17 sigue pendiente. Cargar las plantillas no certifica su contenido clínico o
legal, especialmente el texto histórico sobre menores. No usarlas como aprobación
del piloto.

Obtener de `supabase status` únicamente los valores de esta instancia. La
[CLI oficial](https://supabase.com/docs/reference/cli/supabase-status) admite salida
JSON para capturarlos en memoria sin copiarlos al chat. Configurar:

```powershell
$env:FOLIO_TEST_SUPABASE_URL = "http://127.0.0.1:54321"
$env:FOLIO_TEST_SUPABASE_ANON_KEY = "<JWT anon local>"
$env:FOLIO_TEST_SUPABASE_SERVICE_KEY = "<JWT service_role local>"
$env:FOLIO_TEST_DATABASE_URL = "<DB_URL local, puerto 54322, base postgres>"
node scripts/testing/run-clinical.mjs
```

El comando usa `http://127.0.0.1:4420` por defecto. Si se define
`E2E_BASE_URL`, debe coincidir exactamente con esa URL: cualquier otro puerto se
rechaza. Antes de iniciar el runner de aplicación/navegador, el comando vuelve a
validar el perfil completo 4420/54321/54322 y sus credenciales locales.

No se necesita proporcionar un usuario: la preparación crea cuentas locales
`folio-clinical-…@example.test` mediante Auth, inscribe factores con la API real y
completa desafíos TOTP. Las contraseñas y secretos de esos autenticadores sólo
viven en memoria. No se inyectan sesiones ni cookies en el navegador: cada acceso
del profesional pasa por las pantallas reales de contraseña y segundo factor.

## Qué impide un resultado engañoso

Antes de escribir, el fixture exige los puertos exactos, JWT emitidos para local,
PostgreSQL 17, tablas propias de Auth/Storage reales, todas las versiones de
migración presentes y ausencia de usuarios u organizaciones ajenos al namespace
del ensayo. No admite el PostgreSQL 16 con stubs usado por las pruebas SQL.

Crea consultorios con `is_synthetic=true` (bloqueo durable de comunicaciones) y
`is_internal_account=true` (exención explícita para el ensayo). No inventa una
suscripción pagada. Inscribe el segundo factor antes de crear membresías para
que un error de enrolamiento no deje personal activo sin autenticador.

Activa por las RPC administrativas reales y comprueba en la base los siete
controles: preparación de MFA, exigencia de MFA, adjuntos, representación/firma,
población de instrumentos, guardado atómico y revisión de disponibilidad.
Un estado apagado o ausente falla. El motivo y referencia de activación señalan
que es un ensayo sintético; el SHA identifica la base del checkout, que puede
incluir cambios locales. Esa referencia nunca acredita un despliegue.

La prueba usa navegador en Pacific/Auckland y organización en Córdoba. Registra
narrativa de quiropraxia en «Notas libres», y SOAP en cardiología/psicología,
sin habilitar escalas para el paciente cuya fecha de nacimiento no se conoce.
Comprueba ciphertext descifrado con claves sintéticas, exactamente una ficha,
turno, sesión y pago, bloqueo tras cierre, subida a Storage y los mismos bytes
desde el proxy autenticado antes y después de volver a entrar.

El conteo final de pagos obtiene el consultorio mediante
`pago.turno_id → turno.organization_id`; `pago` no tiene una columna
`organization_id`. La revisión estática del resto de las consultas del fixture
contra las migraciones no encontró otro nombre de tabla, columna o RPC
incompatible. La consulta corregida todavía no se ejecutó sobre PostgreSQL real.

Una lectura protegida con AAL1 puede quedar filtrada como lista vacía o devolver
la denegación explícita `42501`. El ensayo acepta únicamente esas dos formas sin
filas; sigue fallando ante filas visibles, resultados incompletos y errores de red
o esquema.

El cobro probado es un registro de efectivo de ARS 30.000 en la caja del
consultorio; **no es una suscripción de Folio ni un cargo con Mercado Pago**.
El bloqueo de red del servidor y navegador se conserva. Los fallos de Auth,
Storage, RLS o selectores no se sustituyen por respuestas ficticias.

Los fixtures y archivos sintéticos se conservan para inspección; al terminar se
cierran las conexiones y sesiones API del ensayo. No hay borrado automático ni
archivo presentado como respaldo. Los informes sólo adjuntan conteos y estados,
sin contraseñas, códigos TOTP o contenido de pacientes reales.

## Evidencia y pendientes

La corrección agrega pruebas focales del puerto clínico, el preflight del comando
y las dos respuestas AAL1 permitidas. TypeScript, lint y el resto de la evidencia
exacta de esta revisión se registran en
`.flow/launch-reliability/clinical-preflight-report.md`. El listado de Playwright
sólo acredita descubrimiento de escenarios; no ejecuta el recorrido. El comando
clínico falla antes de levantar una aplicación cuando no recibe la configuración
necesaria. El runner normal mantiene 4410 y omite el spec clínico sin la
habilitación específica.

Pendiente: primer replay y ejecución sobre Supabase 17 real, investigar todos
los fallos que revele, ampliar roles/menores y consentimiento, pruebas de fallos
de guardado y proveedor y restauración completa. El séptimo escenario prepara
una suscripción sintética pausada, confirma la redirección de la interfaz común
a cobros y descarga PDF/JSON desde el archivo clínico autorizado, manteniendo el
aislamiento entre consultorios. Tampoco se ejecutó: no prueba todavía la continuidad
real, y sus aserciones de navegación no acreditan un bloqueo de escrituras directas
en servidor o base. Sólo un informe de ejecución sin omisiones podrá cerrar
los comportamientos que realmente haya comprobado.

Referencias: [desarrollo local](https://supabase.com/docs/guides/local-development),
[TOTP y APIs de enrolamiento/desafío/verificación](https://supabase.com/docs/guides/auth/auth-mfa/totp).
