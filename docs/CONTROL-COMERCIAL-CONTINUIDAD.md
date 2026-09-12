# Control comercial sin interrumpir la atención

Propuesta del 12 de septiembre de 2026 sobre `codex/market-ready`, con M117 y M118 presentes en el árbol de trabajo. **Diseño pendiente de implementación y activación.** Esta revisión sólo leyó código; no consultó producción, no modificó datos y no reprodujo estos casos con Supabase real. No se inició Docker ni se intentó eludir el rechazo previo de su arranque.

Actualización posterior de la misma entrega: la [reprogramación transaccional M119](REPROGRAMACION-ATOMICA.md) se implementó y probó localmente, sin activar el control comercial. El diagnóstico y las líneas del flujo anterior que siguen abajo corresponden al código leído antes de esa corrección; su evidencia actual y sus límites están en el documento específico.

## Decisión propuesta

Separar el permiso para **iniciar nuevas operaciones** del permiso para **consultar información o terminar una atención iniciada**. Conservar el archivo clínico, las entregas autorizadas, la recuperación de pagos y las enmiendas. Bloquear nuevas altas de pacientes, reservas, turnos, importaciones y conexiones comerciales cuando la misma regla de facturación vigente deniegue el acceso.

No activar un bloqueo general en esta entrega. Antes deben quedar verificadas la sustitución transaccional de turnos, el alta separada de pacientes y una ruta de continuidad para la atención en curso. M119 se utilizó para corregir la reprogramación: asignar la siguiente versión libre al coordinar la política comercial.

## Lo confirmado por código

| Punto | Evidencia y consecuencia |
|---|---|
| Identidad y permisos no son suscripción | [`getActiveSession`](../lib/db/session.ts#L53) comprueba sesión, MFA y membresía. No decide si se admite una operación comercial. |
| El bloqueo actual es principalmente de navegación | [`AppShellLayout`](../app/(app)/layout.tsx#L87) redirige a facturación. Una acción invocada directamente no queda protegida por ese layout. |
| La lectura tiene una excepción intencional | [`getActiveContext`](../lib/db/active-context.ts#L233) permite acceso si falla la consulta de suscripción, para no esconder la ficha durante la consulta. Reutilizar ese resultado para autorizar altas nuevas sería incorrecto. |
| M118 protege la autoridad de facturación | [`M118`](../supabase/migrations/20260912163934_M118_billing_authority.sql#L7) impide al usuario común escribir `suscripcion` o extender la prueba cambiando `organization.created_at`. No bloquea altas ni reservas en otras tablas. |
| Existe consulta fuera del bloqueo comercial | [`/archivo-clinico`](ARCHIVO-CLINICO-CONTINUIDAD.md) ofrece directorio y entregas autorizadas. Es de lectura; no permite terminar una atención pendiente. |

### Regla que SQL y servidor deben compartir

La fuente actual es [`computeAccessGate`](../lib/db/suscripcion.ts#L657), con 30 días definidos en la línea 121. Debe conservarse esta semántica, salvo una decisión comercial explícita posterior:

1. Organización interna: permite operaciones, manteniendo todos los permisos clínicos. `is_synthetic` por sí solo **no** equivale a acceso comercial; sigue bloqueando proveedores externos.
2. `ACTIVA`: permite, incluso si `proxima_cobro` es nula o pasada.
3. `MOROSA` o `CANCELADA`, con `proxima_cobro` estrictamente posterior al instante de evaluación: permite completar el período pagado.
4. `PAUSADA`: deniega siempre, incluso dentro de la prueba o con una fecha de cobro futura.
5. Los restantes casos permiten mientras no hayan transcurrido 30 × 24 horas desde `organization.created_at`.
6. Al vencer ese plazo: `CANCELADA` produce `subscription_cancelled`; `MOROSA`, `subscription_morosa_expired`; el resto, `grace_expired`.

Hay una sutileza: el comentario del código describe el punto 5 como pendiente/sin suscripción, pero la implementación también deja pasar a `MOROSA` y `CANCELADA` durante la prueba original cuando su fecha de cobro ya venció o es nula. Copiar sólo el comentario cambiaría el producto. Los tests actuales en [`access-gate.test.ts`](../tests/unit/access-gate.test.ts#L30) no cubren toda esa matriz ni todos los límites exactos.

La evaluación SQL debe recibir un instante explícito internamente, usar 720 horas exactas y comparación estricta `>`, y contrastarse con la función TypeScript sobre los mismos casos. No aceptar desde el navegador el instante, el inicio de prueba ni un booleano de acceso. La organización ausente/eliminada y los errores de consulta deniegan una operación nueva; nunca se convierten en una prueba gratuita nueva.

## Superficies que debe cubrir la guarda

| Flujo | Entrada y escritura real | Comportamiento propuesto |
|---|---|---|
| Walk-in y turno manual | [`createManualTurno`](../lib/db/manual-turno.ts#L19) → [`M117 create_visit`](../supabase/migrations/20260912161705_M117_manual_turno_atomic.sql#L20), inserta identidad, paciente y turno en una transacción | Autorizar después de consultar el recibo existente y antes del primer INSERT. Un reintento confirmado conserva su respuesta con los permisos actuales. |
| Alta desde Pacientes | [`createPaciente`](../lib/db/pacientes.ts#L275), INSERT de identidad en 327 y paciente en 367 | Prevalidar y trasladar ambos INSERT a un RPC transaccional con recibo. Hoy son dos solicitudes independientes y la compensación DELETE de la línea 380 no comprueba su resultado. |
| Turno por rutas anteriores | [`createTurno`](../lib/db/turnos.ts#L322), INSERT en 357 | Aplicar la misma regla; no depender sólo del modal ni de M117. |
| Reprogramación | [`reagendarTurno`](../lib/db/turnos.ts#L663), transición en 729 y creación posterior en 742 | Sustitución transaccional obligatoria antes de activar una guarda de INSERT. Ver sección siguiente. |
| Solicitudes del consultorio | [`createPedido`](../lib/db/pedidos.ts#L170); aceptación en 335 y 494 → [`promote_pedido_atomic`](../supabase/migrations/20260908184053_M110_booking_atomic.sql#L45) | Bloquear alta y conversión nueva. Mantener lectura, rechazo y consulta de una conversión ya confirmada. |
| Reserva pública | [`submit_public_booking`](../supabase/migrations/20260908184053_M110_booking_atomic.sql#L128), rol de servicio, INSERT de `pedido` y posible promoción | Autorizar tras recuperar un recibo previo (135), antes de escribir. Dejar accesible `public_booking_receipt`. Mostrar disponibilidad suspendida sin revelar deuda, estado o monto. |
| Portal | [`solicitarReagendaPortal`](../lib/db/portal-turnos.ts#L785), [`solicitarTurnoPortal`](../lib/db/portal-turnos.ts#L876), INSERT directo en 1056 | Bloquear solicitudes nuevas. Conservar [`cancelarTurnoPortal`](../lib/db/portal-turnos.ts#L379) y lecturas autorizadas. Solicitar otro horario tampoco debe cancelar anticipadamente el turno vigente. |
| Importación | [`M112`](../supabase/migrations/20260908190255_M112_patient_import_durability.sql#L35): `begin_patient_import`, `import_patient_row`, recibos privados | Bloquear un lote nuevo y filas nuevas; conservar `patient_import_status` y repetición de filas ya confirmadas. Una suspensión debe dejar la fila pendiente, no grabar `row_failed` definitivo. |
| WhatsApp | [`webhook`](../app/api/whatsapp/webhook/route.ts#L128), INSERT de `pedido` con rol de servicio | La DB también debe bloquearlo. Antes de ofrecerlo, definir rechazo durable del evento sin PHI ni bucle de reintentos. Hoy registra el error y continúa; no equivale a una recepción durable. |
| Nueva integración Google | [`callback OAuth`](../app/api/google/callback/route.ts#L134), intercambio externo y UPSERT de `integration` | Prevalidar antes de intercambiar el código y volver a validar en la escritura. Distinguir conexión/reconexión voluntaria de renovación del token de una conexión existente. |
| Inicio de atención | [`transitionTurno`](../lib/db/turnos.ts#L443) y [`save_clinical_session`](../supabase/migrations/20260908175754_M106_session_atomic_revision.sql#L83) | Un SAVE puede pasar por EN_SALA e iniciar ATENDIENDO (182–183). No basta con prohibir nuevos turnos: también hay que controlar ese inicio y preservar guardado/cierre de la atención ya iniciada. |

La tabla `paciente_claim`, el RPC `resolver_paciente_claim` y [`portal_link_verified_patient`](../supabase/migrations/20260908162341_M98_security_boundaries.sql#L63) vinculan una identidad verificada con una historia existente. **No clasificarlos automáticamente como adquisición comercial.** Mantener la solicitud/revisión/revocación necesaria para entregar información, con sus controles actuales de identidad y representación. Una reserva posterior sí pasa por el control comercial. Lo mismo aplica a representación y consentimiento vinculados a una atención que se está terminando.

## Reprogramación: fallo confirmado en la estructura, todavía no reproducido

La secuencia de [`reagendarTurno`](../lib/db/turnos.ts#L726) es:

1. `transitionTurno(... REAGENDADO)` confirma un UPDATE del turno anterior.
2. `onTransitioned` refresca su estado y ya se han iniciado los efectos de cancelación correspondientes.
3. `createTurno` intenta crear el reemplazo en otra solicitud.
4. Si falla, la línea 758 devuelve un error que reconoce que el original quedó reagendado y pide crear otro turno manualmente.

Por tanto, una futura guarda que rechace únicamente el INSERT puede conservar el paso 1 y rechazar el 3. Un chequeo de suscripción al principio mejora el mensaje, pero no elimina el fallo si cambia la suscripción, gana otra reserva el horario, se pierde la conexión o falla la segunda escritura. Esta conclusión surge del código y su manejo explícito del error; **no se ejecutó una reproducción con datos reales ni sintéticos en Postgres** durante esta revisión.

Corrección siguiente acotada: RPC `reschedule_turno_atomic` y recibo privado con organización, autor, operación, turno original, versión/intención y turno reemplazante. Dentro de una sola transacción:

1. Revalidar Auth/MFA, organización, profesional, paciente y alcance; recuperar un recibo previo sin exigir una suscripción nueva.
2. Serializar la operación y el horario con un orden de locks documentado, compatible con el namespace `booking-slot` de M110/M117. Bloquear y revalidar el original; verificar estado permitido y que nadie lo haya cambiado.
3. Autorizar la operación comercial y verificar servicio, duración y horario. El EXCLUDE sigue siendo la última defensa frente a solapamientos.
4. Cambiar el anterior a REAGENDADO e insertar el reemplazo; guardar modalidad, nota de reserva y demás campos contractuales. El orden permite liberar su propio horario dentro de la misma transacción; cualquier fallo revierte ambas escrituras.
5. Persistir cancelación de recordatorios anteriores, trabajos del nuevo turno y recibo. Las llamadas a proveedores quedan fuera de la transacción y sólo procesan trabajos confirmados.

La acción de servidor realiza un único llamado. La UI conserva operación y formulario ante resultado incierto y consulta el recibo; no sugiere crear otro turno a ciegas. No se agrega un rollback remoto que intente reabrir un turno terminal después de haber confirmado la primera mitad.

## Diseño mínimo de base y servidor

Proponer una migración nueva aditiva, sin editar M98/M106/M110/M112/M117/M118 aplicadas. Crear un esquema privado de política comercial con estado inicialmente **no activado**, historial de activación y decisión SQL compartida. El estado debe aparecer como pendiente en la preparación de lanzamiento; no convertirlo en un éxito de pruebas.

La decisión interna lee organización y suscripción de forma privilegiada, sin devolver datos financieros al usuario. Un RPC estrecho para personal comprueba membresía y MFA vigentes; el servidor público puede consultar un booleano mediante su ruta de servicio autorizada. No exponer una función privilegiada de consulta libre de suscripciones. El código nuevo mapea una denegación a un error distinguible `subscription_required` y una falla técnica a un error recuperable distinto. Para staff que no es OWNER y para visitantes, la respuesta no revela el motivo financiero.

Defensa de DB propuesta al activar:

- Triggers BEFORE INSERT en `paciente_identidad`, `paciente`, `turno`, `pedido` y `folio_import_private.run`. Cubren REST directo, RPC privilegiado y llamadas del rol de servicio. Los guards explícitos de los RPC aportan mensajes y orden de recibos; los triggers evitan rutas olvidadas.
- Guardas de UPDATE para impedir usar una reactivación o un cambio de agenda como alta nueva: restaurar registros comerciales archivados, mover un turno, cambiar paciente/profesional/servicio/horario/duración, iniciar EN_SALA/ATENDIENDO, pasar un pedido a confirmado o reactivo y reprogramar. Inventariar antes las transiciones actuales y permitir cancelación/rechazo, sin convertir cualquier edición clínica en operación comercial. Cambios de organización deben tener un control independiente; no permitir que una simple reasignación eluda la guarda.
- Para M106, comprobar permiso comercial cuando la llamada va a iniciar una atención, después del recibo/probe y antes de escribir sesión. Si el turno ya está ATENDIENDO, conservar SAVE/AUTOSAVE/CLOSE, revisión, contexto, bloqueo y alcance actuales. La guarda del turno respalda ese control dentro de la misma transacción. Las enmiendas de historias cerradas siguen su circuito autorizado.
- En M112, comprobar el permiso después del recibo previo y antes de procesar una fila nueva. Usar una denegación que salga sin persistir resultado definitivo de fila; no usar `check_violation`, que su bloque EXCEPTION convertiría en `row_failed`. Detener el lote y permitir reanudarlo sin repetir las filas confirmadas.
- Conexiones de integración: el INSERT es comercial; en UPSERT distinguir un vínculo/reconexión nuevo de actualización técnica. Antes de bloquear UPDATE de tokens, definir un RPC estrecho de conexión y una autoridad privada para renovaciones, revocación y trabajos pendientes. No interpretar cualquier token nuevo como alta.

No modificar `getActiveSession`, `user_org_ids`, los SELECT de RLS ni `can_read_clinical` para incorporar facturación. No aplicar un trigger genérico a todas las tablas, ni un privilegio global por `service_role`: ese rol también crea reservas públicas y recibe WhatsApp.

La excepción de restauración/mantenimiento debe restringirse a una sesión administrativa real, fuera de PostgREST. No confiar solamente en `current_user` dentro de SECURITY DEFINER, porque es el dueño de la función; tampoco solamente en `session_user`, porque los tests SQL usan SET ROLE. Revisar rol original más usuario de sesión, con pruebas de llamada anidada. No autorizar un bypass con una variable de sesión que un cliente pueda fijar. Los operadores de Folio no reciben permiso de desactivar la política desde el navegador.

No agregar locks de suscripción indiscriminadamente: los RPC de cobros M99 bloquean `suscripcion FOR UPDATE`, mientras algunos flujos clínicos bloquean primero organización, paciente o turno. Adoptar y probar un orden común antes de pretender serialización estricta. La garantía mínima explícita es admisión según una lectura autorizada de la política al ejecutar la operación; no se promete que una operación ya admitida se aborte al vencer el reloj durante su transacción. Una modificación concurrente de la política no puede dejar medias escrituras.

## Ruta de continuidad necesaria antes de activar

Proponer `/continuidad/atenciones/[turnoId]` fuera del layout comercial, enlazada desde facturación. No es una excepción por prefijo de URL ni por un header enviado por el navegador: el servidor carga el turno con organización fijada por sesión y comprueba MFA, membresía, alcance y estado persistido.

- Lista únicamente atenciones ya ATENDIENDO y accesibles al profesional. Permite recuperar el editor, guardar, adjuntar evidencia necesaria, documentar consentimiento, cerrar y registrar/conciliar el cobro de esa atención. No crea paciente, turno ni visita adicional.
- No modificar ni sustituir silenciosamente la historia cuando cambia la suscripción. Al cerrar, redirigir a consulta/archivo; impedir volver a iniciar usando el mismo acceso.
- Mantener la consulta de historias y enmiendas por una vía autorizada fuera del layout. `/archivo-clinico` actual cubre parte de la lectura y entrega, pero no es un editor de enmiendas.
- Resolver con producto el caso **EN_SALA, atención aún no iniciada**, y los borradores sin SAVE: el mínimo técnico es ATENDIENDO persistido. No convertir un timestamp o una afirmación del cliente en prueba de atención previa. No activar hasta decidir la continuidad de esos casos.
- La cancelación de turnos futuros, revocación de accesos y entrega de información permanecen disponibles. Un miembro revocado no obtiene acceso por esta excepción; conserva el procedimiento humano de entrega autorizada.

## Riesgos de operación y compatibilidad

- M99, webhooks de pago, conciliación y operaciones para pagar/cancelar deben seguir funcionando: son la salida de la suspensión. No guardarlos por el estado que están intentando reparar.
- Los trabajos de cancelación, confirmaciones ya comprometidas, renovación técnica de credenciales y limpieza de conexiones requieren clasificación explícita. No convertir una denegación comercial permanente en reintentos infinitos ni enviar correos o llamadas externas antes de confirmar la transacción.
- El respaldo es lectura y no debe cambiar. [`restoreDatabase`](../scripts/backup/restore.mjs#L138) usa `pg_restore --single-transaction --exit-on-error` sobre destino local vacío; no desactiva expresamente estos triggers. El ensayo debe comprobar carga de datos, roles y orden de restauración con la nueva política, además de Auth/Storage. No introducir un bypass de API para facilitar el ensayo.
- Los tenants sintéticos conservan el bloqueo de proveedores incluso si se les concede cuenta interna para probar otros flujos. Los casos de facturación necesitan además fixtures sintéticas **no internas**; usar sólo cuentas internas produce un resultado inútil para esta guarda.
- Revisar datos actuales antes de activar: conteos agregados por estado, prueba y período pagado; atenciones ATENDIENDO/EN_SALA; turnos futuros y pedidos pendientes; importaciones en curso; conexiones y trabajos pendientes. Esa revisión no se realizó aquí y no necesita volcar PHI ni credenciales.

## Evidencia requerida para aprobar la activación

| Prueba negativa o de continuidad | Resultado exigido |
|---|---|
| Paridad TS/SQL | Todos los estados, sin fila, interna, fechas nulas/pasadas/futuras, PAUSADA dentro de prueba, MOROSA/CANCELADA dentro de prueba, límites exactos y zona horaria diferente. |
| Acciones directas y REST | Tenant vencido o pausado no crea identidad, paciente, turno ni pedido; tampoco una sesión para comenzar una atención nueva. Cuenta ajena, MFA incompleto y miembro revocado siguen denegados. |
| RPC y rol de servicio | M110/M112/M117 y reserva pública no eluden la política por ser SECURITY DEFINER o `service_role`. El rechazo no deja identidad huérfana, turno, recibo de éxito ni trabajo externo. |
| Reintentos | Una operación ya confirmada devuelve su recibo tras suspensión; operación distinta o mismo ID con intención diferente se rechaza. Fallo incierto conserva borrador y consulta recibo. |
| Reprogramación | Suspensión antes del llamado y fallo forzado después del cambio del original: original íntegro, cero reemplazos y cero cancelaciones externas confirmadas. Dos reprogramaciones concurrentes producen un único reemplazo. |
| Alta de pacientes | Fallo después de insertar identidad: ninguna identidad/paciente parcial. Un reintento crea exactamente una pareja. |
| Importación interrumpida | Filas previas consultables; siguiente fila denegada sin resultado definitivo; reactivación permite continuar sin duplicados. |
| Continuidad clínica | Suspender con un turno ATENDIENDO permite guardar, recargar, completar adjunto autorizado, cerrar y comprobar su pago; un turno AGENDADO no se usa para iniciar otra atención. La enmienda conserva el original. |
| Lectura y derechos | Archivo, PDF/JSON, descargas autorizadas, vinculación de identidad revisada y cancelación siguen disponibles; no se amplía alcance a otros pacientes o profesionales. |
| Integraciones | Conexión nueva denegada antes del proveedor y por DB; reanudación/cancelación de trabajos existentes y renovación autorizada no se confunden con alta. Cero llamadas externas en pruebas. |
| Recuperación comercial | Evento de pago válido reactiva acceso; evento duplicado no duplica efectos; error de lectura no autoriza alta ni es presentado como deuda cierta. |
| Administración y respaldo | Usuario autenticado, servicio público y llamada anidada no falsifican autoridad; restauración local íntegra con la política y roles preparados. |

Secuencia de entrega: diseñar y probar RPC de reprogramación/alta y continuidad; añadir política inactiva; desplegar código compatible y mensajes; ensayar negativos en Supabase local real con Auth/MFA/RLS/Storage y proveedores bloqueados; revisar producto y datos actuales; activar de forma registrada; verificar y recién entonces marcar cerrado el bloqueo comercial. La colección de tests, mocks o PostgreSQL con stubs no sustituye ese ensayo real.
