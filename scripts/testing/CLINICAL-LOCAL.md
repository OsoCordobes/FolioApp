# Ensayo clínico con Supabase local real

Actualización al 19 de septiembre: el runtime tiene **117 migraciones y nueve
controles activos**, con M122/M123 instaladas y auditoría original `3a9823a`
conservada. Run-14 sobre `cae1a3d` terminó con **11 aprobados y 1 fallido**.
Run-15 enfocado, sobre la corrección de prueba `8f9014c`, falló en la preparación
OWNER antes de verificar COORDINADOR; la causa de su demora sigue sin establecerse.
Run-16 instrumentado aprobó el caso COORDINADOR sobre la misma aplicación y SQL.
Hay evidencia combinada de los doce escenarios, sin una campaña única 12/12
aprobada. Se conservan datos, volúmenes y resultados previos.

## Baseline histórico anterior a M120/M121

Baseline ejecutado al 12 de septiembre de 2026: **7/7 escenarios aprobados**, cero fallidos
y cero no ejecutados, en 2,3 minutos (run-10). Supabase PostgreSQL 17.6 ejecutó
113 migraciones y cinco catálogos. Las tres especialidades completaron creación,
llegada, guardado cifrado, adjunto real, cobro efectivo y reapertura tras nuevo
ingreso. Pasaron las denegaciones de acceso, el archivo con suscripción pausada
y la revocación real de sesión Auth.

Base runtime fija e7da69f más las correcciones autorizadas de fixture, perfil y
selectores/expectativas. No incluye M120/M121 ni acredita producción, Mercado Pago
o latencia de producción. Los fixtures y volúmenes locales se conservan.

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

El fixture integrado sólo comprueba en la base los siete
controles: preparación de MFA, exigencia de MFA, adjuntos, representación/firma,
población de instrumentos, guardado atómico y revisión de disponibilidad.
Además requiere cierre atómico M120 y liquidación M121: nueve condiciones
obligatorias antes de crear una cuenta o dato. Un estado apagado o ausente falla.
El fixture no activa ni repara políticas. La activación administrativa local,
con M106 vigente y UI compatible revisada, es un paso separado del cutover.
La prueba usa navegador en Pacific/Auckland y organización en Córdoba. Registra
narrativa de quiropraxia en «Notas libres», y SOAP en cardiología/psicología,
sin habilitar escalas para el paciente cuya fecha de nacimiento no se conoce.
Comprueba ciphertext descifrado con claves sintéticas, exactamente una ficha,
turno, sesión y pago, bloqueo tras cierre, subida a Storage y los mismos bytes
desde el proxy autenticado antes y después de volver a entrar.

El conteo de pagos obtiene el consultorio mediante
`pago.turno_id → turno.organization_id`; `pago` no tiene `organization_id`.
Los contratos nuevos se cotejan con M120/M121, instaladas y activadas en la
instancia local preservada. La última campaña completa es run-14, con once
aprobados y un fallo de selector. Run-16 aprobó el caso enfocado de COORDINADOR:
hay evidencia combinada de los doce escenarios, sin una campaña única 12/12.
Una lectura protegida con AAL1 puede quedar filtrada como lista vacía o devolver
la denegación explícita `42501`. El ensayo acepta únicamente esas dos formas sin
filas; sigue fallando ante filas visibles, resultados incompletos y errores de red
o esquema.

El cobro probado es un registro de efectivo de ARS 30.000 en la caja del
consultorio; **no es una suscripción de Folio ni un cargo con Mercado Pago**.
El bloqueo de red del servidor y navegador se conserva. Los fallos de Auth,
Storage, RLS o selectores no se sustituyen por respuestas ficticias.

Los fixtures y archivos sintéticos se conservan para inspección; al terminar se
revocan las sesiones API y de navegador y se cierran contextos y conexiones. La limpieza se registra antes del primer login y sus fallos se informan aunque falle el enrolamiento. No hay borrado automático ni
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

Run-14 y run-16 aportan evidencia combinada de los doce casos con las migraciones
nuevas y UI revisada. La demora de run-15 sigue sin causa establecida; su resultado
fallido se conserva. Menores/consentimiento, fallos de guardado/proveedor y
restauración completa siguen fuera de esta campaña. El archivo autorizado sí pasó
en el baseline histórico; esa evidencia no acredita un bloqueo de escrituras directas.
Referencias: [desarrollo local](https://supabase.com/docs/guides/local-development),
[TOTP y APIs de enrolamiento/desafío/verificación](https://supabase.com/docs/guides/auth/auth-mfa/totp).

## Corrección de reloj y resultado real

La primera preparación falló porque Windows estaba entre 973 y 975 ms adelantado
respecto de PostgreSQL: p_after se calculaba en el host y la comprobación estricta
staff_enforce_after <= now() todavía no se cumplía. El fixture del baseline obtuvo
clock_timestamp() de la misma base local ya validada, exige una fecha válida y
la usó para activar MFA. El fixture integrado sólo comprueba el estado ya activo. Si la lectura falla o es inválida, no hay alternativa
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

## Expectativas visuales acotadas y diagnóstico del selector

El spec clínico usa uiExpect de 30 segundos sólo para nueve comprobaciones
positivas de presencia/valor DOM. Las negativas, ausencia, URL de bloqueo,
comparaciones de datos, polls SQL, bytes/API y todos los límites de servicios
se conservan. No se modificaron clicks, navegación, reintentos ni MFA del producto.
Tipos y lint del spec pasaron.

run-7 mantuvo 1 aprobado, 1 fallido y 5 no ejecutados: Notas libres tampoco se
encontró en 30 segundos. Esa espera no corrige la causa. Un observador separado
con Auth/UI/DB reales guardó y recargó la nota en 1,773 segundos: getByLabel
exacto devolvió cero campos; getByRole textbox con nombre exacto Notas libres
devolvió uno y su valor coincidió con el texto guardado. El label incluía el
marcador del textarea renderizado por servidor. Es un defecto del selector,
no una pérdida de persistencia ni evidencia de carga lenta en esa recarga.
Se sustituyeron exactamente tres selectores de quiropraxia por rol textbox y
nombre exacto, conservando el llenado y las comprobaciones del valor.

run-8 confirmó la recarga y el valor guardado. Falló después al buscar «Subir»
exacto: el componente renderiza «Subir documento». Resultado: 1 aprobado,
1 fallido, 5 no ejecutados, 3,7 minutos; sin documentos ni pagos. Se corrigió
sólo ese literal y se revisaron los restantes contra los componentes: cobro,
visitas previas, detalle SOAP y archivo coinciden. No se amplió ningún límite.


## Resultado final del baseline real

run-9 pasó AAL1 y quiropraxia completa, pero cardiología quedó Creando… y el
diálogo siguió visible al límite intacto de 20 segundos. Su paciente/turno
persistieron; resultado: 2 aprobados, 1 fallido y 4 no ejecutados. Coincidió con
checks concurrentes y ralentización general del host. Se conservó ese RED.

Tras terminar los procesos paralelos, run-10 repitió exactamente el mismo código
y los mismos límites: 7/7 aprobados en 2,3 minutos. AAL1 216 ms; quiropraxia
44,4 s; cardiología 27,5 s; psicología 29,0 s; lecturas cruzadas/AAL1 5,2 s;
archivo autorizado con suscripción pausada 15,9 s; revocación Auth 135 ms.
La repetición respalda un factor de entorno en run-9, sin localizar por sí sola
el cuello de botella ni acreditar tiempos de producción.

Cada especialidad confirmó un paciente/turno/sesión/pago, valor clínico cifrado
y recuperado, adjunto con hash/bytes iguales en dos descargas autorizadas y
denegación de lectura directa de Storage. El archivo produjo PDF y JSON reales,
rechazó el PDF de otro consultorio y conservó cero cargos de proveedor.

Inventario retenido de todas las ejecuciones y observadores: 36 cuentas Auth,
36 TOTP verificados, 36 consultorios sintéticos, 113 migraciones, 10 pacientes,
10 turnos, 9 sesiones, 4 pagos, 4 documentos/objetos Storage; una suscripción
sintética pausada y cero cargos de suscripción. Trazas desactivadas; logs
sanitizados locales. Tipos y lint final del spec pasaron; autorrevisión confirmó
que SQL polls, negativas, ausencia, URL de billing y límites de servicios no
cambiaron. El baseline no aplica las nuevas migraciones de cierre.

## Implementación integrada preparada (13 de septiembre de 2026)

Tasks1–2 incorporan doce casos independientes, cada uno con nuevas cuentas y
prerrequisitos propios: AAL1; tres especialidades; acceso cruzado; archivo pausado;
revocación; respuesta perdida tras CLOSE, RESOLVE y liquidación; ASISTENTE y
COORDINADOR. No consumen fixtures de otro test ni secretos de cuentas antiguas.
El OWNER prepara el caso de recepción y cierra/revoca su contexto; el rol ingresa
en uno nuevo por contraseña y TOTP. Auth, membresía, alcance y AAL2 se comprueban
con el token del navegador y de los POST reales, nunca con credenciales admin.

La interceptación sólo reconoce el server action compilado y la solicitud ligada
al turno, decisión/duración o pago. Reenvía la petición real, verifica el resultado
Flight y el recibo/estado SQL comprometido antes de abortar la respuesta. Una
petición normal observada conserva íntegra la respuesta real. Formatos React no
soportados, errores de transporte o prueba de commit rechazan el observador y
retiran la ruta; no generan confirmaciones. Los reintentos deliberados conservan
la operación o el pago original y las pruebas comparan originales, revisión,
duración, transición, recordatorio y recibos sin duplicarlos.

La implementación inicial aprobó 17/17 pruebas focales de seguridad y el
descubrimiento de doce casos, antes del cambio de instancia. Ese resultado de
código no ejecutó los doce casos reales. Se conservan DOM30s, MFA60s,
proveedor12s, SQL15s y caso180s; negativas, ausencia, polls y límites de acciones
no se amplían. Sin trazas ni retries globales. La actualización local posterior
confirmó visibilidad RPC en PostgREST después del commit de DDL; no debe
atribuirse un error de caché de esquema al producto sin comprobar esa frontera.

Corrección de evidencia del caso8: «Comprobar resultado» ahora se observa como
`getTurnoCloseReceiptAction` real, con identidad compilada, cookie del actor y
solicitud original completa. Su recibo devuelto debe coincidir con el commit y el
recibo original. Un detector permanece activo durante toda la recuperación y
rechaza CLOSE/RESOLVE/SETTLE, incluso con la misma clave idempotente y aunque ya
haya llegado una respuesta de lectura. El RPC adicional desde Node sólo aporta
una comprobación complementaria. La prueba focal nueva reprodujo RED antes del
soporte y pasó con éste:18/18 seguridad, sin skips; discovery conserva12casos.

## Corte histórico M120/M121 (13 de septiembre de 2026)

M120/M121 y sus registros canónicos se instalaron en una transacción local.
La activación separada M120 → M121, con M106 ya activa, conserva una entrada
por control y la razón auditada del código `3a9823a`. La instancia tiene
115 migraciones y nueve controles activos. Los cambios posteriores de código
requieren un inventario de sólo lectura; no justifican reinstalar SQL ni
reactivar controles. Las huellas de filas anteriores y la identidad/metadatos
de volúmenes se conservan; esto no prueba una restauración integral.

Run-11: 2 aprobados y 10 fallidos por diferencia entre la hora del navegador y
la del consultorio. La aplicación `c57f8f2` corrige creación, reagendado y pedidos:
50/50 escenarios aislados de navegador, revisión independiente, tipos, lint,
2198/2198 unitarias y compilación aprobados. Run-12 confirmó fecha y hora
completas de los diez turnos creados, pero terminó 4/12 aprobados.

Los ocho fallos de run-12 fueron cuatro selectores de cobro ambiguos, dos
rechazos del identificador compilado de la acción y dos errores sin causa
determinada: llegada sin transición y consulta de identidad Auth rechazada.
`280ef18` modifica sólo ocho archivos de pruebas: selector accesible más UUID
y conteo uno, identificador exacto de 42 caracteres emitido por Next 15 y
diagnósticos sanitizados de Auth/llegada. Conserva llamadas, plazos, ausencia de
reintentos y comprobaciones de actor, respuesta real y commit. Pasaron tipos,
lint, 2212/2212 unitarias, revisión independiente y controles focales de
seguridad20, Auth5 y llegada7. No hay nueva compilación de aplicación después
de `c57f8f2`, porque las fuentes de aplicación no cambiaron.

Run-13 sobre `280ef18` terminó con **6 aprobados, 6 fallidos y cero omitidos**
en ocho minutos. Pasaron AAL1, aislamiento/archivos, archivo pausado, revocación
y recuperaciones reales de CLOSE/RESOLVE. Quiropraxia y cardiología completaron
pago y reapertura, pero fallaron en limpieza del observador. Psicología y el
prerrequisito de saldo M121 fallaron en la confirmación visual posterior a un
cierre SQL confirmado. ASISTENTE/COORDINADOR iniciaron sesión con rol y alcance
correctos, pero la vista clínica dejó vacía su agenda operacional.

En ese cierre, el usuario pidió no repetir el recorrido y no se lanzó run-14.
La fuente final `17a3770` incluye retirada única de observadores (`57cfd03`),
confirmación visible del cierre propio (`dfc4af6`), lector operacional de Hoy
y M122 (`6a75cc1`), y M123 para impedir SELECT directo de pagos a COORDINADOR.
Verificación focal: observadores27/27, confirmación12/12 navegador y13/13unidades,
lector22/22; M122 replay116/64 y M123focal más cinco specs afectadas aprobados.
Tipos, lint,2231/2231unidades y compilación aislada de la aplicación final aprobaron.
En ese momento aún no había replay117/65 ni una campaña integrada final aprobada.

El runtime quedó en `280ef18`,115migraciones,nuevecontroles: M122/M123 no se
instalaron en ese cierre y no se reactivaron controles. La auditoría post-run13 confirma
cero sesiones propias,23previas preservadas,cero cargos y autoridades temporales.
Los ensayos y datos ficticios se conservan. Producción fue consultada sólo en
lectura:92migraciones,25faltantes del candidato. Se entrega rama/PR sin merge;
el orden de instalación/código/activación sigue en `docs/LAUNCH-RUNBOOK.md`.

## Reanudación y estado local (19 de septiembre de 2026)

La autorización renovada permitió continuar la comprobación. El candidato
`cae1a3da3d2586ce1d5a2ee7283723796481694c` conserva la aplicación `6a75cc1` y SQL
`17a3770`; GitHub aprobó sus 117 migraciones y 65 specs SQL el 13/09. El 19/09,
tras preflight, M122/M123 y sus registros canónicos se instalaron juntos a las
15:18:18 UTC. El preflight por conexión nueva de las 15:18:41 UTC confirmó 117
versiones y preservación de 21 tablas, dos volúmenes, nueve controles y auditoría
original `3a9823a`. El operador pasó 14/14 pruebas puras. No hubo reset ni reactivación.

Run-14 terminó con **11 aprobados y 1 fallido**. El selector CSS de la fila de
COORDINADOR encontró dos nodos; el snapshot contenía una sola fila accesible.
Eso no prueba por qué existía el otro nodo. `8f9014cc2ae0d69ffce766555912337cce610669`
cambia sólo la prueba a rol/nombre accesibles y exige una coincidencia exacta.
Conserva negativas financieras, RPC/REST e invariantes; revisión, tipos y lint
aprobaron. Producto, SQL, esperas y política de reintentos no cambiaron.

La auditoría post-run-14 conservó 16 cuentas y 16 factores TOTP nuevos, cero
sesiones Auth propias y 23 anteriores; totales de 40 sesiones clínicas, 17 pagos,
21 documentos/objetos Storage, 27 cierres y 13 recibos. Cero cargos y autoridades.

Run-15 enfocado falló antes de llegar a las comprobaciones de COORDINADOR: el
cierre clínico OWNER se confirmó en SQL a las 15:30:21 UTC, pero la interfaz
continuó en «Guardando» sin el aviso esperado durante 30 segundos y seguía pendiente
en la captura a los 42 segundos. La causa sigue sin establecerse; no se identifica
automáticamente con un defecto anterior ni se repitió esa escritura a ciegas.
El turno quedó CERRADO, requiere registro
administrativo y no creó un pago nuevo. Post-run-15: dos cuentas/TOTP nuevos,
cero sesiones Auth propias y 23 anteriores; 41 sesiones clínicas, 17 pagos,
21 documentos/objetos, 28 cierres y 13 recibos, sin cargos ni autoridades temporales.

Run-16 instrumentado sobre `8f9014c` aprobó **1/1, COORDINADOR**, en **50,1 segundos
de prueba y 1,1 minutos total**, sin cambiar producto `6a75cc1` ni SQL `17a3770`.
La promesa de CLOSE se resolvió en 2.476 ms desde el inicio de la espera. No se
capturaron tiempos internos del servidor ni se reprodujo la demora de run-15;
no se establece su causa. La auditoría verificó huellas idénticas de los datos
anteriores y activaciones conservadas, 117 migraciones y nueve controles. Post-run-16:
dos cuentas/TOTP nuevos, cero sesiones Auth propias y 23 anteriores; 42 sesiones
clínicas, 18 pagos, 21 documentos/objetos, 29 cierres y 14 recibos; cero cargos y
autoridades temporales. Se restauraron exactamente siete archivos y se retiraron
dos auxiliares de instrumentación, con diff tracked vacío en el runtime.
Evidencia conservada en `.flow/runtime-evidence/run-16-post-audit.json`,
`run-16-retained-post.json`, `run-16-gates-audit.json` y
`run-16-instrumentation/restored.json` de la copia clínica.

Los once escenarios aprobados en run-14 y el caso enfocado aprobado en run-16
completan evidencia combinada de los doce escenarios; no son 12/12 en una sola
campaña ni convierten run-15 en aprobado. El inventario productivo del 19/09
permanece en 92 versiones, 25 ausentes; no hubo DDL ni activaciones productivas
ni merge. El puente `efe19c68c849696d7d66bc8a43014ac494eb3310`, despliegue
`dpl_J7Pk9fWqzTF1aCyucVWmjMgz9YN6`, está READY sin promoción al dominio publicado.
Su comprobación anónima dio health 200, login 200 y Hoy 307 hacia login; el dominio
publicado mantuvo health 200. Las escrituras autenticadas y el corte productivo
conservan su verificación propia.
