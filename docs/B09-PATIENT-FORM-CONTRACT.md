# Ficha completada por el paciente

Contrato de continuación de B09, 25/09/2026. Diseño de A, todavía sin implementación ni migración reservada. Mantiene el alcance de `LAUNCH-BOARD.md`; no autoriza mensajes ni uso clínico real.

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
