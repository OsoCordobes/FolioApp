# B06 · Paquete de exportación clínica con archivos

## Contrato del primer tramo (B06b1 / M134)

La entrega completa es profesional y mediada: sólo `OWNER` o `DIRECTOR`
colegiado con acceso actual a la ficha, sesión vigente y MFA válido puede
iniciarla o retomarla. El trabajo fija `actor_user_id`, `actor_member_id`,
organización, paciente y SHA-256 de un inventario verificado. El servidor
resuelve esos identificadores desde la sesión autenticada; ningún parámetro
HTTP puede afirmar que una categoría está completa. La autorización se
revalida con el cliente RLS antes de cada operación y, al entregar bytes en
B06b2, antes y después de leer cada fragmento. Los bytes ya entregados no
pueden revocarse retroactivamente.

M134 crea un ledger privado y un bucket privado. `anon`, `authenticated` y
`service_role` no tienen acceso directo a las tablas; sólo las funciones
públicas acotadas, concedidas a `service_role`, operan el ledger. La política
restrictiva de Storage niega lectura y escritura de objetos del bucket a
clientes, incluso si existe otra política permisiva. El servidor nunca debe
aceptar un nombre de objeto enviado por el cliente: el namespace futuro se
derivará exclusivamente de `job.id`, `entry.id` y ordinal validados.

Una clave de idempotencia por actor y organización devuelve el mismo trabajo
si coincide paciente, miembro, fingerprint y cantidad esperada; un payload
distinto falla. Tomar un lease exige revisión exacta, autoridad actual y
lease libre o vencida. La revisión y el token protegen toda mutación futura
contra respuestas inciertas y trabajadores tardíos. Un fallo utiliza sólo
códigos fijos. El trabajo expira a las 24 horas y nunca será descargable
después de su vencimiento, aunque la limpieza esté pendiente.

**B06b1 no genera bytes ni ofrece transición a `READY`.** Las tablas de
entradas y fragmentos definen el contrato de verificación, pero ningún RPC
de este tramo permite registrarlos o declarar éxito. La autorización de
preparación B06b1 tampoco habilita descarga en estados `pending` o `leased`:
B06b2 exigirá explícitamente `state=ready`. B06b2 añadirá un
finalizador que compare inventario completo, lectura real de cada objeto,
tamaño y SHA-256 de todos los fragmentos, y autoridad actual antes de
marcar `READY`. Un documento retirado permanece en el inventario con cero
fragmentos y sin reactivar descarga. Una firma legada sin hash de origen
guardará `source_hash_kind=not_recorded`; el SHA calculado durante la entrega
no se presentará como hash histórico.

La limpieza futura será una operación privada acotada: `expire_due(1..50)`
identifica trabajos vencidos y el adaptador de B06b2 borrará **sólo** objetos
del bucket temporal bajo el prefijo derivado del `job.id`; confirmará
`cleaned_at` únicamente después de verificar el resultado. No se borran
documentos o firmas originales ni se instala un cron en B06b1.

El JSON v2, la exportación del portal y la UI siguen intactos. Este contrato
no promete una instantánea transaccional global, disponibilidad de archivos
retirados ni restauración acreditada. B06b2 tendrá que comparar el
fingerprint al final y fallar sin paquete parcial si cambian las fuentes.

## Tramo de bytes (B06b2 / M137, candidato)

El servidor vuelve a leer bajo RLS el JSON profesional y el inventario fuente.
Su fingerprint v1 normaliza sólo `exported_at` y los dos tiempos de lectura del
manifiesto; las fechas clínicas, estados, hashes, paths privados de fuentes
activas y metadatos restantes siguen determinando la huella. Un retirado no
aporta path al fingerprint porque nunca se permite leer sus bytes. El JSON congelado usa el tiempo
persistido de la entrada, de modo que un reintento no produce bytes distintos.
El ledger recibe una entrada JSON, cada documento y cada firma; un documento
retirado conserva su entrada de inventario con cero fragmentos y nunca se lee
del Storage original.

Cada operación procesa a lo sumo un fragmento de 3 MiB de una sola fuente.
El origen se valida por tamaño, tipo real y hash registrado cuando existe:
hasta 50 MiB para documento legado y 10 MiB para firma. Un hash calculado de
firma legada se conserva como **calculado en la entrega**, no como hash
histórico. El upload privado tiene `upsert=false`, timeout de 15 segundos y
lectura de vuelta obligatoria; una respuesta perdida sólo permite reanudar si
los bytes del objeto existente coinciden. El RPC de fragmentos exige lease y
revisión actuales y rechaza cambiar un ordinal ya registrado. Un lease vencido
se reclama con nuevo token; los fragmentos verificados sobreviven y el token
anterior no puede continuar.

Antes de `READY`, el finalizador coteja el conjunto exacto de entradas, sus
fragmentos contiguos, el fingerprint releído tras paginar el ledger y la
autoridad vigente. No relee todos los bytes en una sola petición: cada
fragmento ya fue releído antes de registrar/verificar su entrada, y ningún
camino de la aplicación modifica esos objetos. La futura lectura de B06b3
volverá a comprobar el hash de cada fragmento y la autorización antes y
después de entregarlo como archivo reconstruido. Hasta entonces, este tramo
no crea rutas de descarga ni anuncia una entrega completa al paciente.

La limpieza sigue siendo privada y explícita, sin cron. Sólo reclama trabajos
vencidos al menos cinco minutos antes. Para cada entrada, enumera únicamente
el prefijo derivado de job/entrada, borra sus objetos y exige dos escaneos
vacíos separados por un minuto; si un upload tardío aparece entre ambos,
reinicia la ventana. La confirmación global requiere que todas las entradas
hayan pasado ese control bajo el token de limpieza vigente. Nunca se borran
los originales. Cada llamada procesa como máximo una entrada, porque sus
operaciones Storage tienen tiempos de espera propios.

M138 completa el inventario de retirados sin ampliar la lectura ordinaria de
`documento_clinico`: una RPC autenticada entrega sólo metadatos clínicos
acotados, nunca bucket, path, URL ni bytes. Respeta la política MFA vigente,
el alcance por paciente y la caja fuerte incluso para OWNER. Dos lecturas
paginadas verifican filas y conteos; el builder y el plan unen esas filas con
los documentos activos leídos bajo RLS, sin duplicados y con total exacto.
Una revocación o cambio observable aborta sin paquete parcial. La descarga
original de un documento retirado permanece cerrada.

## Adaptador HTTP interno (B06b3a / M140, candidato)

Las rutas profesionales aceptan paciente e identificador de operación, nunca
fingerprint, cantidad esperada, bucket o path. M140 permite recuperar el job
por la misma operación y el mismo actor, organización y paciente; el resultado
no contiene lease. Una creación con respuesta incierta se consulta por esa
operación, sin generar otra intención automáticamente. El claim usa revisión
CAS. Su token se usa sólo en el cuerpo de peticiones de avance y finalización
y se mantiene en memoria del cliente: si se pierde la respuesta del claim,
se consulta el estado, se espera a que venza el lease y se reclama de forma
explícita con la revisión actual. No se roba un lease vigente ni se guarda el
token en URL, cookie o log.

Las mutaciones exigen `Origin` del mismo origen, `Content-Type` exactamente
`application/json` y cuerpo de hasta 2 KiB. Las rutas aplican límites por
actor y organización antes de crear trabajos o leer Storage; una petición
limitada responde 429 con `Retry-After`. La prueba HTTP hospedada medirá
consultas y latencia de la revalidación del inventario por fragmento antes de
habilitar la entrega completa.

El manifiesto READY se pagina de a lo sumo 50 entradas y declara el total
exacto, tamaño y SHA-256 calculado de cada archivo. Distingue el hash de
origen registrado del calculado durante preparación, y lista retirados sin
bytes. La fecha de captura del JSON indica preparación del paquete, **no**
estado clínico actual ni snapshot transaccional global. Antes y después de
cada página o fragmento, el servidor comprueba el inventario actual bajo RLS
y su fingerprint; un retiro, cambio de alcance o pérdida de MFA obliga a
preparar una operación nueva. Cada fragmento privado se deriva del ledger,
se relee con límite de 3 MiB, se compara por tamaño y SHA-256 y sólo se
devuelve si READY, TTL y autoridad siguen vigentes después de Storage.

Este tramo expone una API interna, no una entrega completa al usuario. B06b3b
debe reconstruir archivos ordinarios y ofrecer un camino verificable para
obtener el conjunto completo sin guardar parciales; la UI y su prueba HTTP
con navegador todavía no forman parte de B06b3a.
