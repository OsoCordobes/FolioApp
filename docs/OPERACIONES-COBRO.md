# Operaciones de cobro durables (M99)

La migración `20260908163016_M99_billing_durability.sql` debe aplicarse antes de
publicar el código que llama sus funciones. Este documento describe preparación
local; no acredita que producción ya tenga la migración.

## Qué se guarda junto

`billing_record_charge` bloquea la suscripción y guarda el cargo, su transición
permitida y el trabajo de seguimiento en una transacción. Si cualquiera falla,
ninguno queda confirmado. El orden se compara con fechas del proveedor dentro
del bloqueo. Un pago pendiente puede resolverse después con el mismo ID; un
reembolso no se deshace con una aprobación repetida. Los cobros no reabren una
suscripción cancelada o pausada. Se conserva la tolerancia vigente para centavos,
sobrecobros y diferencias de asientos de Clínica.

`billing_apply_subscription` también bloquea la fila. Una preaprobación autorizada
no borra morosidad ni extiende un período impago. Un cargo aprobado válido puede
recuperarla. Los eventos anteriores a la última observación relevante no pisan
el estado actual.

Los seguimientos contienen referencias a organización, suscripción y cargo,
además de tipo, identidad, estado, intentos y concesión temporal. No copian
historias clínicas, destinatarios ni el cuerpo del webhook.

## Recepción y recuperación

Un webhook autenticado obtiene una recepción persistente y una concesión de un
minuto. Solo una recepción completada responde como procesada. Los errores de
base de datos, proveedor o confirmación final responden 503. Una ejecución que
muere deja la recepción disponible al vencer su concesión. El cron consulta esas
recepciones aunque Mercado Pago haya dejado de reenviarlas.

La reconciliación toma 10 suscripciones por ejecución, ordenadas por su próxima
revisión; el turno avanza aunque el proveedor no tenga cambios. Las concesiones
impiden trabajo concurrente sobre la misma suscripción. Con 200 organizaciones,
la configuración diaria anterior no alcanza: antes del piloto, programar cada
15 minutos en Vercel Pro y verificar ejecuciones efectivas y antigüedad máxima.

## Creación, cambio de precio y cancelación

`billing_provider_operation` conserva una intención inmutable por organización.
Mientras esté pendiente, en proceso, incierta o requiera resolución manual,
ninguna intención distinta puede reemplazarla. Su identidad de idempotencia es
un UUID guardado, sin depender del minuto o de la vida del proceso.

Antes de modificar Mercado Pago se guarda la fase exacta. Al reanudar una fase
incierta se consultan hechos del proveedor:

- Creación: buscar por pagador, completar las páginas y comparar exactamente la
  referencia `folio_operation_<id>`. Solo un resultado permite enlazar. Cero
  resultados no demuestra que el POST anterior no se ejecutó; no se repite.
- Precio: leer la suscripción. Si ya tiene el monto deseado, completar la base
  local. Si un PUT incierto sigue sin confirmación, no repetirlo a ciegas.
- Cancelación anterior a reemplazo: confirmar primero el estado cancelado.
  Ninguna nueva preaprobación comienza mientras esa cancelación siga incierta.

La búsqueda automática está limitada a 100 resultados por pagador. Una búsqueda
incompleta, varios resultados, diez intentos agotados o falta persistente de
confirmación requieren revisión del operador. Estas situaciones quedan visibles
como `uncertain` o `terminal`, con códigos de error sin datos personales. No se
libera una intención terminal para volver a cobrar sin verificar la operación
en Mercado Pago y documentar la resolución. La base y el estado final de la
operación se confirman en una única transacción.

## Verificación

Los tests de unidad ejercitan los orquestadores reales con dependencias locales,
incluidos errores de escritura, recepciones incompletas, falta de confirmación,
identidades estables y solicitudes con `AbortSignal`. No realizan cobros ni red.
Los dos archivos `tests/sql/M99_*.spec.sql` ejecutan las funciones reales en
PostgreSQL 16 con datos sintéticos y revierten sus fixtures. Cubren reversión
atómica, reintentos, orden, montos, concesiones, acceso y serialización de
intenciones. El replay local no reemplaza la validación posterior del proveedor
en un entorno de prueba ni la verificación de producción previa al lanzamiento.
