# Permisos al confirmar reservas y recuperar sus comprobantes

La revisión de M110 encontró que una llamada directa podía confirmar una reserva en la agenda de un colega, incorporar un paciente no asignado o recuperar identificadores clínicos después de perder acceso. La pantalla no era una defensa suficiente: el procedimiento de base ejecutaba esas operaciones con privilegios elevados.

Se reprodujeron las variantes con PostgreSQL local y datos sintéticos. Cada intento exitoso de la reproducción se revirtió inmediatamente; las pruebas completas también revierten sus pacientes, cuentas y turnos. No se consultaron pacientes ni proveedores reales.

## Comportamiento corregido

- OWNER y DIRECTOR conservan la gestión de agendas. PROFESIONAL puede confirmar en su propia agenda; `alcance=TODOS` no le concede la de un colega. ASISTENTE y COORDINADOR utilizan su lista o equipo autorizado.
- Para confirmar un pedido todavía pendiente, se comprueba tanto su agenda de origen como la de destino. Cambiar el destino enviado por el navegador no permite apropiarse de una reserva ajena. Un pedido sin profesional asignado puede asignarse a un destino autorizado.
- Los pacientes existentes requieren ficha e identidad vigentes y acceso a la caja fuerte. Un profesional necesita asignación principal o una atención previa que ya le conceda acceso según M32; crear el nuevo turno no puede utilizarse para obtener ese permiso.
- Un recibo de conversión se recupera comprobando el turno guardado y su profesional actual, la ficha, la identidad, la caja fuerte y los permisos actuales del solicitante. La organización, el integrante y el profesional deben seguir vigentes y aceptados. El navegador no decide qué agenda se consulta durante esa recuperación.
- Se conserva el mismo paciente, turno y comprobante al reintentar. No se insertan recordatorios ni avisos adicionales. Si un pedido ya convertido se reenvía con otro profesional, servicio u horario, la base devuelve un conflicto; una reprogramación se realiza por su flujo específico.

## Reserva pública y tareas de servicio

El comprobante público contiene exclusivamente `id` del pedido y `autoConfirmado`, que describe el resultado original de la solicitud. No es una lectura de la historia clínica ni una consulta del estado actual de la cita. Requiere la misma operación, el mismo resumen de datos calculado por el servidor y un consultorio que siga publicado y activo. Conservar ese comprobante después de cambiar una ficha privada no concede identificadores de paciente o turno.

La vía de servicio que sí recupera identificadores clínicos comprueba su vigencia y únicamente admite conversiones automáticas pertenecientes a su solicitud pública. No puede adoptar un pedido interno ni una reserva pública que un profesional resolvió manualmente. Desactivar la confirmación automática para futuras reservas no invalida una conversión automática ya realizada.

Las cinco funciones expuestas conservan sus nombres, argumentos y resultados. Ahora son funciones de invocador que llaman a una implementación privada con permisos explícitos. Solo `promote_pedido_atomic` acepta personal autenticado; el comprobante público, el alta pública y el trabajador de avisos requieren el rol de servicio. Los controles del rol original también impiden que una función privilegiada invocada accidentalmente por un usuario se convierta en una entrada a esas tareas.

Se siguieron las recomendaciones oficiales sobre [funciones y permisos de Supabase](https://supabase.com/docs/guides/database/functions) y [bloqueos de filas de PostgreSQL](https://www.postgresql.org/docs/16/explicit-locking.html). Las comprobaciones y las escrituras ocurren dentro de la misma transacción, con bloqueos sobre la organización, integrantes, pedido, turno y ficha pertinentes.

## Pruebas y despliegue

- `M110_booking_atomic.spec.sql`: conversión atómica, reintento, reversión completa ante fallo, reservas públicas y trabajador de avisos.
- `M110_booking_authority.spec.sql`: roles, agendas de origen/destino, asignación de pacientes, revocaciones y recibos sin efectos adicionales.
- `M110_public_authority.spec.sql`: comprobante público mínimo, continuidad del resultado original, prohibición de adoptar conversiones manuales, barreras del servicio y permisos de las funciones expuestas.
- Las 21 pruebas unitarias de conversión, reservas y avisos también aprobaron. No fue necesario cambiar contratos TypeScript.

La reproducción completa previa a integrar M119 aprobó 112 migraciones y 59 archivos de pruebas SQL en una base nueva, con comprobación de cuerpos de funciones por defecto y una transacción por migración. La revisión final de integración debe incluir además M119 y la regresión de atomicidad del registro de M118.

M110 seguía pendiente de su primera aplicación cuando se corrigió este archivo. Se retiraron solamente sus fronteras externas `BEGIN/COMMIT`: la herramienta de migración debe controlar la transacción junto con el registro de versión. Un ensayo manual usa `psql --single-transaction`; no se debe aplicar por fragmentos ni cerrar la transacción antes del registro de la migración.

Los permisos se verifican en PostgreSQL con roles y tablas auxiliares locales de Auth/Storage. Estas pruebas no sustituyen la validación alojada de sesiones reales o la entrega efectiva de un correo. El control comercial de nuevas operaciones con suscripciones vencidas continúa siendo un trabajo separado.
