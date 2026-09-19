# Diagnóstico y actualización del respaldo — 12 de septiembre

Esta entrega mejora cómo Folio informa una copia fallida. No establece la causa de los intentos anteriores: el 12 de septiembre la captura manual con el paquete instalado terminó correctamente y el programador confirmó luego `not_due`. No se deben borrar las carpetas incompletas para hacer desaparecer esa evidencia.

## Comportamiento comprobado con datos sintéticos

- Un fallo al conectar, exportar el snapshot, consultar inventario o verificar la consistencia conserva una etapa y categoría de una lista cerrada. Los detalles del controlador solo se envían al destino que los cifra; nunca se adjuntan como `cause`, mensaje o propiedad de la excepción pública.
- También se recoge una desconexión fuera de una consulta. Las conexiones fallidas pasan por el cierre con tiempo límite. Los procesos de PostgreSQL mantienen el mismo límite y la regla de que una advertencia no produce una copia válida.
- La copia verificada más reciente conserva su fecha cuando un intento nuevo falla. `ageHours`, `catchUpDue` y `stale24h` se calculan sobre esa copia, no sobre la última ejecución. El umbral de antigüedad es estrictamente mayor de 24 horas; el intento de recuperación se decide desde las 20 horas.
- Los dos procesos de PowerShell descartan salida arbitraria, campos adicionales, diagnósticos no permitidos e identidades anidadas inválidas. PowerShell 5.1 y 7 normalizan las fechas de forma compatible. Un fallo del lanzador conserva el último punto registrado y recalcula su antigüedad.
- `platformConfigurationComplete=false`, `restorationProven=false` y `ownerCustodyPending=true` permanecen explícitos. Capturar y autenticar archivos no acredita inicio de sesión ni una restauración alojada completa.

## Preparar el reemplazo inmutable

1. Revisar y comprobar estos cambios antes de copiar código a la carpeta privada. Usar un nombre nuevo `backup-runtime-<fecha>-v2`; no modificar ni reutilizar `backup-runtime-20260908T202842Z`.
2. Ejecutar `package-owned-runtime.mjs stage` con ese destino. Incluye ahora `owned-status.ps1`; conserva Node privado, la versión fijada de `pg` y su cierre de dependencias.
3. Instalar las dependencias bloqueadas sin scripts, resolución nueva ni enlaces simbólicos; sellar con `package-owned-runtime.mjs seal`. Registrar los SHA-256 del manifiesto y del lanzador devueltos.
4. Ejecutar `verify` con el SHA del manifiesto y el lanzador nuevo en `-Mode Status`. Esta comprobación no descifra claves ni contacta proveedores. Revisar que identifique la copia autenticada esperada y su antigüedad.
5. Ejecutar `install-windows-task.ps1 -Mode Plan -CandidateRuntime <directorio> -CandidateLauncherSha256 <SHA revisado>`. El modo Plan no instala ni actualiza tareas.

## Actualización explícita y reversible

El instalador conserva su rechazo a sobrescribir una tarea mediante `Install`. El nuevo modo `Update` exige el directorio candidato, el SHA del lanzador revisado y `ExpectedDefinitionSha256`, obtenido con `Inspect` inmediatamente antes.

La actualización rechaza cambios de definición, otra identidad, credenciales guardadas, privilegios elevados, una tarea distinta o una ejecución en curso. Antes de modificarla guarda una copia exclusiva del XML anterior en la carpeta privada y vuelve a comprobar la huella. Cambia únicamente la acción y la descripción; conserva el horario, los disparadores, los límites y la identidad de Windows. No inicia una captura.

Después de actualizar: comprobar `Inspect`, ejecutar la tarea una vez cuando no haya captura activa y verificar su código de salida y `scheduled-backup-last-status.json`. Si la copia es reciente debe informar `not_due`. Si falla, conservar ambos paquetes y las definiciones; restaurar la acción de la definición anterior mediante una actualización revisada, sin eliminar respaldos ni históricos.

La instalación real está registrada al final de este documento. Las pruebas sintéticas por sí solas no acreditan instalación ni restauración.

## Aviso de Windows por copia pendiente — v3

El candidato siguiente añade un aviso a la tarea del propietario. Después de comprobar o intentar el respaldo, vuelve a calcular la antigüedad de la última copia verificada. Si supera 24 horas o no existe ninguna, solicita a Windows un aviso con texto fijo en español. No contiene pacientes, correos, rutas, claves ni errores del proveedor. Una fecha futura o un reloj inválido se registra como `notice_unavailable` / `clock_invalid`, sin presentar la copia como reciente ni mostrar un aviso de antigüedad falsa.

El aviso usa el área de notificaciones de Windows, sin abrir una ventana ni dejar un programa residente. El procesamiento del icono dura como máximo ocho segundos y lo libera al salir. Windows decide cómo presenta estas notificaciones; el tiempo pedido a la API no garantiza cuánto las muestra. [Documentación de Microsoft](https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.notifyicon.showballoontip?view=netframework-4.8.1).

Solo puede avisar cuando esta PC está encendida y la sesión del propietario está disponible. Si está apagada, la tarea podrá comprobar y avisar cuando vuelva a estar disponible. No molestar, las preferencias de Windows o la ausencia de una sesión visible pueden ocultar el aviso. No se envían correos ni avisos remotos y no se promete una alerta durante el apagado. `notice_requested` significa que se solicitó el aviso; `userSeen=false` permanece siempre, porque no se puede afirmar que lo hayas visto.

`scheduled-backup-notification.json`, dentro de la carpeta privada existente, guarda únicamente la fecha de la última solicitud. Evita repetirla durante 24 horas y usa un bloqueo exclusivo para impedir solicitudes simultáneas. Un fallo al notificar queda como `notice_unavailable` y conserva el resultado del respaldo. La siguiente comprobación puede reintentarlo. Una copia reciente produce `not_needed`; no muestra aviso de recuperación.

Para activar esta entrega, preparar y sellar **otro** paquete `backup-runtime-<fecha>-v3`, que también incluye `owned-notice.ps1`. Conservar los paquetes v1 y v2 ya existentes. Repetir la revisión de hash, `Plan`, `Inspect` y `Update` descrita antes. Las funciones del aviso quedan incluidas en la definición revisada de la tarea; no se cargan desde el repositorio al ejecutarse. El instalador comprueba que el comando respete el límite de Windows y mantiene disparadores, identidad y configuración anteriores. `Plan` informa `notificationPlanned=true` y `notificationConfigured=false`; solo una instalación o actualización exitosa informa configuración aplicada. Eso tampoco verifica visualización o lectura del aviso.

Las pruebas sustituyen únicamente la llamada final a Windows por un adaptador sintético; nunca muestran un aviso real. Comprueban antigüedad real frente a campos contradictorios, ausencia de copia, deduplicación, reintento, reloj inválido, bloqueo, rutas inválidas y salida hostil. La tarea completa conserva el aviso pendiente incluso si el lanzador está alterado o el proceso hijo devuelve metadatos inválidos. Si la copia real sigue reciente al probar la tarea actualizada, el resultado esperado es `not_needed`, sin notificación visible.

## Instalación real comprobada el 12 de septiembre

La captura `backup_20260912T161810256Z_54e938a4-043e-49d5-b007-664faf4cf0d1` terminó a las 16:20:50.194 UTC y se autenticó a las 16:20:50.243 UTC. Incluye un volcado de 1.769.058 bytes antes de cifrar, roles y configuración; se comprobó de forma independiente que Storage tenía cero objetos. Se conservaron las dos copias válidas y los intentos incompletos anteriores. La verificación no acredita restauración integral.

La actualización v2 quedó comprobada a las 16:40 UTC y tuvo además una ejecución automática exitosa a las 16:57 UTC. Después se instaló el paquete nuevo `backup-runtime-20260912T1700-v3`, conservando v1, v2 y ambas definiciones XML anteriores. El paquete v3 contiene 165 archivos comprobados y dependencias bloqueadas instaladas sin red ni scripts.

| Evidencia v3 | SHA-256 |
|---|---|
| Manifiesto | `79e865fb43afa41143171af137f00dea3b60dfde183b17b89378e383ad3f1464` |
| Lanzador | `a703abbaf84e34b5b6ae8406a15052beea55e52bda6afb95365ec12fa300ca86` |
| Definición de tarea instalada | `2cbe1c48db49d480ad6be5fa949d0c611ec5fb8e1de215f48f1a195e7e0174c3` |

La ejecución real de v3 comenzó a las 17:00:39 UTC y registró a las 17:00:43.678 UTC `exitCode=0`, `action=not_due`, `stale24h=false` y `notification.status=not_needed`. No mostró una notificación innecesaria. `verification_attention` conserva el aviso sobre las carpetas incompletas antiguas; no invalida la copia nueva. El siguiente horario se conservó a las 17:57:10 UTC, con inicio de sesión adicional, cuenta propietaria sin elevación ni contraseña guardada y límite de 20 minutos.

Las pruebas de recuperación aprobaron 81 casos y omitieron uno que requiere un ensayo integral habilitado explícitamente. La frase externa, el disco y la restauración con Auth/Storage real siguen pendientes.
