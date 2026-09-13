# Creación manual de pacientes y turnos

El alta rápida creaba primero una identidad, después un paciente y finalmente un turno. Si el horario se ocupaba entre esos pasos, podía quedar un paciente sin turno. Volver a intentar podía duplicar la ficha. La protección del botón frente al doble clic no solucionaba ese problema en el servidor.

M117 agrega una operación de base de datos que confirma juntos la identidad nueva, el paciente, el turno, sus dos recordatorios y un comprobante del intento. Si falla cualquiera de esos pasos, se revierten todos. El trabajo de Google Calendar se registra mediante el disparador durable de M107, dentro de la misma transacción. No se llama a proveedores durante la creación.

Cada envío del modal tiene un identificador. Si la respuesta se pierde, «Comprobar guardado» recupera ese mismo intento con los datos originales; no crea un identificador nuevo. El servidor guarda una huella de esos datos antes del cifrado aleatorio. Una corrección después de un rechazo confirmado inicia otro intento. Los nombres, teléfonos y correos no se guardan en el comprobante: solamente la huella, referencias y condiciones del turno.

La base comprueba identidad autenticada, segundo factor según la política activa, organización vigente, membresía aceptada, alcance sobre el profesional, servicio activo y paciente vigente. Respeta la caja fuerte y la asignación del profesional. El personal de recepción con alcance puede registrar identidad administrativa y un turno; el contrato no admite notas clínicas ni vincular cuentas de pacientes. La recuperación de un comprobante vuelve a verificar los permisos actuales.

El bloqueo del horario usa el mismo mecanismo que las reservas de M110. La restricción de solapamiento existente también protege frente a los escritores anteriores. Los reintentos simultáneos de una operación se serializan antes de insertar; el comprobante y los datos se guardan en la misma transacción.

La función con privilegios y los comprobantes quedan en un esquema privado. La función pública es un adaptador sin privilegios elevados. Solo las sesiones autenticadas tienen permiso para invocarla; ni el navegador anónimo ni `service_role` reciben permiso de ejecución.

## Verificación

- `tests/unit/manual-turno-atomic.test.ts`: un solo RPC, identidad de operación, huella estable entre cifrados, cambios de intención, rechazos de permisos y datos, respuestas inciertas, ausencia de detalles SQL y fallo del refresco posterior al guardado.
- `tests/sql/M117_manual_turno_atomic.spec.sql`: reintento, ocupación del horario, parámetros de otra organización, contactos familiares compartidos, paciente existente, fallo después de insertar paciente y turno, reversión completa, permisos, revocación, eliminación lógica y segundo factor.
- `scripts/testing/manual-turno-race.mjs`: sesiones PostgreSQL realmente concurrentes, espera comprobada de bloqueos, dos operaciones por un horario, conexión interrumpida antes de confirmar y respuesta perdida después de confirmar.
- `tests/hoy/create-browser.cjs`: doble clic, cierre durante envío, respuesta perdida, recuperación con el mismo intento pese a ediciones posteriores, mensaje de éxito y reintento después de rechazo confirmado, en React de desarrollo y producción.

## Despliegue y límites

Aplicar las migraciones compatibles M98–M117 antes de desplegar esta versión de la aplicación. M117 no activa los controles diferidos de otras migraciones, modifica datos clínicos existentes ni cambia el dominio. La migración es aditiva; ante un problema de publicación se puede volver al código anterior conservando el esquema y los comprobantes. Ese regreso también recupera las limitaciones de la creación anterior, por lo que requiere seguimiento.

La política de MFA debe activarse mediante su procedimiento propio. Las pruebas SQL usan las sustituciones locales de Auth y Storage: no acreditan inicio de sesión real, correo ni Google Calendar. La recuperación automática conserva el intento mientras el modal permanece abierto; una recarga completa exige revisar la agenda antes de empezar otra alta. La carga masiva y la política de conservación de comprobantes se medirán antes del crecimiento comercial. No se eliminan comprobantes ni historias como parte de este cambio.
