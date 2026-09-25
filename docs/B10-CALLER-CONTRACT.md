# B10 · Llamador de recepción

Estado: contrato B10a de persistencia y permisos, candidato local M139 desde master `6d26a8daad630674b46bccb6d08c7e8ced6977b9`. No hay pantalla ni función publicada todavía; M138 debe integrarse antes del primer push de M139.

## Resultado para el consultorio

Recepción entrega un código de espera al llegar. Cuando corresponde, recepción o el profesional llama ese código hacia un consultorio. La pantalla muestra sólo código y destino. Llamar no abre la historia, no inicia la consulta ni modifica pagos.

Primera versión: destino estructurado «Recepción» o «Consultorio 1–99», sin texto libre que pueda publicar nombres o datos clínicos. La pantalla comparte la identidad visual de Folio y permite sonido breve opcional después de una interacción humana para habilitarlo. No requiere comprar hardware ni un proveedor nuevo.

## Contrato de seguridad y estados

- La pantalla utiliza una credencial propia, aleatoria y revocable, limitada a una organización. No hereda sesión de staff ni acceso a agenda, nombres, identificadores de pacientes, motivos o pagos. El servidor conserva únicamente su hash; no aparece en URL de consulta, registros o analítica.
- OWNER o DIRECTOR autorizado empareja y revoca la pantalla desde su sesión con MFA vigente. Un código temporal de un solo uso permite establecer una cookie exclusiva de pantalla, segura en producción. Caducidad y rotación explícitas, sin credenciales permanentes impresas.
- OWNER/DIRECTOR aceptados y activos pueden emitir y llamar dentro de su organización; PROFESIONAL sólo turnos propios. ASISTENTE/COORDINADOR requieren el alcance actual de M122/M133 y una sesión AAL2 verificada incluso si la política general de MFA aún no se exige. Emparejar y revocar exige OWNER/DIRECTOR con AAL2 verificada. Comprobar profesional colegiado/aceptado, paciente e identidad vivos y sin caja fuerte, estado EN_SALA y día local vigente; la pantalla no recibe el ID del turno.
- El código se asigna una vez por turno/día local con unicidad en la organización. Su emisión y su llamado son operaciones independientes de las transiciones clínicas. Conservar el mismo código al recuperar una respuesta interrumpida; una operación repetida no emite otro llamado ni otro sonido.
- Evento de llamado inmutable con autor y UUID de operación. La misma operación con igual intención devuelve el mismo código, destino y cursor sin nuevo sonido, incluso si el turno salió después de EN_SALA; exige todavía autoridad vigente sobre turno, paciente e identidad. Reutilizar el UUID con intención distinta es conflicto. Para llamar nuevamente se crea otra operación de forma consciente. Se bloquean organización→actor→profesional→turno→paciente→identidad en lectura compartida y se serializa la operación/cursor privados; no se cambia EN_SALA. Esas lecturas bloquean un UPDATE concurrente del turno; deadlock o timeout exige consultar la misma operación antes de decidir, nunca un reintento con UUID nuevo.
- La pantalla usa un cliente servidor dedicado con rol `anon` y sin cookies Auth de staff. Un código hexadecimal aleatorio de 16 caracteres dura cinco minutos y se consume una sola vez; si se pierde la respuesta de emparejamiento no se reemite el token, se inicia una operación nueva explícita. El token de 32 bytes dura 12 horas y sólo su hash queda en base. Cada lectura comprueba la credencial, organización e issuer OWNER/DIRECTOR actuales. Revocar bloquea nuevas lecturas después de confirmar la transacción; una imagen ya pintada se retira en la siguiente actualización, no se promete borrado instantáneo de píxeles.
- El DTO contiene sólo `code`, `destination` y `cursor`: snapshot completo de hasta 20 llamados vigentes en cada lectura. `reset` avisa si el cursor de entrada es inicial, inválido o quedó atrás de la ventana; reconectar es silencioso. Cancelación, inicio de atención o pérdida de paciente/identidad retiran el código del snapshot sin publicar IDs clínicos. El cliente nunca pone token en URL, logs ni analítica; el límite de frecuencia existente se conectará en B10b.
- No habilitar Realtime, WebSockets o servicios externos por anticipado. Elegir transporte mínimo después de revisar las capacidades ya instaladas y medir su costo para una clínica pequeña.

## Paquetes y cierre

1. Persistencia privada, permisos, idempotencia, credencial de pantalla y pruebas SQL. No conceder permisos sobre agenda a la pantalla ni usar service_role como sustituto del control por usuario.
2. Acción de recepción/profesional y pantalla usando los mismos contratos. Revisar móvil/escritorio/TV, nombres ausentes por construcción, desconexión y sonido accesible.
3. Ensayo aislado con dos organizaciones y roles de recepción/profesional: llegada → código → llamado → pantalla. Confirmar que el turno permanece EN_SALA. Revocación inmediata, repetición de petición, reconexión sin sonido viejo y turno cancelado deben tener evidencia concreta.

No cerrar B10 con una maqueta, una pantalla pública sin credencial o un llamado que transicione a ATENDIENDO. No anunciar que la pantalla protege frente a una persona que fotografía un código visible; minimiza información, no elimina observación física.
