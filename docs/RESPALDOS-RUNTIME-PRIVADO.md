# Programa privado de respaldo preparado

Preparación local del 8 de septiembre de 2026. **No se creó una automatización, no se ejecutó captura nueva y no se modificó producción.** La programación sigue pendiente de integración por el propietario.

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

Una futura automatización de Codex dependerá de que la aplicación/equipo estén disponibles para ejecutarla. Este corte no registra tarea de Windows ni heartbeat, no afirma ejecución diaria activa y no cambia preferencias de notificación.
