# Reprogramación completa y recuperación de reintentos

Implementación local del 12 de septiembre de 2026. Depende de `20260912170202_M119_reschedule_turno_atomic.sql`, posterior a M118. **No desplegada por esta tarea.** No activa el control comercial general ni modifica facturación, precios o historias clínicas.

## Problema y resultado

Antes, `reagendarTurno` confirmaba el estado REAGENDADO del original y después intentaba crear otro turno. Si el segundo paso fallaba, quedaba el primero sin reemplazo. La prueba de regresión ejecutó ese cuerpo real de servidor con la frontera de persistencia sustituida y reprodujo el fallo: esperaba AGENDADO y recibió REAGENDADO. Esa reproducción no usó producción ni Supabase Auth real.

Ahora la acción llama una sola vez a `reschedule_turno_atomic`. PostgreSQL confirma original, reemplazo, cancelación de recordatorios pendientes, nuevos recordatorios y recibo en la misma transacción. Los triggers M107 guardan los cambios pendientes de Google dentro de esa transacción. Un fallo posterior a modificar el original revierte todo el cambio.

Se conservan paciente, profesional, servicio, precio que tenía el turno, nota de reserva cifrada y modalidad. Sólo se eligen nueva fecha/hora y duración; si la duración no se envía, se conserva la anterior. El reemplazo nace AGENDADO/MANUAL. No recibe la sala de videollamada, el identificador de Google, pagos ni sesiones del turno anterior. La creación/reconciliación de efectos externos sigue correspondiendo a sus trabajadores.

El nuevo contrato exige `operacionId` estable. El servidor fija la organización desde su sesión; el navegador no elige organización, profesional, precio o paciente para la escritura. El RPC vincula el recibo con organización, miembro, operación y datos normalizados de la solicitud. El mismo intento devuelve su recibo; cambiar los datos de ese intento produce conflicto. Otro intento sobre un original ya reprogramado no puede crear un segundo reemplazo.

## Permisos y concurrencia

La función privilegiada vive en `folio_reschedule_private`, con recibos inaccesibles por REST. La entrada pública es SECURITY INVOKER y sólo está concedida a `authenticated`; `anon` y `service_role` no la ejecutan. Cada llamada, incluida la recuperación, comprueba MFA, membresía aceptada, organización activa, profesional vigente, paciente e identidad vigentes y caja fuerte. OWNER/DIRECTOR pueden actuar dentro de su alcance; PROFESIONAL sólo en su propia agenda; ASISTENTE/COORDINADOR requieren alcance delegado. El recibo también revalida el profesional actual del reemplazo.

La escritura toma el lock de agenda `booking-slot` que usan M110/M117 antes de bloquear y revalidar el turno original. Las operaciones sobre el mismo intento se serializan además por su identificador. La exclusión de horarios permanece como última defensa frente a un escritor anterior que no use ese lock. No se introducen reglas de suscripción en este flujo.

Las transiciones admitidas siguen siendo AGENDADO, CONFIRMADO y NO_ASISTIO → REAGENDADO. El RPC exige servicio activo y profesional vigente para el reemplazo. No permite utilizar una atención en curso o una historia cerrada como turno nuevo.

## Interfaz ante fallos

El modal conserva fecha, duración y operación mientras envía. Un doble clic, Escape o el fondo no despachan otro intento ni cierran durante el envío. Una respuesta explícita de rechazo permite corregir los datos y presentar una nueva operación.

Una respuesta perdida o desconocida muestra «Comprobar cambio», inmoviliza los datos enviados y recupera exactamente ese intento. Si la recuperación encuentra acceso revocado, eso no demuestra que el primer intento fallara: se conserva la incertidumbre. «Ver agenda» refresca y abre fecha, mes y profesional del destino solicitado. Ese profesional sólo orienta la navegación; no autoriza la escritura. Una falla al refrescar caché después de confirmar no transforma el éxito en un guardado incierto.

## Verificación realizada

- Regresión RED del flujo anterior: error al crear reemplazo dejaba el original REAGENDADO. GREEN posterior de la misma prueba con la acción nueva.
- 10 pruebas específicas de acción/data layer: rechazo, operación faltante, revocación, transporte perdido, respuesta malformada, reintento y caché posterior. Suite general: **2.111/2.111** aprobadas, sin omitidas, durante esta entrega.
- Comprobación de tipos y lint de archivos modificados aprobados.
- **8/8** escenarios de navegador con React desarrollo/producción y servidor sintético: doble envío, cierre pendiente, datos preservados, corrección, respuesta perdida, recuperación denegada y retorno a la fecha/profesional solicitados. El smoke corre también en App CI con `node tests/hoy/run-isolated.mjs browser-reschedule`.
- Spec SQL ejecutada en PostgreSQL 16 local con Auth de prueba: permisos/recibos, límites, superposición con el propio turno, duración por defecto, conservación de campos y sala/evento independientes, recordatorios con lease, trabajos Google, y fallo inyectado al insertar recordatorios **después** de las otras escrituras. Original, reemplazo, recibo y trabajos quedan íntegros tras rollback.
- **4/4** carreras con conexiones reales de PostgreSQL: mismo intento simultáneo; dos intentos del mismo original; dos originales para el mismo destino; un escritor anterior ocupa el horario después de la comprobación inicial. En el último caso, la restricción rechaza el reemplazo y revierte la operación; el original conserva AGENDADO, su versión de Google y su recordatorio pendiente.
- Cadena combinada final: **113 migraciones y 60 specs SQL** aprobadas con el runner transaccional actualizado, incluida la prueba de que la migración y el ledger M118 se revierten juntos. Evidencia local: `.flow/m119-replay.log` (línea 114 para ledger y resumen final).

La prueba de concurrencia está en `tests/integration/reschedule-concurrency.mjs`. Exige una base local propia `folio_test_m119_<sufijo>` en PostgreSQL 16, puerto 55439, recién migrada y sin usuarios/organizaciones. No crea ni reinicia bases, no carga `.env.local` y rechaza otros destinos. Debe ejecutarse en un destino independiente **antes** de los specs que conservan fixtures; confirma datos sintéticos para hacerlos visibles a varias conexiones y los conserva en esa base desechable. No usa los proyectos alojados ni proveedores.

Estas pruebas demuestran transacciones reales de Postgres y comportamiento de interfaz con respuestas controladas. Las funciones Auth de los ensayos SQL son stubs; sigue pendiente probar el flujo desplegado con Supabase Auth/MFA reales y comprobar los trabajadores de proveedores. No acreditan que se hayan enviado recordatorios ni que Google haya aplicado sus eventos. Una llamada externa ya en vuelo al reprogramar no se puede retirar retroactivamente; sus controles y conciliación pertenecen al trabajador existente.

## Despliegue y recuperación

1. Aplicar M119 completa después de sus dependencias y registrar su versión mediante el runner habitual. La transacción pertenece al runner e incluye su ledger; la migración no contiene BEGIN/COMMIT exteriores. Para un ensayo manual con psql usar `--single-transaction -f` y fallo inmediato.
2. Confirmar disponibilidad del RPC y sus permisos antes de desplegar acción y modal. Ejecutar negativos sintéticos y un cambio de turno completo en el entorno autorizado.
3. Si la migración falla, el runner revierte también el ledger: no desplegar el cliente que depende del RPC ausente. Si falla una reprogramación, consultar el recibo o la agenda; nunca reabrir a mano el original ni borrar un reemplazo como compensación.
4. Una reversión de código conserva los datos y recibos de M119. El código anterior contiene el fallo original: suspender el uso de reprogramaciones durante esa recuperación hasta publicar una corrección compatible. No eliminar M119 ni deshacer estados clínicos para volver a una versión de interfaz.

Pendientes separados: control comercial de nuevas operaciones; alta transaccional independiente de paciente; ruta para terminar atención durante una suspensión; normalización de la hora de los pickers cuando el navegador use otra zona. M119 conserva la interpretación actual del horario enviado; no modifica los helpers compartidos de fecha.
