# B10 · Llamador de recepción

Estado: contrato de implementación preparado por A el 25/09/2026; requiere revisión independiente antes de escribir código. No representa una función publicada ni reserva una migración. Base inspeccionada: master `fe50d9145dab6ed0becaa0fbfbf897e2de20fdb6`.

## Resultado para el consultorio

Recepción entrega un código de espera al llegar. Cuando corresponde, recepción o el profesional llama ese código hacia un consultorio. La pantalla muestra sólo código y destino. Llamar no abre la historia, no inicia la consulta ni modifica pagos.

Primera versión: destino estructurado «Recepción» o «Consultorio 1–99», sin texto libre que pueda publicar nombres o datos clínicos. La pantalla comparte la identidad visual de Folio y permite sonido breve opcional después de una interacción humana para habilitarlo. No requiere comprar hardware ni un proveedor nuevo.

## Contrato de seguridad y estados

- La pantalla utiliza una credencial propia, aleatoria y revocable, limitada a una organización. No hereda sesión de staff ni acceso a agenda, nombres, identificadores de pacientes, motivos o pagos. El servidor conserva únicamente su hash; no aparece en URL de consulta, registros o analítica.
- OWNER o DIRECTOR autorizado empareja y revoca la pantalla desde su sesión con MFA vigente. Un código temporal de un solo uso permite establecer una cookie exclusiva de pantalla, segura en producción. Caducidad y rotación explícitas, sin credenciales permanentes impresas.
- Staff aceptado con MFA vigente puede llamar únicamente un turno dentro de su alcance profesional actual. Comprobar organización activa, turno vivo, estado EN_SALA y día local vigente; la pantalla no recibe el ID del turno.
- El código se asigna una vez por turno/día local con unicidad en la organización. Su emisión y su llamado son operaciones independientes de las transiciones clínicas. Conservar el mismo código al recuperar una respuesta interrumpida; una operación repetida no emite otro llamado ni otro sonido.
- Evento de llamado inmutable con autor y operación. El pedido usa CAS o bloqueo para ordenar llamadas concurrentes. Una revocación, cancelación o cambio de alcance invalida cualquier nueva operación; definir en SQL el orden de bloqueos antes de implementarlo.
- La pantalla sólo recibe una lista mínima y acotada de llamados vigentes. Al abrir o reconectar muestra el estado actual sin reproducir sonidos antiguos; su cursor evita duplicados. Expiración, falta de red o revocación se muestran claramente, sin aparentar actualización en vivo.
- No habilitar Realtime, WebSockets o servicios externos por anticipado. Elegir transporte mínimo después de revisar las capacidades ya instaladas y medir su costo para una clínica pequeña.

## Paquetes y cierre

1. Persistencia privada, permisos, idempotencia, credencial de pantalla y pruebas SQL. No conceder permisos sobre agenda a la pantalla ni usar service_role como sustituto del control por usuario.
2. Acción de recepción/profesional y pantalla usando los mismos contratos. Revisar móvil/escritorio/TV, nombres ausentes por construcción, desconexión y sonido accesible.
3. Ensayo aislado con dos organizaciones y roles de recepción/profesional: llegada → código → llamado → pantalla. Confirmar que el turno permanece EN_SALA. Revocación inmediata, repetición de petición, reconexión sin sonido viejo y turno cancelado deben tener evidencia concreta.

No cerrar B10 con una maqueta, una pantalla pública sin credencial o un llamado que transicione a ATENDIENDO. No anunciar que la pantalla protege frente a una persona que fotografía un código visible; minimiza información, no elimina observación física.
