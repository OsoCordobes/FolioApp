# Guardado clínico, concurrencia y recuperación — C2

Estado: implementación local; no aplicada ni activada en producción. Requiere
validación del flujo por profesionales antes del piloto. PostgreSQL real con
identidades sintéticas verifica transacciones y permisos; no sustituye el ensayo
pendiente con Supabase Auth real.

## Comportamiento de la pantalla

- Cada borrador parte de una revisión confirmada. Una sesión nueva exige revisión
  `0`; una actualización exige la revisión exacta que el editor recibió.
- Dos pestañas no pueden confirmar cambios sobre la misma revisión: gana una;
  la otra muestra conflicto y conserva su texto y herramienta para revisión.
- Guardar y cerrar se habilita cuando termina el guardado ya iniciado. Doble clic
  no inicia dos operaciones. El cierre guarda el contenido, bloquea su original y
  cambia la agenda en una única transacción.
- Escribir durante un guardado mantiene esos cambios posteriores como pendientes.
  Una actualización de la página por el servidor no cambia silenciosamente la
  revisión del borrador. Si cambia el turno, el borrador no se envía a otra visita.
- Ante una respuesta perdida, «Confirmar operación pendiente» reenvía la misma
  operación y el mismo contenido enviado. El servidor devuelve su comprobante si
  ya confirmó el cambio; no vuelve a escribir ni duplica la revisión. La confirmación
  conserva los IDs de la visita original aunque un refresh muestre otra ancla.
- Si se escribe después de solicitar el cierre, la pantalla conserva ese texto
  aunque el cierre se confirme. El original cerrado no se reabre: corresponde
  revisar y, cuando proceda, añadir una enmienda.

En conflicto se puede comparar con la versión guardada, ver y descargar el
borrador local y luego recargar explícitamente. La comparación es de lectura;
no mezcla textos ni adopta automáticamente una revisión más nueva. El historial
conserva las herramientas antiguas que el editor actual no puede representar.
La descarga identifica el archivo como borrador no confirmado e incluye la
operación pendiente cuando existe. Contiene datos clínicos: su custodia y
eliminación en el equipo son responsabilidad del establecimiento.

Los avisos al cerrar/recargar y seguir enlaces reducen salidas accidentales.
El borrador permanece en memoria mientras la ficha está abierta: no se guarda
texto clínico en localStorage. Esto **no ofrece recuperación ante cierre forzado
del navegador, apagado del equipo ni toda navegación programática o historial**.
Ante una interrupción, conservar la ficha abierta y confirmar la operación o
descargar el borrador antes de salir. La recuperación persistente cifrada sin
conexión queda fuera de este cambio.

## Garantías y autorización del servidor

`save_clinical_session` comprueba la sesión/MFA actual, la pertenencia activa, el
acceso clínico, la organización, el paciente y la asignación del turno. Bloquea
primero el turno y después la sesión, compara la revisión y acepta únicamente
columnas clínicas autorizadas. Para actualizar un original existente conserva
el alcance M39: OWNER o profesional asignado; ser DIRECTOR colegiado permite
lectura amplia pero no amplía ese permiso de escritura. No acepta autor, organización ni bloqueo dentro
del contenido. La revisión, autor, hora y resultado se registran junto al cambio.

El servidor captura una vez el profesional, fecha/hora de visita, especialidades
originales de miembro y organización, identidad y fecha de nacimiento. Valida
herramienta y población contra ese mismo contexto. El RPC exige `p_context` para
escribir, lo compara con filas bloqueadas y devuelve conflicto si cambió antes
del commit. El editor no puede aportar ese contexto a la acción. Una confirmación
de operación ya recibida sigue siendo de lectura y no vuelve a validar una
herramienta histórica contra una fecha nueva.

El comprobante privado está acotado por actor, organización e identificador de
operación; además valida turno, paciente, intención, revisión esperada y huella
del contenido normalizado por el servidor. Esa huella distingue valores omitidos
(preservar) de valores nulos explícitos (borrar), incluidos los scores EVA. No contiene SOAP ni herramientas en
claro. Una cuenta ajena no puede recuperar el comprobante de otra. Los originales
cerrados siguen inmutables y las enmiendas conservan su mecanismo separado.

El cierre desde agenda bloquea exclusivamente el contenido que ya está guardado;
no atribuye al profesional un borrador aún pendiente en otra pestaña. Ese editor
recibirá conflicto/bloqueo al intentar guardarlo y conservará su copia local.
Las gestiones de cobro y seguimiento posteriores no forman parte de la
transacción clínica. Si fallan, la respuesta informa que la atención sí quedó
guardada y cerrada y pide revisar esas gestiones en agenda.

## Despliegue escalonado

1. Aplicar M106 aditiva. `folio_session_private.policy.enabled_at` comienza en
   `NULL`. El escritor anterior sigue funcionando y cada escritura incrementa
   la revisión; no activar todavía mientras quede código antiguo sirviendo.
2. Desplegar lectores, acciones y pantalla compatibles. Verificar en un entorno
   seguro dos pestañas, pérdida de respuesta, cierre desde ficha y desde agenda,
   enmienda posterior y recuperación. Resolver cualquier pestaña antigua antes
   del piloto; un cliente antiguo después de la activación recibirá un rechazo
   de escritura, no permiso para sobreescribir.
3. Con la versión compatible confirmada, un operador autorizado usa
   `public.enable_session_atomic_writes(p_reason text)` mediante servicio. El
   motivo debe describir la verificación del despliegue. La activación es global
   y de un solo sentido. Usuarios normales no pueden activarla ni desactivarla.
4. Confirmar que se rechazan INSERT/UPDATE/DELETE clínicos directos y que el nuevo
   RPC guarda y cierra correctamente. El trigger usa autorización privada de la
   transacción; variables configurables por el cliente no la sustituyen.

No desactivar protecciones ni volver a un escritor anterior como solución a un
incidente. Preservar borradores y registros; preparar una corrección compatible.
Los comprobantes no se purgan automáticamente: definir su retención con la
política de auditoría/continuidad y el responsable de datos antes de añadir una
tarea de limpieza. No se inventa una expiración universal para reintentos.

## Evidencia local

- `tests/sql/M106_session_atomic_revision.spec.sql`: creación explícita,
  comprobante/reintento, conflicto, bloqueo directo y variables falsas, rechazo
  de borrado, permisos, cierre fallido sin cambios parciales, original inmutable
  y comprobante ajeno denegado.
- `tests/sql/M106_session_expand.spec.sql`: escritor anterior durante expansión,
  revisión controlada por DB y cierre desde agenda que conserva contenido.
- `scripts/testing/clinical-session-race.mjs`: dos conexiones PostgreSQL reales;
  creación concurrente, desconexión antes del commit, cierre frente a autosave y
  recuperación de respuesta perdida. Exige un clon local dedicado
  `folio_test_c2_race*`; deja los datos sintéticos para inspección.
- `tests/unit/clinical-save-{coordinator,actions,ui}.test.ts`: 15 pruebas de
  coordinación, acciones reales y handlers del editor real ejecutados en VM.
  `clinical-writer-idempotency.test.ts` añade dos pruebas del escritor real sobre
  huella y contexto derivado en servidor. No equivalen a inspección visual ni a un ensayo con Auth/Storage reales.

El historial de ejecución integrado se registra en
`scripts/testing/VERIFICATION-2026-09-08.md`.
