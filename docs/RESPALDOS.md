# Respaldos de Folio: preparación y ensayo local

Estado actualizado al 8 de septiembre de 2026: **hay una copia cifrada de producción verificada y una tarea de Windows registrada; la restauración completa de Supabase sigue pendiente**. La tarea funciona sin Codex y su primera ejecución comprobó que la copia todavía no estaba vencida. Véase [programación y evidencia actual](RESPALDOS-RUNTIME-PRIVADO.md). Los apartados siguientes distinguen el diseño y los ensayos sintéticos de la captura real; no deben interpretarse como una certificación de recuperación integral.

## Qué se conserva

`scripts/backup/run.mjs` captura un archivo PostgreSQL custom con `pg_dump`: esquema, datos, secuencias, objetos grandes, funciones, políticas/ACL y los esquemas disponibles, incluido Auth. Utiliza una transacción de sólo lectura y un snapshot exportado: una escritura posterior no entra parcialmente en el respaldo. No utiliza los JSON por tabla de `scripts/backup-logical.mjs`; ese script previo carece de consistencia global, DDL y archivos Storage.

Se agregan artefactos separados **dentro del mismo conjunto verificado**:

- `pg_dumpall --roles-only --no-role-passwords`: definiciones y membresías de roles, sin contraseñas de los roles PostgreSQL. Los hashes de contraseña de usuarios Auth están en el dump de `auth.users`; son cosas diferentes.
- Inventario de extensiones/versiones, esquemas, roles, ACL/configuración de base y ajustes por rol, dentro del manifest cifrado.
- Configuración proporcionada por el custodio: secciones `auth`, `storage`, `database`, `application`, `custody`. Debe incluir exportación revisada de Auth/proveedores/SMTP/redirects, Storage, versiones y dependencias, configuración de aplicación y referencia al material de recuperación de claves. El programa exige las cinco secciones, **pero no puede certificar que una exportación manual esté completa**.
- Archivos reales de Storage: listado independiente de buckets y listado recursivo paginado de objetos; descarga autenticada, versión ETag cuando existe, tamaño y SHA-256. Se compara la lista con el snapshot de metadatos y vuelve a verificarse al terminar. Un cambio, objeto faltante, respuesta truncada, fallo de acceso, advertencia de PostgreSQL o permiso insuficiente impide publicar un respaldo completo.

PostgreSQL y Storage no ofrecen aquí una transacción común. El resultado es **snapshot consistente de PostgreSQL más Storage cuya estabilidad fue verificada**, no un snapshot atómico entre ambos servicios. Para una recuperación con punto temporal estricto hace falta suspender escrituras durante la captura o almacenamiento con versiones/retención verificadas. Esto sigue siendo una condición operativa de producción.

## Cifrado y privacidad

Cada artefacto se cifra mientras se recibe, antes de escribirlo en disco: AES-256-GCM con clave aleatoria de 32 bytes e IV aleatorio; la clave se envuelve con RSA-OAEP-SHA256 para una pública RSA de al menos 3072 bits. Node utiliza primitivas criptográficas estándar. Este formato está separado del paquete de recuperación de secretos; no reutiliza su allowlist ni modifica la custodia existente.

El manifest también está cifrado. Nombres de objetos, destinatarios, cuentas, valores de configuración y SQL no quedan en recibos ni logs. Los archivos visibles se llaman `artifact_N.sealed`. El recibo público contiene únicamente identificador del respaldo, fechas y hashes del contenido cifrado. Restringir la carpeta mediante ACL del sistema: el `mode` de Node no sustituye ACL de Windows. La integridad comprueba corrupción/mezcla de artefactos; no constituye firma del origen frente a alguien que controla la carpeta y posee la clave pública.

El capturador cifra con la **clave pública**. Los primeros ensayos generaron claves ficticias en memoria. La verificación del paquete real utiliza la privada cifrada y la frase protegida por DPAPI del propietario; el runtime privado sólo las abre en memoria cuando corresponde verificar una captura. No publica sus valores.

Antes de restaurar se validan todos los archivos, su manifest, tamaños y AEAD. Ningún consumidor recibe un byte descifrado hasta verificar la etiqueta GCM completa. Después el dump autenticado pasa por memoria a `pg_restore`, sin archivo temporal de SQL/PHI en claro.

**Límite explícito:** 256 MiB de texto de origen por artefacto. La captura se interrumpe si lo excede. La verificación en memoria puede ocupar aproximadamente tres o cuatro veces ese tamaño por artefacto, más PostgreSQL/Node. No hay ensayo de restauración de grandes volúmenes ni afirmación de que este diseño soporte cualquier tamaño. Medir RAM y tiempo, o implementar segmentos autenticados y revisión criptográfica, antes de ampliar el límite. El volumen de producción observado por otra tarea era aproximadamente 25 MB; no se midió con estos scripts.

## Publicación, retención y continuidad

El conjunto se construye en `.incomplete_backup_*`. Sólo cuando PostgreSQL, roles, configuración, Storage y manifest finalizaron se renombra a `backup_*` y se actualiza atómicamente `last-success.json`. Una carpeta incompleta nunca cuenta como respaldo válido. Un fallo posterior al rename al actualizar el índice se comunica como `indexUpdated:false`: el conjunto existe, pero hay que reconstruir/revisar el índice; no se ejecuta poda en ese caso.

Una exclusión mantenida por el sistema operativo impide dos capturas simultáneas en esta PC. En Windows usa una tubería local con nombre derivado del destino; al terminar abruptamente el proceso, Windows la libera. La siguiente ejecución puede crear una copia nueva y conserva los archivos incompletos anteriores. No se desaloja una captura por antigüedad: una copia lenta sigue protegida. `.backup-owner.json` es sólo un diagnóstico, no bloquea ejecuciones tras un apagado. Un lock de directorio de la versión anterior sólo se archiva automáticamente si su PID ya no existe; ante datos incompletos o un PID activo se requiere revisión. En otros sistemas se usa un puerto de loopback exclusivo; una colisión rechaza la captura de forma segura. Este mecanismo protege un destino local en una PC, no una carpeta compartida entre varios equipos.

La poda valida hashes y la estructura completa del recibo antes de contar copias: identidad de carpeta, fechas coherentes, manifest, archivos esenciales, nombres únicos y secuencia completa que coincida con los archivos reales. Rechaza enlaces simbólicos. Conserva el punto más reciente de cada uno de siete días con respaldo y cuatro semanas con respaldo; una copia puede servir a ambas categorías. Siempre conserva la copia válida más reciente. No elimina automáticamente copias corruptas ni incompletas. Esta comprobación pública detecta corrupción e inventarios incompletos; la autenticación AEAD con la clave privada sigue siendo parte de la verificación previa a restaurar. Revisarlas antes de liberar espacio.

`status` valida la copia indexada y avisa `stale:true`/`catchUp:true` si falta, está corrupta o tiene más de 24 horas. `catch-up` ejecuta una captura cuando corresponde. **No se creó una tarea programada.** El siguiente paso operativo es programar diario más arranque del equipo, medir RPO real, y alertar si el equipo estuvo apagado. La página no depende de que el equipo esté encendido; la frescura del respaldo sí.

Pendiente de configuración por el titular: copia semanal al disco físico, con verificación de hashes, y ensayo de restauración mensual. Un directorio en el mismo equipo no protege contra pérdida del equipo. RPO 24 h y RTO 4 h son objetivos a medir; no garantías actuales.

## Herramientas y compatibilidad

Producción fue identificada por otra tarea como Supabase PostgreSQL 17.6, con esquemas `analytics`, `auth`, `cron`, `extensions`, `graphql`, `graphql_public`, `public`, `realtime`, `storage`, `supabase_migrations`, `vault`; extensiones `btree_gist`, `pg_cron`, `pg_stat_statements`, `pg_trgm`, `pgcrypto`, `pgsodium`, `plpgsql`, `supabase_vault`, `uuid-ossp`. No se reemplazan estas dependencias por stubs al afirmar recuperación completa.

Cliente PostgreSQL **17.11** descargado por HTTPS desde el distribuidor EDB referido por PostgreSQL, sin instalador ni servicio:

- Herramientas: `C:/Users/amiun/AppData/Local/FolioTools/postgresql-17.11/pgsql/bin`.
- Archivo oficial: [binaries PostgreSQL 17.11 para Windows](https://get.enterprisedb.com/postgresql/postgresql-17.11-1-windows-x64-binaries.zip).
- SHA-256 medido del ZIP: `6EABDF00D2893713B75DB4336A23C3FDF505F056E217EC6E2E95D901750CFEA3`. Es un hash medido, no un checksum publicado independientemente por EDB.
- `pg_dump --version` y `pg_restore --version`: 17.11 verificados.

La captura rechaza un cliente más viejo que el servidor y exige cliente >=17 salvo un ensayo explícitamente local con PostgreSQL 16. El ensayo de extremo a extremo utilizó PostgreSQL **16.15**, WSL Ubuntu y el puerto local 55439 existente. **No prueba PostgreSQL 17 ni Supabase completo**. Referencias: [pg_dump 17: snapshot y alcance](https://www.postgresql.org/docs/17/app-pgdump.html), [Supabase: backup/restore y Storage separado](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

## Uso preparado, sin secretos en el repositorio

Guardar configuración y claves fuera del repositorio. El programa no carga `.env.local`. Variables de entrada: `FOLIO_BACKUP_DATABASE_URL` y `FOLIO_BACKUP_STORAGE_SERVICE_KEY`. No pasarlas como argumentos ni imprimirlas.

Ejemplo de configuración **sin secretos** para preparar captura; completar y revisar fuera del repo:

```json
{
  "destination": "C:/Users/amiun/FolioBackups",
  "recipientPublicKeyFile": "C:/ruta-privada/recipient-public.pem",
  "platformConfigFile": "C:/ruta-privada/platform-config.json",
  "storageUrl": "https://PROYECTO.supabase.co",
  "source": {
    "tools": { "binDirectory": "C:/Users/amiun/AppData/Local/FolioTools/postgresql-17.11/pgsql/bin" },
    "expectedServerMajor": 17,
    "allowRemoteSource": false,
    "confirmSourceHost": "db.PROYECTO.supabase.co"
  }
}
```

La opción remota permanece `false` en el ejemplo. La captura de sólo lectura solicitada en el plan ya está autorizada y exige confirmar el host exacto. El checkpoint inicial puede conservar los artefactos disponibles con `recoveryComplete:false`; no presenta una configuración incompleta como recuperación integral. Verificar también que Storage corresponde al mismo proyecto. No usar una URL con opciones que puedan redirigir libpq; las herramientas eliminan variables PG ambientales y pasan host/puerto/base/usuario explícitos, verificando TLS y hostname con la CA oficial en conexiones remotas. La carpeta de salida se rechaza si es el repositorio, un descendiente o un alias por junction/symlink; Windows se compara sin distinguir mayúsculas. Mantener sus directorios padre bajo control del custodio durante la captura.

```text
node scripts/backup/run.mjs status C:/ruta-privada/backup-config.json
node scripts/backup/run.mjs run C:/ruta-privada/backup-config.json
node scripts/backup/run.mjs catch-up C:/ruta-privada/backup-config.json
```

Restauración local: preparar **una base NUEVA y VACÍA** llamada `folio_restore_<identificador>` en loopback, con extensiones disponibles y roles ya preparados. El programa no crea ni altera roles globales, no cambia superusuarios y no ejecuta `roles.sql`; tampoco borra una base existente. La configuración confirma el nombre exacto mediante `confirmDatabase`. Se exige la versión del servidor adecuada y la misma versión mayor de `pg_restore` que produjo el dump. Mantener el destino reservado para este ensayo, sin otros escritores.

```json
{
  "directory": "C:/Users/amiun/FolioBackups/backup_IDENTIFICADOR",
  "recipientPrivateKeyFile": "C:/ruta-privada/recipient-private.pem",
  "confirmDatabase": "folio_restore_ensayo",
  "tools": { "binDirectory": "C:/Users/amiun/AppData/Local/FolioTools/postgresql-17.11/pgsql/bin" }
}
```

Pasar el destino sólo mediante `FOLIO_BACKUP_RESTORE_DATABASE_URL`; si la privada está protegida, su frase va en `FOLIO_BACKUP_RESTORE_PASSPHRASE`. Ejecutar `node scripts/backup/restore-local.mjs C:/ruta-privada/restore-config.json`. El destino tiene que ser loopback y vacío. El dump se aplica en una transacción con abortado ante error.

### Recuperar los bytes de Storage en el destino local

El orden es **restaurar PostgreSQL y sus metadatos, luego subir los bytes con la API de Storage**. El servicio de destino, sus roles y configuración deben estar preparados manualmente, aislados de producción y sin proveedores/crones externos. Este comando no reaplica credenciales ni configuración del origen. La [guía oficial de migración de Supabase](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) utiliza `upsert:true` para copiar archivos; [restaurar una base recupera metadatos, pero no los archivos](https://supabase.com/docs/guides/platform/migrating-within-supabase/dashboard-restore).

`scripts/backup/storage-restore.mjs` exige IP literal loopback, origen exacto confirmado y `metadataRestored:true`. Rechaza redirects. Autentica **todo** el paquete antes de crear el registro de recuperación o subir un byte. Compara buckets, privacidad de buckets cuando está disponible y cada par ruta/ID con los metadatos del manifest; una fila adicional o faltante bloquea la carga. No crea buckets ni elimina filas para evitar conflictos.

La carga utiliza la ruta exacta del manifest y conserva tipo MIME/cache-control cuando fueron capturados. Cada objeto se vuelve a descargar y se comprueban tamaño y SHA-256; una respuesta exitosa de upload por sí sola no cuenta como verificación. Antes de reintentar se hace la misma comprobación: una respuesta perdida tras una carga correcta no duplica el upload. Si ya había bytes diferentes, se rechaza sobrescribirlos; sólo un objeto marcado como carga pendiente por ese mismo ensayo puede reintentarse.

El [upsert de Storage](https://github.com/supabase/storage/blob/master/src/storage/database/pg.ts) conserva el ID de la fila al resolver el conflicto por nombre/bucket, pero actualiza versión y metadatos; el tratamiento de propietario depende de los datos proporcionados por el servicio. **No volver a aplicar los metadatos antiguos después de subir**, porque podrían apuntar a una versión de backend inexistente. Las migraciones de Folio M07/M08/M94 referencian rutas de firmas/documentos y aplican políticas por segmentos; no se encontró una FK de aplicación a `storage.objects.id`. No se modifica ninguna historia clínica para recuperar archivos. La [propiedad de Storage depende del JWT](https://supabase.com/docs/guides/storage/security/ownership): conservación de ownership y permisos efectivos debe verificarse con la versión real de Supabase, y el resultado conserva `storageOwnershipVerified:false`.

Configuración separada, también fuera del repositorio:

```json
{
  "phase": "storage",
  "directory": "C:/Users/amiun/FolioBackups/backup_IDENTIFICADOR",
  "recipientPrivateKeyFile": "C:/ruta-privada/recipient-private.pem",
  "storageUrl": "http://127.0.0.1:54321",
  "confirmStorageOrigin": "http://127.0.0.1:54321",
  "metadataRestored": true,
  "journalDirectory": "C:/ruta-privada/restore-journal"
}
```

Usar exclusivamente la credencial del **destino local preparado** mediante `FOLIO_BACKUP_RESTORE_STORAGE_SERVICE_KEY`, más la frase privada si corresponde. Se ejecuta el mismo `restore-local.mjs` con esta configuración. El valor `metadataRestored:true` confirma el paso manual previo; no sustituye las comprobaciones de inventario ni certifica que Auth funcione.

El registro fuera del repositorio contiene un ID de ensayo, identificador/hash del respaldo y fases `metadata_checked`, `copying`, `pending`, `verified`; sólo enumera nombres opacos `artifact_N.sealed`, sin rutas clínicas, contenido, claves o errores del proveedor. Utilizar siempre el mismo `journalDirectory` para reanudar un destino. Una exclusión del sistema operativo identifica el origen local del destino y también impide un segundo escritor que elija otro directorio de registro. Sus metadatos están en un subdirectorio por destino; el sistema libera la exclusión al morir el proceso. Después de un cierre abrupto se puede repetir la misma fase, paquete y destino: vuelve a descargar y comprobar lo ya aceptado sin duplicar uploads. Un registro que corresponde a otro manifest se rechaza. Los locks de directorio de versiones anteriores se conservan y requieren revisión manual; no se retiran por antigüedad ni porque exista una ejecución nueva. No ejecutar versiones antiguas y nuevas del restaurador simultáneamente.

Una intención `attempting` no demuestra quién escribió los bytes presentes. Si la descarga encuentra contenido diferente del respaldo, el restaurador lo conserva y queda pendiente; tampoco lo reemplaza cuando podría provenir de una carga propia corrupta. Hace falta que el operador identifique ese contenido y decida su tratamiento fuera de la reanudación automática. Una ausencia confirmada permite cargar; una coincidencia de tamaño y SHA-256 permite omitir la carga.

**Frontera de rollback:** PostgreSQL se restaura en una transacción; PostgreSQL y los uploads no tienen una transacción conjunta. Si falla Storage, quedan los archivos ya verificados y el registro pendiente. No se borran archivos, versiones históricas ni registros clínicos como compensación. Resolver el fallo y reanudar; mantener el destino aislado hasta verificar el conjunto. `storageFilesRestored:true` informa solamente que se verificaron los bytes; `configurationApplied`, `rolesApplied`, `authLoginVerified` y `storageOwnershipVerified` siguen en `false`.

## Evidencia y lo que aún no está resuelto

### Diagnóstico del checkpoint inicial, 8 de septiembre de 2026

El volcado real terminó con código 0 pero emitió una advertencia de claves foráneas
circulares en `pgsodium.key`. El programa la rechazó: los intentos incompletos no
publicaron `last-success` y permanecen diferenciados de una copia válida. Se guardó
el diagnóstico cifrado, sin imprimir SQL, secretos ni datos de pacientes.

La causa se verificó con consultas de sólo lectura: la tabla de configuración de
la extensión tenía una clave foránea hacia sí misma y cero filas. La opción
`omitVerifiedEmptyPgsodiumKey` vuelve a verificar esas tres condiciones **dentro del
mismo snapshot exportado** y registra la evidencia en
`omittedEmptyExtensionData`. Sólo entonces agrega
`--exclude-table-data=pgsodium.key`: omite cero filas, conserva la extensión y no
retira ninguna estructura. Una fila existente, una tabla ajena a la extensión o
una condición no verificable bloquea el procedimiento y preserva la última copia
válida. Toda otra advertencia continúa siendo fatal. No se deshabilitaron triggers
ni se cambiaron permisos de producción. PostgreSQL documenta la necesidad de
[revisar las advertencias de pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html).

El nuevo checkpoint `backup_20260908T180415096Z_87e87a78-12ec-47ee-9639-b1baff17fe2d`
terminó y se autenticó a las 18:06:52 UTC: volcado PostgreSQL de 1.769.330 bytes,
roles sin contraseñas de 6.226 bytes y configuración de 6.505 bytes, todos cifrados
antes de escribirlos. Storage se verificó por separado y contenía cero objetos.
Se actualizó `last-success`; los intentos fallidos permanecen incompletos.
`complete:true` identifica una captura íntegra, mientras que la configuración
recuperable completa, el ensayo de restauración integral y la custodia independiente
de la frase siguen pendientes.

Después de esa captura cambió la configuración observada de Auth: Site URL
`https://foliosalud.com` y 15 redirects. Se preservó la observación anterior y se
actualizó el inventario actual sin alterar el checkpoint. La configuración dentro
de éste es una **observación histórica**, no un snapshot atómico de Auth junto a
PostgreSQL. El export completo de Auth y su validación siguen pendientes.

Los procesos tienen límite total de 10 minutos (3 minutos para este checkpoint),
comprobación de versión de 10 segundos y cierre de conexión de 5 segundos. Al
vencer el plazo se termina el proceso propio y se cierran sus canales. El stderr
se retiene como máximo en 64 KiB para su escritura cifrada; un diagnóstico truncado
o fallido no convierte un error en éxito. La salida pública contiene únicamente
categoría estática, código de salida y tamaños.

`verify-owned-structure.mjs` es un ensayo separado y limitado: autentica todos los
artefactos antes de escribir y extrae únicamente la estructura pre-data de
`public.instrumento_respuesta` a memoria. La aplica en una base loopback nueva y
vacía sin cargar filas, credenciales, roles, extensiones ni configuración del
origen. Para PostgreSQL16 omite únicamente el ajuste de sesión `transaction_timeout`
introducido por pg_restore17 y los delimitadores propios de psql. Esta verificación
no equivale a restaurar el esquema completo de Supabase; informa explícitamente
`fullStructureRestored:false`, `fullDatabaseRestored:false` y `authLoginVerified:false`.
Este ensayo pasó sobre el checkpoint real: 13 columnas y cero filas en una base
local nueva; la evidencia suplementaria se guardó fuera del paquete inmutable.
La ampliación de pruebas terminó con **24 PASS y cero omitidas**, incluido el
PostgreSQL local real. Cubre timeout, cierre bloqueado, diagnóstico cifrado acotado,
advertencia desconocida fatal y rechazo de la omisión si aparece una fila de clave;
en ese rechazo se conserva la última copia válida. ESLint también pasó.

Pruebas `node --test tests/recovery/backup*.test.mjs`: **16 PASS, cero omitidas** en el ensayo con PostgreSQL local habilitado; lint de scripts/pruebas también pasó. Incluyen corrupción, truncado, contexto incorrecto, fallo de DB/Storage que conserva la última copia, solapamiento, lista cambiante, tamaño de archivo, retención y atraso. El ensayo PostgreSQL requiere `FOLIO_RUN_LOCAL_BACKUP_REHEARSAL=1` y `FOLIO_BACKUP_TEST_ADMIN_URL` **exclusivamente sintética y loopback**; crea dos bases nuevas de prueba, verifica y elimina sólo esas bases. No cargar secretos reales para estas pruebas.

Ensayo local real: se restauró una tabla de datos, una cuenta/hash Auth ficticios, ACL y tres filas de metadatos Storage; el dump excluyó una escritura concurrente posterior al snapshot. Tres archivos ficticios se obtuvieron por HTTP local paginado, con carpeta anidada, y sus artefactos cifrados se autenticaron. Se rechazó restaurar de nuevo sobre la base ya poblada.

La carga de archivos fue ensayada contra un **servidor HTTP ficticio en loopback**, sin Docker: rutas anidadas exactas, bytes, descarga verificada, respuesta perdida tras aceptación, fallo a mitad de carga, bytes distintos, inventario ajeno y reanudación sin uploads repetidos. Una prueba corrompe la etiqueta AEAD del último archivo y recompone su checksum público: se rechaza antes de subir el primero o crear un journal. Esto prueba el protocolo del código, **no un backend real de Supabase**. La fase PostgreSQL por sí sola sigue devolviendo `storageFilesRestored:false`.

Falta ensayar el destino Supabase 17 preparado con roles/extensiones gestionados y medir RAM/tiempo; verificar ownership y políticas después de cargar objetos; completar y revisar configuraciones/JWT/secretos con el custodio; desactivar crones/proveedores externos del destino antes de restaurar; verificar login real, MFA, sesiones, buckets, descifrado clínico y flujos completos. El inicio de Docker fue bloqueado en otra tarea: no se intentó otro daemon desde este trabajo. El titular revisará el primer manifest con la configuración recuperable completa. La captura de sólo lectura autorizada puede avanzar al disponer de esos insumos; **programación y declaración de recuperación integral operativa siguen pendientes**.


### Revisión independiente local de integridad y reanudación

La revisión del 8 de septiembre de 2026 reprodujo y corrigió cinco casos: recibos con inventarios incompletos que contaban como válidos; exclusión de Storage persistente después de matar el proceso; dos escritores al mismo destino con registros en carpetas distintas; reemplazo de bytes diferentes apoyándose sólo en una intención pendiente; y cambio de un archivo cifrado válido entre la verificación del paquete y su consumo por PostgreSQL. El consumidor ahora compara nuevamente tamaño y SHA-256 contra el manifest inmediatamente antes de entregar el dump.

`pnpm test:recovery`: **40 PASS, una prueba opcional PostgreSQL omitida**, cero fallos; lint focal pasó. Se terminó un proceso hijo real durante una carga aceptada por el servidor HTTP sintético y se reanudó sin repetirla. La carrera entre dos carpetas de registro se rechazó antes del segundo upload. El ensayo de cambio del dump ejecuta el restaurador con criptografía y archivos reales, sustituyendo únicamente el adaptador PostgreSQL para comprobar que no consume el archivo cambiado. Los ensayos AEAD existentes siguen rechazando corrupción del último artefacto antes de la primera escritura.

Esta revisión no ejecutó PostgreSQL, Supabase real, producción, capturas de datos del titular ni una tarea programada. El log local es `%TEMP%/folio-backup-independent-final.log`. Siguen vigentes los límites de tamaño, consistencia entre servicios, ACL del destino y validación integral pendientes descritos arriba.

### Lanzador propietario preparado; programación todavía inactiva

`scripts/backup/owned-task.ps1` admite `Status`, `CatchUp` y `VerifyExisting`. Usa el paquete privado existente `C:\Users\amiun\folio-recovery\initial-20260908-182017`; el helper rechaza otra ruta, rutas relativas, destinos del repositorio y alias mediante junction/symlink. El destino conserva sus permisos privados de Windows. No copia claves al repositorio, no escribe `.env` y no instala ni registra tareas.

```powershell
# Sólo lectura; no abre DPAPI ni recupera la configuración cifrada.
& .\scripts\backup\owned-task.ps1 -Mode Status

# Para la futura ejecución autorizada, no ejecutada durante esta preparación:
& .\scripts\backup\owned-task.ps1 -Mode CatchUp
```

El preflight sólo informa identificador/fecha de la última copia con verificación registrada y enlazada, edad, estado y pendientes de recuperación. Exige `verificationVersion:2`, la huella exacta del recibo y su fecha confirmada contra el manifest cifrado; además valida los checksums locales de sus archivos. **No afirma una nueva autenticación AEAD sin abrir la llave**. `verification_attention` puede señalar intentos incompletos históricos conservados, un índice que apunta a una copia sin verificar o retención pendiente. No borra ni trata como válidos esos intentos. Las notas de verificación de copias ya retiradas se conservan sin contarlas como copias disponibles. Un resumen legado sin enlace no certifica frescura: se conserva para revisión y no se promueve automáticamente.

`CatchUp` no captura antes de las **20 horas** desde la última copia verificada. Repite esa decisión dentro del lease OS del paquete para evitar duplicados. Un reloj anterior a la fecha de la última copia falla de forma explícita. El lease existente de `createBackup` sigue protegiendo también el directorio de checkpoints. Un proceso vivo no se desaloja por edad; si otro tiene el lease, el lanzador informa `already_running` para que la siguiente ejecución reevalúe el estado.

Sólo cuando hace falta una captura, Windows abre `passphrase.dpapi` con DPAPI `CurrentUser`. La frase se pasa por el entorno del proceso hijo, nunca por argumentos o archivos de texto. El helper elimina esa variable al entrar y el lanzador la limpia en `finally`, además de poner a cero el buffer descifrado. Las cadenas administradas pueden permanecer en memoria hasta su recolección; esto no constituye una garantía de borrado físico de RAM. No se muestra salida de proveedor ni contenido de claves. La cuenta Windows debe ser la propietaria del paquete y conservar acceso a su perfil DPAPI.

`capture-owned.mjs` conserva la allowlist explícita del origen del titular y la confirmación `--capture-owner-production-read-only`. `--catch-up` agrega el mismo control de antigüedad para su uso directo. La captura usa `rotate:false`; después autentica **todos** los artefactos del nuevo paquete con AEAD, registra la verificación y recién entonces aplica la retención existente: una copia por cada uno de los últimos siete días representados y una por cada una de las últimas cuatro semanas representadas, preservando siempre la más reciente. Esto no genera copias de días en los que la computadora estuvo apagada. Si falla la autenticación, no rota. Si falla la retención, conserva la copia nueva autenticada y registra atención pendiente. Ningún resultado cambia los flags `platformConfigurationComplete:false`, `restorationProven:false` u `ownerCustodyPending:true`.

La retención propietaria sólo considera copias con ese enlace completo y lo vuelve a comprobar inmediatamente antes de borrarlas. Las copias legadas o desconocidas se conservan aunque excedan siete días/cuatro semanas. Alterar el recibo para cambiar una fecha o recomponer checksums después de corromper el cifrado invalida su verificación registrada.

El lanzador tiene un plazo total de 15 minutos por proceso hijo; PostgreSQL conserva su plazo más corto. Al vencerse termina únicamente su propio árbol de procesos y devuelve `timeout`. Códigos: `0` estado/captura correcta o aún no vencida; `10` lease ocupado; `11` reloj inválido; `12` configuración/ruta inválida; `20` captura incompleta; `21` timeout; `22` retención fallida. No se considera una recuperación integral probada que el proceso termine correctamente.

La futura programación debe dejar una oportunidad antes de 24 horas y ejecutar `CatchUp` al volver a estar disponible la máquina; un único horario diario puede superar ese plazo si el equipo estuvo apagado. **No hay todavía una tarea Windows ni automatización Codex creada.** Si se elige una automatización local de Codex, su ejecución depende de que el host y el mecanismo de automatización de la aplicación estén disponibles; debe verificarse esa condición al configurarla. Este script por sí solo no despierta la computadora ni ejecuta trabajo cuando está apagada. Una futura tarea Windows requerirá rutas estables al repositorio y Node, la cuenta propietaria, acceso al disco y conectividad al origen; no depende de que esta conversación permanezca abierta.

Verificación de este corte: `Status` real se ejecutó sólo en lectura sobre el paquete del titular. Las ocho pruebas nuevas de `backup-owned-task.test.mjs` usan productores sintéticos y criptografía/archivos/DPAPI/procesos locales reales: umbral de 20 horas, exclusión, corrupción AEAD con checksum público rehecho, retención posterior a autenticación, rutas, limpieza del entorno, salida categórica y timeout que mata sólo su árbol propio. La prueba del timeout acorta únicamente el plazo en una copia temporal del lanzador; el archivo versionado mantiene 15 minutos. `node --test tests/recovery/backup*.test.mjs`: **40 PASS y una prueba opcional PostgreSQL omitida**, cero fallos; lint focal pasó. No se ejecutó `CatchUp` real, captura de producción, proveedor de backup externo ni programación desde este corte. Evidencia en `.flow/backup-owned-task-tests.log` y `.flow/backup-owned-regression.log`.

La revisión independiente añadió seis pruebas y corrigió tres casos RED→GREEN de vinculación/retención. Resultado de ese tramo: `pnpm test:recovery`, **54 PASS y una prueba opcional PostgreSQL omitida**, lint focal PASS; `.flow/g1-independent-recovery.log`. Inicialmente el `Status` real devolvió `no_verified_checkpoint`, edad desconocida y `catchUpDue:true`: el checkpoint existente tenía un resumen legado sin enlace; no se había perdido ni borrado. Esa situación se resolvió mediante la verificación local explícita siguiente, sin capturarlo nuevamente.

### Verificar un checkpoint existente sin captura ni retención

```powershell
& .\scripts\backup\owned-task.ps1 -Mode VerifyExisting `
  -CheckpointId 'backup_20260908T180415096Z_87e87a78-12ec-47ee-9639-b1baff17fe2d'
```

`VerifyExisting` exige el identificador exacto de un checkpoint completo dentro del paquete privado; no acepta una ruta, un directorio incompleto ni traversal. Usa los leases OS del propietario y del directorio de checkpoints, compartidos con la captura. El launcher abre DPAPI en memoria; el helper no abre configuración recuperada ni importa el capturador remoto. Ejecuta `verifyBackup` completo, compara la huella del recibo antes/después y las fechas contra el manifest autenticado, vuelve a comprobar el inventario cifrado y sólo entonces reemplaza atómicamente la nota externa de verificación por su versión enlazada v2.

No modifica `receipt.json`, archivos cifrados ni `last-success.json`. No llama a captura, restauración, retención o proveedores; no escribe plaintext clínico en disco ni logs. La fecha `completedAt` procede del manifest original y determina la edad de 20 horas; `checkedAt` identifica solamente esta nueva revisión. Mantiene `platformConfigurationComplete:false`, `restorationProven:false` y `ownerCustodyPending:true`. Una corrupción, cambio de recibo, conflicto de lease o ruta inválida conserva la nota anterior y falla explícitamente.

Ejecución autorizada local del 8 de septiembre: se reautenticó únicamente `backup_20260908T180415096Z_87e87a78-12ec-47ee-9639-b1baff17fe2d`. **PASS AEAD completo**; las huellas de sus cinco archivos y del índice permanecieron iguales antes/después. `Status` volvió a mostrar **2026-09-08T18:06:52.805Z**, edad aproximada de 2,09 horas y `catchUpDue:false`. `verification_attention` sigue señalando intentos incompletos históricos conservados; no un fallo de la copia reautenticada. No se ejecutó `CatchUp`, captura, retención, red ni programación.

Las seis pruebas nuevas de `backup-verify-existing.test.mjs` cubren criptografía real sobre fixtures sintéticos, enlace legado, fechas, corrupción del último artefacto con checksum rehecho, mutación durante la verificación, rechazo de rutas, ambos leases, reintento y launcher/DPAPI sin llamar a captura. Suite completa `pnpm test:recovery`: **60 PASS, una prueba opcional PostgreSQL omitida**, cero fallos; lint focal PASS. Evidencia en `.flow/backup-verify-existing-green.log`, `.flow/backup-verify-existing-regression.log` y `.flow/backup-verify-existing-verification.json`.
