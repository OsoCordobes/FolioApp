# Ficha completada por el paciente

**Estado vigente 26/09:** el fundamento M144 y la compatibilidad portal M146 ya están publicados y comprobados en PR186. El formulario y QR siguen aislados. La revisión detectó que revocar sin una generación durable no impide que una emisión demorada llegue después; por eso M147 reemplaza la emisión/revocación anterior antes de publicar la interfaz. El diseño revisado exige generación/contexto previos, operación estable, recibo ligado al actor y sesión, y reconciliación sin repetir con otra operación. Una recarga pierde el token: se confirma una revocación que invalida solicitudes anteriores antes de emitir otro. `not_recorded` no demuestra que una petición demorada no llegará. Contrato detallado `docs/B09-INTAKE-LINK-RECOVERY.md` en rama `codex/intake-link-recovery`; implementación y prueba real conjunta pendientes. Las referencias anteriores siguientes se conservan como antecedentes; no autorizan usar las RPC legacy ni reaplicar la base.

Contrato de continuación de B09, 25/09/2026. B09a asignado a `patient_intake_foundation`, Sol High, desde master `c0fdf6312e9e9b60bd19dbc7b7d7cd1129ee56fa`; reserva exclusiva `20260925111500_M144_patient_intake_foundation.sql`. Copia nueva aislada, rama `codex/launch-patient-intake-foundation`. Mantiene el alcance de `LAUNCH-BOARD.md`; no autoriza mensajes ni uso clínico real.

## Primer paquete B09a: invitación y aporte administrativo

La revisión inicial partió de master `3c56a334d10911fc2f2c9c8269277bd883949e02`; la asignación actual usa la base publicada de PR183, con M142/M143 instaladas. Preparar únicamente el fundamento privado, las credenciales y sesiones limitadas, los aportes administrativos cifrados e inmutables y su recibo idempotente. Sin rutas HTTP, interfaz, incorporación a la ficha, envíos ni preguntas clínicas. Reutilizar la revisión monotónica del vínculo paciente/identidad de B04a; no duplicarla ni modificar migraciones aplicadas.

Propiedad del escritor: M144, sus specs/carreras, helpers `lib/patient-intake/**`, pruebas focales y `docs/B09-INTAKE-FOUNDATION.md`. Una extensión mínima del runner PG16 compartido requiere coordinación previa con A, sin otro replay. No tocar CSS global, caller, middleware ni el tablero. Revisión independiente antes de push; A integra y publica.

Matriz fijada por A para implementación aislada: OWNER/DIRECTOR pueden emitir, revocar y revisar datos administrativos dentro de su organización; PROFESIONAL sólo para turnos/pacientes de su alcance vigente; ASISTENTE/COORDINADOR sólo dentro del alcance de recepción vigente del turno. No extender con esto el permiso de editar identidad de COORDINADOR. Cualquier contenido clínico futuro seguirá separado y exigirá permiso clínico/caja fuerte. Comprobar membresía aceptada y activa, paciente/organización activos y JWT aal2 con factor y sesión vigentes; bloquear las filas que sostienen esa autorización hasta commit, incluida la membresía. Revalidar ante cada lectura o mutación; una autorización al emitir no autoriza revisar para siempre.

Invitación y sesión guardan sólo hash de sus secretos; relación privada con organización, turno, paciente, identidad y revisión monotónica del vínculo. La sesión intercambiada nunca vence después de la invitación. Para el ensayo: invitación válida por 24 horas, reemisión explícita revoca la anterior y sus sesiones. No prolongar vigencia por abrir o enviar. Invalidar ante cancelación, baja, cambio de vínculo/paciente/organización o fecha del turno. M119 reprograma marcando el anterior REAGENDADO y creando otro: el nuevo turno necesita nueva invitación, sin traslado de credenciales. Emisión no equivale a identidad verificada del portador.

Revisar invitación/sesión y estado del turno, paciente e identidad bajo un orden de bloqueos consistente con M119 y B04a antes de aceptar el aporte. Pruebas con conexiones concurrentes deben demostrar revocación y reprogramación; una secuencia de llamadas no acredita esa carrera. Mantener tablas privadas sin acceso directo por API, RPC con search_path fijo, privilegios mínimos y rechazo de UPDATE/DELETE ordinarios sobre aportes.

Un recibo atómico único por invitación y operación vincula versión de cuestionario y huella del contenido. Repetir la misma operación y contenido devuelve el mismo recibo; contenido distinto devuelve conflicto sin segundo aporte. La consulta pública recupera sólo confirmación mínima de su propia operación: nunca respuestas anteriores, datos de ficha ni listas de presentaciones. Diferenciar fallo confirmado de resultado incierto. Reutilizar cifrado probado; no guardar texto personal sin cifrar en la tabla, auditoría o recibo. Límites de campos/tamaño y cuestionario administrativo versionado deben quedar explícitos en el paquete; las preguntas clínicas permanecen fuera.

Decisión técnica revisada para B09a: V1 sólo datos personales, contacto y cobertura, máximo16KiB y campos explícitos. Normalizar Unicode NFC y orden del JSON sin convertir omisión en respuesta negativa. No calcular la huella con ciphertext aleatorio ni con el HMAC global, cuyo valor cambia con `_NEXT`. Usar un secreto aleatorio estable por invitación, almacenado cifrado, para HMAC con dominio separado que liga invitación, operación, versión y contenido canónico; cálculo sólo en servidor y recepción por RPC service-only. Incluir estas nuevas columnas cifradas en el inventario previo a retirar una clave antigua; no iniciar una campaña de rotación. Probar compatibilidad con la rotación de cifrado que ya admite `lib/crypto.ts`.

El orden final de locks debe verificarse contra M119/M142: advisory de agenda antes del turno, paciente antes de identidad, y filas de autorización staff retenidas hasta commit. Revalidar IDs/profesional luego del advisory. Añadir referencias restrictivas donde hagan falta para impedir renombrar/recrear IDs y revivir credenciales; documentar su efecto de retención, sin inventar un mecanismo de borrado de identidad.

Cierre de B09a: replay completo, negativos directos de permisos, sesiones vencidas/revocadas, organización/turno ajenos, identidad A→B→A, repetición de operación, contenido distinto, carreras reales de revocación/reprogramación y preservación de antecedentes. La incorporación administrativa con comparación de valores vigentes es B09b y exige su propia revisión. No llamar completo al checkpoint por publicar este fundamento.

## Resultado esperado

### Siguiente corte preparado ·26/09

Desde PR186 `3b99fe010ace47192060ec4fcefe49f8d910e669`, revisión de arquitectura sólo lectura por `intake_cancel_review`: emisión/revocación manual y QR local, formulario administrativo y consulta de propuestas por personal autorizado. Sin correo, preguntas clínicas ni incorporación automática. Asignar escritor después de cerrar la base y fijar master actualizado.

Propiedad propuesta: helpers nuevos `lib/patient-intake/{http,staff,public-service,submission-attempt}.ts`; rutas `app/api/patient-intake/{exchange,submit,status}`; página pública `/aporte` y componente en detalle del turno. Coordinar cambios puntuales en middleware/decisión de rutas; conservar políticas de caller. Credencial inicial en fragmento retirado inmediatamente, sin analítica; cookie propia HttpOnly/Secure/Strict con plazo del servidor, Origin exacto y límites reales de cuerpo/intentos.

Obligatorio antes de implementar: vincular el borrador a un marcador opaco de sesión comprobado por servidor para impedir que otra pestaña sustituya la cookie y envíe datos al turno equivocado. No reintentar automáticamente emisión con respuesta perdida: M144 no recupera el token original; una reemisión explícita revoca el enlace anterior. En envío, conservar operación/contenido en memoria y reconciliar estado; error, revocación o vencimiento no equivalen a «no recibido». Staff deriva organización de sesión y usa RPC autenticada; servicio público dedicado service-only, cifrado/huellas sólo en servidor. Prueba final real emisión→aporte→consulta, negativa entre organizaciones, dos pestañas, revocación y respuesta perdida; incorporación con conflicto será otro paquete.

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
