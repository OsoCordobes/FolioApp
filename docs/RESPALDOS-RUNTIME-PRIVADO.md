# Programa privado de respaldo y tarea de Windows

Estado verificado el 8 de septiembre de 2026 a las 21:54 UTC: **tarea de Windows registrada y primera ejecución comprobada**. El programa puede funcionar con Codex cerrado. La ejecución comprobada respondió `not_due`: la copia válida tenía menos de cuatro horas, por lo que no realizó una captura nueva ni modificó producción. No equivale todavía a un ciclo diario vencido ni a una restauración integral.

La copia seleccionada está en:

`C:\Users\amiun\folio-recovery\initial-20260908-182017\backup-runtime-20260908T202842Z`

Su entrada es `invoke-owned-backup.ps1`, con modos `Status` y `CatchUp`. La entrada verifica un manifiesto SHA256 fijado en su código antes de invocar cualquier programa. Comprueba todos los archivos y rechaza enlaces, archivos inesperados o modificados. Fija el Node privado y los módulos incluidos con el host de PowerShell, sin depender del PATH de Codex o del repositorio. El manifiesto excluye su propia entrada para evitar un hash recursivo; la huella de esa entrada se registra aparte para revisión/custodia. No es una firma contra un propietario que pueda modificar toda la carpeta.

- Node **22.16.0**, copia del ejecutable local instalado, en `bin/node.exe`.
- `pg` **8.21.0** y 14 paquetes totales, instalados desde caché con `--offline --ignore-scripts --frozen-lockfile`, archivos copiados y estructura hoisted. No hubo descargas. `pnpm-lock.yaml` conserva sólo el cierre de dependencias de pg y las integridades del lock revisado del repositorio.
- 18 archivos fuente de respaldo y sobre de recuperación; 163 archivos registrados en el manifiesto. No se copiaron secretos, `.env`, claves ni datos clínicos al runtime ni al repositorio.
- ACL de cada archivo/directorio comprobada: hereda exclusivamente `LAUTARO\amiun` desde el paquete privado.
- Manifiesto: `c544c514b90259d4ce3e87416dfd13d727836890282288ca2cf95e7b37d8f157`.
- Entrada: `72af22c9e67a29c1bbf55de80b11cbb754dcd5e3166aa0b20f63a084eef0f4e2`.

`Status` real y `CatchUp` real **sin vencimiento** pasaron sobre esta copia. Antes de invocar CatchUp se comprobó `catchUpDue:false` y antigüedad inferior a 19 h; tenía 2,36 h. Respondió `action:not_due`, por lo que no abrió DPAPI ni contactó proveedores. Las huellas de todos los archivos bajo `database-checkpoints` quedaron iguales. La fecha válida sigue siendo **2026-09-08T18:06:52.805Z**, no la hora de empaquetado. El estado sigue `verification_attention` por material histórico pendiente; configuración parcial, restauración no demostrada y custodia pendiente se conservan.

El capturador sigue leyendo su configuración cifrada del paquete propietario autorizado y usa las herramientas PostgreSQL 17 y el certificado CA previamente instalados fuera del runtime. Empaquetar Node/pg no hace portable DPAPI a otra cuenta ni convierte la restauración en demostrada. Una actualización del capturador requiere otra carpeta versionada y una nueva revisión; no se sobrescribe una copia existente.

`scripts/backup/package-owned-runtime.mjs` reproduce las fases `stage`, instalación offline, `seal` y `verify`. Los intentos `backup-runtime-20260908T202442Z` y `backup-runtime-20260908T202538Z` quedaron incompletos por falta de metadata de caché/ajuste del lock; la copia `backup-runtime-20260908T202607Z` fue superada por la corrección de búsqueda de módulos de PowerShell. Se conservaron todos; **ninguno es el destino de programación seleccionado**.

Pruebas sintéticas: rutas fuera del paquete, sobrescritura rechazada, pin/dependencias, manifiesto/archivos modificados, archivo adicional y launcher Windows real con entrada sintética. Esta última reprodujo un fallo de comandos al heredar PSModulePath de otro host y pasó tras fijar los módulos propios. Evidencia en `.flow/backup-owned-runtime-green.log`, `.flow/backup-runtime-regression.log`, `.flow/backup-runtime-manifest-evidence.json` y `.flow/backup-runtime-validation.json`.

## Programación instalada

`scripts/backup/install-windows-task.ps1` tiene modos `Plan` e `Inspect` de sólo lectura y `Install` explícito. Comprueba el hash de la entrada y ACL del propietario; nunca sustituye una tarea existente. La tarea se llama **Folio - respaldo cifrado**. Su definición exportada y recibo de validación están en el paquete privado como `scheduled-backup-definition.xml` y `scheduled-backup-validation.json`.

- Windows la intenta cada hora y al iniciar sesión. El programa captura sólo si pasaron 20 horas desde la última copia válida; conserva la retención de siete diarias y cuatro semanales después de verificar el cifrado.
- `StartWhenAvailable` recupera intentos omitidos. No despierta el equipo. Usa el usuario actual con privilegios normales y sin guardar una contraseña adicional. Requiere que su sesión de Windows siga iniciada; puede estar bloqueada. Cerrar sesión, apagar o suspender la PC retrasa el respaldo.
- `IgnoreNew` y el bloqueo existente evitan ejecuciones simultáneas. El límite exterior es de 20 minutos y el capturador tiene su límite propio de 15 minutos.
- La tarea verifica otra vez el hash antes de ejecutar el programa privado. No lee código del checkout ni requiere Codex, sus cuotas o una conexión a un modelo.
- El último resultado categórico se guarda en `scheduled-backup-last-status.json`, sin secretos ni contenido clínico. Un fallo de integridad o JSON inválido reemplaza un éxito anterior por un fallo fechado, si el destino sigue siendo seguro. El resultado de Windows también debe consultarse: una terminación forzada puede impedir actualizar el archivo.

La prueba inició **la tarea registrada**, no solamente el script: terminó con resultado Windows `0`, estado `Ready`, acción `not_due` a las 21:53:39 UTC, y los 15 archivos existentes de respaldo conservaron sus hashes. Tres pruebas sintéticas ejecutan el comando Windows real y cubren `not_due`, propagación de fallo, programa alterado y salida inválida. La revisión independiente detectó el riesgo de conservar un estado exitoso antiguo y se corrigió antes de instalar.

**Pendiente:** comprobar una captura vencida y un ciclo tras apagado; activar aviso por antigüedad superior a 24 horas desde un observador disponible; transferencia al disco y custodia externa; completar configuración y restaurar Auth/Storage reales. No se ha configurado todavía el aviso de respaldo vencido. Folio sigue alojado en Vercel/Supabase y funciona con esta PC apagada.

Se registró aparte el recordatorio semanal de Codex **Copia semanal de Folio al disco**, ID `copia-semanal-de-folio-al-disco`, activo los domingos a las 15:00 según la zona local de la aplicación. Sólo recuerda la transferencia y la custodia separada; no ejecuta capturas, no certifica la transferencia y depende de la disponibilidad de Codex. Es independiente de la tarea Windows que hace las copias.
