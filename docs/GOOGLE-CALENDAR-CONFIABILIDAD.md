# Google Calendar: recuperación y alcance

Estado actualizado el 20/09/2026: M107 instalada en producción y código publicado; pruebas sintéticas aprobadas. La sincronización completa contra una cuenta Google controlada sigue sin acreditarse y el cron periódico `sync-google` todavía no está programado. El checkpoint vigente está en `docs/LAUNCH-BOARD.md`. Los apartados históricos de implementación se conservan abajo.

## Despliegue

M107 `20260908175852_M107_google_calendar_durability.sql` ya está instalada; no reaplicarla. Es aditiva: registra intenciones por referencia y no realiza llamadas al proveedor. No cambia el consentimiento de conexión. Antes de programar `/api/cron/sync-google`, completar un ensayo autorizado con datos de prueba y una cuenta/calendario controlados, revisar la cola existente y confirmar credenciales y monitoreo. No se puede usar una organización marcada `is_synthetic=true` para ese ensayo externo: el bloqueo intencional del proveedor debe conservarse. Mantener también el trabajo de renovación de canales.

Lectura productiva agregada del 20/09 a las 13:45:23 UTC: cuatro integraciones Google con token almacenado y un trabajo saliente pendiente; cero leased, terminal u ownership_review. No se leyeron valores de tokens, datos de pacientes, IDs de calendarios ni contenido de eventos. Un token almacenado no demuestra autorización todavía vigente. No se reclamó ni despachó ningún trabajo. La programación global podría ejecutar esa cola y requiere un paquete de activación revisado, no sólo añadir una línea a Vercel.

La reserva confirmada se guarda primero en Folio y crea una intención de salida a Google. Los eventos externos de Google se importan como bloqueos genéricos; editar o borrar en Google un evento creado por Folio no modifica hoy el turno Folio. La decisión de admitir gestión de turnos desde Google sigue pendiente; este estado no debe describirse como sincronización completa bidireccional.

La conexión humana mantiene nonce firmado, cookie de un uso, usuario/miembro vigente y MFA. El callback comprueba la persistencia antes de informar éxito y conserva el calendario seleccionado. Las organizaciones marcadas `is_synthetic=true` no pueden iniciar OAuth, intercambiar tokens, reclamar trabajos, renovar canales ni aplicar snapshots. Los trabajos de servicio sólo seleccionan organizaciones y miembros vigentes, con invitación aceptada o miembro histórico creado directamente. Revalidan ese permiso persistido inmediatamente antes de consultar al proveedor y, en salida, otra vez antes de modificar eventos; no heredan indefinidamente el permiso de un claim anterior. No exigen una sesión MFA humana a los trabajos automáticos sin actor. Los RPC de trabajo carecen de EXECUTE para `anon` y `authenticated`.

## Entrada

Cada snapshot abarca desde la medianoche local de hoy hasta la medianoche local dentro de 30 días. Usa `organization.timezone`, con Córdoba como valor predeterminado sólo si la columna no está definida. Una lectura fallida no autoriza el reemplazo.

Se recorren todas las páginas (incluidas páginas vacías intermedias). No se mezcla `syncToken` con una instantánea completa. Fallos, códigos 410, páginas repetidas, identificadores duplicados, fechas inválidas o límites agotados conservan los bloqueos existentes. También se valida la colección y su señal de página final: una respuesta vacía malformada no significa calendario vacío. Antes de segmentar, los eventos se recortan a la ventana actual, incluyendo ausencias iniciadas hace más de un año. El límite es 200 páginas y 50.000 segmentos; excederlo exige revisión, no truncado destructivo.

El RPC aplica alta/cambios/bajas en una sola transacción, revalida lease, calendario y zona horaria, y limita el alcance a organización/profesional/origen Google y ventana. Los títulos guardados son genéricos. Una notificación concurrente deja un marcador persistido que obliga a repetir después del trabajo en curso. El selector omite leases vigentes y cuentas desactivadas; éxitos incluso sin cambios avanzan la próxima revisión.

## Salida

Un trigger guarda la intención dentro de la transacción que modifica el turno. La cola sólo guarda referencias, calendario, ID estable, versión deseada, estado, lease, intentos y error de catálogo. No copia contenido clínico ni contacto. El worker vuelve a leer las fuentes autorizadas y sólo envía “Turno reservado”, horario y zona horaria: sin nombre del paciente, motivo, correo, dirección ni asistentes.

Antes de crear consulta el ID persistido. Si una creación fue aceptada pero su respuesta se perdió, el próximo intento encuentra el mismo evento. Las actualizaciones utilizan el ETag leído y un marcador privado de propiedad. Un ETag ausente impide escribir; no se degrada a una modificación sin comparación. Un evento ajeno o histórico sin propiedad demostrable queda en `ownership_review`; nunca se modifica ni se elimina por suposición. Los cambios concurrentes incrementan la versión y no se pierden al finalizar una versión anterior. Cambiar de calendario conserva el calendario anterior del usuario; las nuevas intenciones quedan limitadas al calendario seleccionado.

Las peticiones tienen timeout/cancelación de 15 segundos; las ejecuciones completas tienen presupuesto de 40–45 segundos y leases de 90 segundos. Un fallo de red conserva una intención recuperable. `invalid_grant` exige reconexión. No se reintenta automáticamente la creación con identificadores aleatorios.

## Notificaciones y límites

El webhook verifica canal, recurso, secreto persistido y vencimiento finito futuro. Los canales históricos sin secreto se sustituyen en la renovación. La renovación crea primero, persiste mediante comparación del canal previo y recién entonces intenta cerrar el anterior. Si la aceptación o persistencia del nuevo canal resulta incierta, el anterior se conserva. Puede quedar un canal adicional hasta su vencimiento; los leases y snapshots idempotentes evitan efectos duplicados sobre la agenda. No se promete entrega de webhooks: el cron periódico es el mecanismo de recuperación.

El primer despliegue requiere revisar las filas `ownership_review` históricas. No se borran ni se reescriben eventos Google antiguos, incluyendo cualquier contenido que versiones anteriores hayan enviado. La eliminación de ese contenido es un trabajo separado y autorizado. La confiabilidad con permisos, revocaciones y cuotas reales del proveedor sigue pendiente del smoke sintético externo autorizado.

## Evidencia

Pruebas de los orquestadores reales con I/O sintético: paginación, respuesta incompleta, aborto, creación aceptada con timeout, propiedad ajena, versión reemplazada, secreto del webhook y renovación con persistencia incierta. Prueba SQL en PostgreSQL 16 real: intención transaccional, leases, revisión concurrente, rollback de snapshot inválido, calendario incorrecto, rechazo NULL, selección de cuentas vigentes, CAS del watch y privilegios.

Referencias primarias: [events.list y paginación](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [sincronización y vencimiento de tokens](https://developers.google.com/workspace/calendar/api/guides/sync), [IDs provistos al crear eventos](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert).


### Revisión independiente E2 (2026-09-08)

Se reprodujeron RED y corrigieron: trabajos externos para organizaciones
sintéticas, conservación de autoridad después de revocar el miembro, actualización
sin ETag, fecha all-day inexistente, ausencia larga truncada antes de la ventana,
y respuesta sin colección aceptada como calendario vacío. El callback ahora
rechaza la organización sintética, la invitación sin aceptar, el error de consulta
y la falta de MFA antes del intercambio; el inicio OAuth también consulta el
estado sintético actual.

`M107_google_scope_guard.spec.sql` prueba en PostgreSQL real la exclusión
sintética, revocación posterior al claim, lease ajeno/vencido y grants exclusivos
de servicio. Los tests de orquestadores usan I/O sintético; ningún token real ni
petición a una cuenta Google fue utilizado. Una revocación no puede deshacer una
petición ya aceptada por Google: se comprueba antes de I/O y los trabajos
posteriores se bloquean. La desconexión/reconexión no sustituye una revisión de
los eventos históricos o de propiedad incierta.

Referencia adicional: [comparación de versiones y ETags](https://developers.google.com/workspace/calendar/api/guides/version-resources).
