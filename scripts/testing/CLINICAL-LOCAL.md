# Ensayo clínico con Supabase local real

Estado al 12 de septiembre de 2026: Supabase PostgreSQL 17.6 arrancó con las
113 migraciones y cinco catálogos. El recorrido completo **sigue pendiente**.
La última ejecución pasó AAL1 y avanzó por login/MFA, creación de paciente/turno,
llegada, guardado y denegación de escritura clínica directa. Falló al esperar
la nota después de recargar la ficha; el contexto posterior muestra el texto
guardado. Resultado: **1 aprobado, 1 fallido, 5 no ejecutados** por modo serial.
No acredita todavía Storage, cobro, archivo ni uso en producción.

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
destinos contra las migraciones; el replay real en Supabase
17.6 completó los cinco seeds (25 obras sociales, 77 CIE-10, 10 plantillas,
74 regiones y 20 textos de analítica). Cargar las plantillas no certifica su contenido clínico o
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

El comando usa `http://localhost:4420` por defecto. Si se define
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
incompatible. En PostgreSQL 16 local se reprodujo el error de columna de la
consulta anterior y el JOIN corregido devolvió cero filas en un consultorio sin
datos. Esto confirma validez SQL; el caso positivo y el recorrido sobre el perfil
Supabase/PostgreSQL 17 con Auth/Storage reales siguen pendientes.

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

Pendiente: medir la recarga de la ficha tras guardar y completar los siete
escenarios sobre Supabase 17 real, ampliar roles/menores y consentimiento, pruebas de fallos
de guardado y proveedor y restauración completa. El sexto escenario prepara
una suscripción sintética pausada, confirma la redirección de la interfaz común
a cobros y descarga PDF/JSON desde el archivo clínico autorizado, manteniendo el
aislamiento entre consultorios. Tampoco se ejecutó: no prueba todavía la continuidad
real, y sus aserciones de navegación no acreditan un bloqueo de escrituras directas
en servidor o base. Sólo un informe de ejecución sin omisiones podrá cerrar
los comportamientos que realmente haya comprobado.

Referencias: [desarrollo local](https://supabase.com/docs/guides/local-development),
[TOTP y APIs de enrolamiento/desafío/verificación](https://supabase.com/docs/guides/auth/auth-mfa/totp).

## Corrección de reloj y resultado real

La primera preparación falló porque Windows estaba entre 973 y 975 ms adelantado
respecto de PostgreSQL: p_after se calculaba en el host y la comprobación estricta
staff_enforce_after <= now() todavía no se cumplía. El fixture ahora obtiene
clock_timestamp() de la misma base local ya validada, exige una fecha válida y
la usa para activar MFA. Si la lectura falla o es inválida, no hay alternativa
con el reloj del host. Se mantienen los siete controles obligatorios.

El runtime está separado en folio-clinical-runtime y conserva e7da69f más
únicamente esa corrección del fixture; no incluye M120. El comando fue
node scripts/testing/run-clinical.mjs --trace=off --reporter=list, con las
credenciales de supabase status -o json sólo en memoria y salida local sanitizada.
Las trazas se deshabilitan para no conservar contraseña o TOTP del acceso UI.

La ejecución inicial con el cambio del reloj pasó la preparación y el escenario
AAL1 (membresía y portal dual protegidos), pero el recorrido de quiropraxia falló
antes de MFA. Una lectura sin credenciales también confirmó que /seguridad/mfa
en 127.0.0.1:4420 devuelve 307 hacia localhost:4420/login. Ese cambio de host
se corrigió después unificando el perfil en localhost:4420. En esa ejecución
los otros cinco escenarios no se ejecutaron. La
existencia de Storage real no prueba una subida o descarga todavía.

Los resultados completos y las limitaciones quedan en el informe local ignorado
.flow/launch-reliability/clinical-real-runtime-report.md. La CLI 2.98.2 publicó
los servicios Docker en 0.0.0.0 por defecto; el runner sólo accede a loopback.
No se modificaron el firewall ni las redes del host. Logflare y Vector quedaron
excluidos del arranque para evitar la configuración adicional de Docker Windows;
Auth, Storage y REST reales permanecieron activos.

## Origen canónico del perfil clínico

Next.js 15.5.24 normaliza las direcciones de loopback a localhost. El perfil
clínico usa ahora únicamente http://localhost:4420 para la aplicación, site_url
de Auth y sus retornos; la API sigue en 127.0.0.1:54321 y la base en
127.0.0.1:54322/postgres. Se rechazan el origen anterior de la app, IPv6 y
puertos alternativos. El runner común mantiene http://127.0.0.1:4410.

Las diez pruebas focales de aislamiento pasaron sin omisiones, junto con tipos
y lint de los archivos afectados. El perfil folio-local-clinical se detuvo y
arrancó conservando sus volúmenes: antes y después había 9 usuarios Auth, 9
factores TOTP verificados, 9 consultorios sintéticos y 113 migraciones. Auth
confirmó localhost:4420 en sus opciones activas; no se usó db reset.

La siguiente ejecución real (run-5) terminó con 1 aprobado, 1 fallido y 5 no
ejecutados. La UI llegó a MFA y Auth respondió 200 al desafío y verificación;
la aplicación continuó mostrando «Verificando…». Esto prueba que el origen
permite avanzar, pero todavía no acredita la finalización del acceso. La
investigación de esa respuesta queda separada de la corrección del perfil.

Un observador diagnóstico separado conservó la configuración y el acceso real,
sin modificar el timeout del spec. El POST de MFA devolvió 200 a los 4,525 s y
terminó a los 4,777 s. La UI seguía pendiente a los 15 s, durante una compilación
de /hoy de 10,7 s; a los 30,015 s ya mostraba «Verificación completada», siempre
en localhost:4420. Esto distingue la respuesta terminada de la espera posterior
de desarrollo. No convierte el escenario fallido en aprobado ni acredita
el recorrido clínico. El diagnóstico conservó 15 usuarios/factores/consultorios
sintéticos en total y no creó pacientes.

## Espera medida de desarrollo y siguiente límite

Sólo la aserción de confirmación de MFA se amplió de 15 a 60 segundos después
del diagnóstico de compilación. Conserva el título y navegación reales, el
límite total del escenario de 180 segundos, Auth del fixture de 12 segundos y
SQL de 15 segundos. No cambia MFA del producto ni acredita latencia productiva.

Con esa extensión, run-6 terminó en 1 aprobado, 1 fallido y 5 no ejecutados
(47,6 segundos). Pasó login/MFA y creó un paciente, turno y sesión de quiropraxia;
validó el marcador descifrado y el rechazo 42501 de una escritura directa. La
recarga posterior no encontró «Notas libres» dentro de 5 segundos, pero el
contexto capturado tras el fallo ya muestra el campo con el marcador correcto.
No se cambió esa espera: falta medir la presentación después de recargar.
Se conservan 18 usuarios/TOTP/consultorios sintéticos y una sesión revisión 1
sin cerrar; no se llegó a Storage, cobro o archivo.
