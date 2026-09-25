# Ficha completada por el paciente

Contrato de continuación de B09, 25/09/2026. Diseño de A, todavía sin implementación ni migración reservada. Mantiene el alcance de `LAUNCH-BOARD.md`; no autoriza mensajes ni uso clínico real.

## Primer paquete B09a: invitación y aporte administrativo

Revisión independiente del 25/09 sobre master `3c56a334d10911fc2f2c9c8269277bd883949e02`. Preparar únicamente el fundamento privado, las credenciales y sesiones limitadas, los aportes administrativos cifrados e inmutables y su recibo idempotente. Sin interfaz, incorporación a la ficha, envíos ni preguntas clínicas. Depende de la revisión monotónica del vínculo paciente/identidad de B04a: no duplicarla ni reservar una migración hasta fijar esa base.

Matriz fijada por A para implementación aislada: OWNER/DIRECTOR pueden emitir, revocar y revisar datos administrativos dentro de su organización; PROFESIONAL sólo para turnos/pacientes de su alcance vigente; ASISTENTE/COORDINADOR sólo dentro del alcance de recepción vigente del turno. No extender con esto el permiso de editar identidad de COORDINADOR. Cualquier contenido clínico futuro seguirá separado y exigirá permiso clínico/caja fuerte. Comprobar membresía aceptada y activa, paciente/organización activos y JWT aal2 con factor y sesión vigentes; bloquear las filas que sostienen esa autorización hasta commit, incluida la membresía. Revalidar ante cada lectura o mutación; una autorización al emitir no autoriza revisar para siempre.

Invitación y sesión guardan sólo hash de sus secretos; relación privada con organización, turno, paciente, identidad y revisión monotónica del vínculo. La sesión intercambiada nunca vence después de la invitación. Para el ensayo: invitación válida por 24 horas, reemisión explícita revoca la anterior y sus sesiones. No prolongar vigencia por abrir o enviar. Invalidar ante cancelación, baja, cambio de vínculo/paciente/organización o fecha del turno. M119 reprograma marcando el anterior REAGENDADO y creando otro: el nuevo turno necesita nueva invitación, sin traslado de credenciales. Emisión no equivale a identidad verificada del portador.

Revisar invitación/sesión y estado del turno, paciente e identidad bajo un orden de bloqueos consistente con M119 y B04a antes de aceptar el aporte. Pruebas con conexiones concurrentes deben demostrar revocación y reprogramación; una secuencia de llamadas no acredita esa carrera. Mantener tablas privadas sin acceso directo por API, RPC con search_path fijo, privilegios mínimos y rechazo de UPDATE/DELETE ordinarios sobre aportes.

Un recibo atómico único por invitación y operación vincula versión de cuestionario y huella del contenido. Repetir la misma operación y contenido devuelve el mismo recibo; contenido distinto devuelve conflicto sin segundo aporte. La consulta pública recupera sólo confirmación mínima de su propia operación: nunca respuestas anteriores, datos de ficha ni listas de presentaciones. Diferenciar fallo confirmado de resultado incierto. Reutilizar cifrado probado; no guardar texto personal sin cifrar en la tabla, auditoría o recibo. Límites de campos/tamaño y cuestionario administrativo versionado deben quedar explícitos en el paquete; las preguntas clínicas permanecen fuera.

Cierre de B09a: replay completo, negativos directos de permisos, sesiones vencidas/revocadas, organización/turno ajenos, identidad A→B→A, repetición de operación, contenido distinto, carreras reales de revocación/reprogramación y preservación de antecedentes. La incorporación administrativa con comparación de valores vigentes es B09b y exige su propia revisión. No llamar completo al checkpoint por publicar este fundamento.

## Resultado esperado

El paciente recibe un enlace o QR correspondiente a su turno, completa los datos desde el teléfono y el personal autorizado los revisa dentro de Folio. No necesita crear una cuenta. La falta de formulario no impide atenderlo.

La primera parte recoge datos personales, contacto y cobertura. La segunda recoge motivo y preguntas de la especialidad aprobadas por un profesional competente. Se presentan por separado: recepción puede revisar lo administrativo; el contenido clínico exige acceso clínico a esa ficha. Una omisión nunca significa «No».

## Límites que debe preservar la implementación

- El enlace permite aportar información para un turno concreto. No permite leer la ficha previa, cambiar una reserva ni descubrir otros pacientes. No reutilizar como credencial el enlace de gestión del turno.
- Credencial aleatoria, almacenada como hash, revocable y con vencimiento. El servidor deriva organización, turno, paciente y especialidad de la invitación; no confía en esos campos del formulario.
- Invalidar ante cancelación o cambio de paciente/organización del turno. Un cambio de fecha requiere una regla explícita de reemisión; nunca prolongar silenciosamente un enlace viejo. Compartir el enlace permite usarlo: no presentarlo como identidad verificada.
- Guardar cada presentación cifrada, con versión del cuestionario, fecha y origen «aportado por el paciente». No modificar directamente identidad ni antecedentes; no fusionar pacientes por coincidencia de documento o correo.
- Una respuesta interrumpida se recupera con la misma operación. El estado debe distinguir «recibido», «no recibido» y «no pudimos confirmarlo», sin borrar las respuestas del formulario.
- La revisión muestra dato vigente y propuesta. Incorporar sólo lo que el personal elige, con comprobación de que el dato vigente no cambió desde que lo revisó. Conflicto: conservar ambas versiones y pedir una nueva revisión, sin sobrescritura silenciosa.
- La fecha de nacimiento aportada no acredita edad verificada. La comprobación para nuevas atenciones adultas sigue siendo un control separado.
- Datos y credenciales fuera de URL de analítica, registros de errores y almacenamiento persistente del navegador. El enlace inicial debe intercambiarse por una sesión limitada; respuestas privadas sin caché, origen controlado y límites de tamaño/intentos.

## Reutilización comprobada y riesgo a evitar

`lib/db/paciente-intake.ts` valida y cifra el intake por especialidad, pero hace un reemplazo por paciente/especialidad. Es un escritor del profesional; conectarlo directamente a un formulario público perdería la separación de aportes y revisión. Se pueden reutilizar validaciones compatibles después de revisar cada campo, no ese reemplazo automático.

Los esquemas existentes en `lib/especialidades/*/intake.ts` no acreditan aprobación de un cuestionario para pacientes. Las preguntas se versionarán y su validación humana quedará registrada; no se inventará una aprobación a partir de la existencia del código.

## Paquetes y cierre

1. Invitación, aporte administrativo y revisión con conflictos: enlace manual/QR, credencial revocable, presentación inmutable y permisos comprobados intentando acceso directo. Sin correo automático.
2. Motivo y preguntas aprobadas por especialidad: respuestas separadas, revisión clínica y procedencia preservada. «No sé» y «Prefiero no responder» cuando corresponda; campos no pertinentes ocultos.
3. Comunicación el día del turno: depende de la entrega de correo comprobada en buzones controlados; evitar duplicados y permitir enlace manual mientras tanto.

Prueba de cierre: recorrido real de navegador en entorno sintético desde emisión hasta incorporación; acceso de otro turno/organización rechazado, revocación durante el envío, repetición de respuesta perdida, edición concurrente del profesional y separación de permisos administrativos/clínicos. La prueba debe demostrar que los datos se incorporan sin volver a escribirlos y que los antecedentes anteriores permanecen intactos.
