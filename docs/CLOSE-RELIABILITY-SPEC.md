# Diseño: cierre clínico y registro administrativo del cobro

## Decisión adoptada para esta goal

Se adopta el diseño siguiente para implementación y revisión en desarrollo. `Guardar y cerrar` conserva el cierre clínico y deja el cobro **sin registrar** hasta una decisión financiera explícita; no crea efectivo PAGADO por ausencia de datos. `Cobrar y cerrar` confirma la decisión financiera y el cierre juntos. Recuperar el cobro de una atención ya cerrada nunca abre ni altera la historia clínica. El cambio debe quedar visible en mensajes, pruebas y documentación, sin imponer un pago ni deuda por inferencia.

Esta decisión responde a la meta de integridad y éxitos comprobados. Su costo respecto de la conducta anterior es un paso explícito de registro financiero cuando se cierra desde la ficha. No agrega proveedores, cuotas, reembolsos o funciones fiscales.

Base inspeccionada: `11f0206`, exclusivamente en `C:\Users\amiun\Documents\Codex\folio-reliability`. Diseño estático: no se ejecutaron pruebas, migraciones, servicios ni consultas de entorno. Este documento es el único archivo creado por esta subtarea. Las referencias siguientes son relativas a esta copia.

## Recomendación

Separar explícitamente dos resultados: la atención quedó cerrada y el cobro quedó registrado. Para el botón **Cobrar y cerrar**, confirmar ambos en una transacción. Para **Guardar y cerrar** sin datos de cobro, confirmar el original clínico y dejar una gestión administrativa durable, visible y recuperable; no inventar efectivo cobrado. Un COORDINADOR conserva el cierre administrativo sin adquirir permisos de pago.

La mínima solución completa requiere una migración aditiva y un pequeño camino para registrar cobros de turnos ya cerrados. Reemplazar solamente `transitionTurno` por una función SQL no cubre `saveSesionYCerrarAction`: M106 ya cerró la atención antes del segundo llamado. Agregar reintentos al segundo llamado tampoco cubre la caída del proceso entre ambos.

Existe una decisión de producto inevitable: el código actual transforma la ausencia de datos de cobro en efectivo PAGADO. Eso está implementado y testeado, pero no constituye evidencia de dinero recibido. Recomiendo cambiar ese caso a **registro pendiente de completar**; este estado no es una deuda confirmada ni un pago PENDIENTE. Si se quiere conservar el cobro automático histórico, antes debe agregarse una confirmación explícita de importe/método a Guardar y cerrar. No puede conservarse el automatismo y simultáneamente prometer que jamás se atribuye un cobro no confirmado.

## Hechos que condicionan el diseño

| Evidencia actual | Consecuencia |
| --- | --- |
| `lib/db/turnos.ts:487-540`: UPDATE del turno y después upsert de pago. | Hay dos commits posibles; el segundo puede faltar. |
| `app/(app)/pacientes/actions.ts:384-399`: `upsertSesion(CLOSE)` y después `transitionTurno(CERRADO)`. | Un cambio exclusivo del segundo llamado no puede revertir ni asegurar el primer commit. |
| M106 `:159-190`: guarda sesión, bloquea original, cierra turno y escribe recibo juntos. | Preservar esa transacción y su revisión; no compensar mediante reapertura. |
| M106 `:111-130`: recupera recibo antes de rechazar un original bloqueado; verifica identidad, contenido y autorización actual. | Conservar el mismo `operacionId` y hash; una respuesta perdida de CLOSE ya puede recuperarse sin nueva revisión. |
| M106 `:65-81`: el cierre de agenda sólo bloquea contenido previamente guardado; no puede crearlo ni modificarlo. | El nuevo cierre de agenda debe conservar esta restricción y funcionar también sin una sesión existente. |
| M09 `pago.turno_id` UNIQUE; `lib/db/turnos.ts:538` usa `ignoreDuplicates`. | Un pago previo siempre se conserva; la duplicación de filas ya tiene una defensa real. |
| `lib/db/turnos.ts:43-49,523-536`: sin cobro explícito crea efectivo PAGADO por el precio. | Es una conducta histórica que debe tratarse expresamente al cambiar el flujo. |
| `components/hoy/turno-row.tsx:51-54,114-118`: COORDINADOR cierra sin diálogo. | No hacer que un permiso de cobro sea requisito para todo cierre. |
| `lib/auth/capabilities.ts:69-94`: ASISTENTE puede cobrar pero no abrir Finanzas; COORDINADOR no cobra. | La recuperación debe existir también en agenda para ASISTENTE. Un enlace exclusivo a Finanzas no sirve para todos los roles autorizados. |
| `lib/db/recordatorios.ts:154-175`: POST_VISITA devuelve `Result`; caller en `turnos.ts:555-565` sólo captura excepciones. | La cola puede fallar sin que `.catch()` lo observe. Además la ejecución posterior a la respuesta no es durable. |

## Invariantes

1. **Cierre clínico:** un original confirmado como cerrado nunca vuelve a abrirse ni se reescribe por un problema de cobro. Las correcciones clínicas siguen mediante enmienda. Antes del commit, una falla SQL sí puede abortar toda la transacción: esto no es reabrir una historia confirmada.
2. **Cobro explícito:** un cierre solicitado con importe positivo y `pagado=true/false` no devuelve éxito de esa solicitud si el registro correspondiente falta. Una falla de inserción aborta ese cierre nuevo completo; una falla de transporte deja resultado incierto y se consulta el mismo intento.
3. **Sin información de cobro:** cerrar no demuestra pago, deuda ni gratuidad. Para importe de lista positivo y sin pago existente queda una gestión `REQUIERE_REGISTRO`. El precio se conserva como sugerencia, no como dinero recibido ni deuda confirmada.
4. **Sin cargo explícito:** monto cero elegido por un rol autorizado queda registrado como `SIN_CARGO`; no se inventa fila de pago. Debe distinguirse del cierre que perdió su registro y de un cierre sin decisión financiera.
5. **Pago previo:** conservar importe, método, estado, fecha, factura y demás datos existentes. No transformar una deuda previa en PAGADO mediante cierre; esa operación pertenece al camino específico para saldar. Devolver el pago real, no solamente `pagoRegistrado=true`.
6. **Concurrencia:** mismo intento y mismo contenido recuperan el mismo recibo; reutilizar el identificador con otro contenido da conflicto. Dos intentos diferentes no pueden confirmar dos importes/métodos contradictorios. UNIQUE evita filas duplicadas, pero no basta para detectar intenciones diferentes.
7. **Autorización actual:** escrituras y consultas de recibos vuelven a comprobar organización activa, pertenencia vigente, MFA, alcance de agenda y, para cobrar, permiso y asignación financiera. Un recibo no concede acceso después de reasignación o revocación.
8. **Mensajes:** `REGISTRADO` significa que existe un asiento confirmado en Folio por el usuario; seleccionar MERCADOPAGO o TARJETA no implica una llamada, autorización o liquidación de un proveedor. `REQUIERE_REGISTRO` no debe aumentar Recaudado ni contabilizarse como deuda confirmada.

## Permisos que deben conservarse

| Rol / acción | Cierre de agenda | Guardar y cerrar original | Crear o saldar pago |
| --- | --- | --- | --- |
| OWNER | Alcance de organización | Sí, bajo validaciones M106 | Sí |
| DIRECTOR | Alcance de organización | Sólo acceso clínico vigente y restricciones de original M106 | Sí |
| PROFESIONAL | Turnos propios | Original propio; mantener controles M106 | Turnos propios, también en RPC y REST |
| ASISTENTE | Según alcance administrativo | No | Sí, según alcance; necesita recuperación accesible en agenda |
| COORDINADOR | Según alcance administrativo | No | No; ni siquiera mediante helper privilegiado o payload manipulado |
| Paciente del portal / otra organización / miembro revocado | No por estas rutas | No | No |

Fuentes: M09 `:425-459,486-501`, M92 `:116-132`, M108 `:132-146`, `lib/auth/capabilities.ts:69-94`, M106 `:89-145`. La lectura financiera actual para staff no equivale a permiso de escritura. El DIRECTOR que puede leer historias no puede reemplazar cualquier original ajeno: M106 `:119-123,140-145` debe seguir vigente.

## Implementación propuesta

### A. Un marcador administrativo durable por turno cerrado

Agregar, en una migración nueva, un registro privado de cierre administrativo con clave única por turno: organización, turno, actor de cierre, fecha efectiva del primer cierre, origen y clasificación financiera (`REQUIERE_REGISTRO`, `SIN_CARGO`, `REGISTRADO`). Mantener referencia al pago real cuando existe, sin duplicar sus campos mutables. No guardar texto clínico, nombres ni instrucciones de tarjetas/proveedor. La clasificación representa la gestión administrativa; los estados PAGADO/PENDIENTE siguen perteneciendo a `pago`.

Un trigger privado al **entrar** en CERRADO crea ese marcador y encola POST_VISITA dentro de la transacción existente. Si ya existe un pago, marca registro existente; si no existe, el valor conservador es REQUIERE_REGISTRO. El nuevo cierre explícito puede resolver ese marcador como REGISTRADO o SIN_CARGO dentro de la misma transacción antes de confirmar. El trigger no crea pagos por su cuenta, de modo que tampoco convierte el cierre de un COORDINADOR en una autorización de cobro.

Esta ubicación cubre tanto el UPDATE de agenda como el UPDATE interno de M106, sin duplicar ni reescribir la lógica clínica de esa migración. Preservar M106 y sus recibos; una migración nueva agrega el mecanismo. Todos los objetos privados requieren privilegios cerrados, nombres calificados, `search_path` fijo y funciones no invocables directamente por anon/authenticated.

Una tabla privada no es un buzón que el navegador pueda escribir. Exponer sólo resultados mínimos mediante funciones controladas que aplican los permisos actuales. Si el punto público de entrada es SECURITY INVOKER, el helper privado debe conservar RLS para pago; si es SECURITY DEFINER como M106/M119, debe aplicar explícitamente el alcance completo, MFA y bloqueo de membresía/asignación durante la escritura. Nunca usar service_role desde el cliente ni un GUC editable por usuario como autorización.

### B. `transitionTurno`: sólo CERRADO usa cierre atómico

Conservar las demás transiciones. Para CERRADO, enviar identificador de operación estable, organización tomada de sesión, turno, duración y decisión de cobro explícita o ausente. La función de base de datos:

1. Valida sesión, organización, MFA y permisos actuales; bloquea turno y las fuentes de autorización necesarias. Sigue el orden existente de turno antes de sesión; no introduce una ruta que bloquee sesión y después turno.
2. Consulta recibo del actor/organización/operación y valida que corresponda exactamente al mismo contenido; devuelve el resultado original si existe. Guarda el contenido normalizado o una comparación verificable en servidor, no confía sólo en un hash declarado por cliente.
3. Exige ATENDIENDO para un cierre nuevo. CERRADO sin recibo del mismo intento devuelve el estado actual y dirige a recuperación administrativa; no reescribe duración, original ni historial de transición.
4. Ejecuta UPDATE a CERRADO; el trigger M106 bloquea el original guardado, el marcador administrativo se crea y POST_VISITA queda encolado. Todos siguen sin commit.
5. Con decisión explícita y permiso de pago, registra pago o SIN_CARGO. Con ausencia de decisión conserva REQUIERE_REGISTRO o el pago existente. Un fallo real al registrar lo solicitado aborta todo el cierre nuevo y su recibo.
6. Lee y devuelve el resultado persistido: turno cerrado, fecha efectiva, clasificación financiera y campos mínimos del pago real autorizados para ese rol. Escribe recibo en la misma transacción.

Con pago existente, el resultado debe distinguir `existente` de `creado`. Si la solicitud explícita lo contradice, devolver conflicto con estado actual, sin sobrescribirlo ni declarar aplicado el monto nuevo. Una coincidencia puede conservarse y confirmarse; una deuda existente no cambia a PAGADO sólo porque se cerró el turno. Esta validación endurece la semántica actual de ignoreDuplicates, sin alterar la regla de conservar pagos previos.

El cliente mantiene el mismo identificador y los valores originales durante resultado incierto, bloquea otra operación sobre ese cierre y permite comprobar/reintentar exactamente ese intento. Sólo después de reconciliar permite una nueva decisión. El ACK usa datos reales de cobro; no transforma la intención optimista en evidencia. Un refresh tardío sigue respetando las barreras actuales de `dashboard.tsx`.

### C. `saveSesionYCerrarAction` y M106

El camino clínico sigue enviando CLOSE mediante `upsertSesion`, con revisión, hash, contexto y operación actuales. El UPDATE de M106 `:186` dispara el nuevo marcador y POST_VISITA **antes del commit**; no depende de que sobreviva el servidor de aplicación.

Eliminar el segundo `transitionTurno(CERRADO)` de `app/(app)/pacientes/actions.ts:395`: provoca un UPDATE redundante y el cobro automático histórico. Después del recibo clínico se puede leer el resultado administrativo para mostrar `Atención guardada y cerrada. Falta completar el registro del cobro`. Si esa lectura falla, mantener éxito clínico confirmado, mostrar aviso de estado administrativo no confirmado y un acceso a la lista de pendientes. La recuperación administrativa ya quedó durable, por lo que esa lectura no forma parte de la garantía del guardado.

El recibo clínico no necesita almacenar ni congelar un estado de cobro que puede cambiar después. Recuperar el recibo clínico sigue siendo de sólo lectura y devuelve la revisión original; leer cobro actual es una segunda consulta autorizada. Nunca reejecutar WRITE clínico para arreglar el asiento ni cambiar el hash de una operación ya utilizada.

### D. Recuperación de un turno que ya está cerrado

Agregar una sección/acción pequeña de **Completar registro del cobro** accesible en agenda para ASISTENTE, OWNER, DIRECTOR y PROFESIONAL con alcance correspondiente. Puede aparecer también en Finanzas para sus roles, pero no depender sólo de esa página. COORDINADOR sólo ve que la gestión requiere un rol autorizado; no recibe botones de escritura financiera.

El listado parte del marcador administrativo, no de filas `pago`, y separa REQUIERE_REGISTRO de deuda confirmada. La acción usa un identificador propio, bloquea el turno cerrado y su marcador, vuelve a comprobar permisos, registra pago/SIN_CARGO y actualiza el marcador en una transacción. No UPDATE de `turno.estado`, `sesion`, duración ni cola de post-visita. Si el pago ya existe, lo muestra; para saldar una deuda utiliza el camino de saldar existente, respetando el trabajo concurrente de Finanzas.

Para cierres históricos sin marcador y sin pago, presentar **registro no verificado**, nunca reconstruir efectivo PAGADO ni marcar automáticamente gratuidad. No se puede saber si el usuario eligió cero, si hubo fallo o si aún falta cobro a partir de la ausencia de pago. Un eventual inventario/backfill administrativo debe ser idempotente, revisable y sin inventar hechos financieros. La primera versión puede limitar el tratamiento automático a cierres nuevos y presentar históricos en una consulta explícita de revisión.

## Rollback, interrupción y recordatorios

| Caso | Resultado requerido |
| --- | --- |
| Cobrar y cerrar: falla pago, marcador o encolado SQL antes del commit | Todo aborta; sigue el estado/revisión previo. Conservar datos del formulario para corregir o reintentar. |
| M106 CLOSE: falla escritura SQL del marcador/encolado | Aborta la transacción original completa; no se anuncia guardado. Conservar borrador. |
| Commit terminado, conexión perdida | Resultado incierto; misma operación recupera recibo sin segundo pago, revisión, transición ni post-visita. |
| M106 confirmado, falla lectura administrativa posterior | Éxito clínico más aviso; marcador durable permite recuperación. Nunca abrir historia ni afirmar que guardado falló. |
| Falla proveedor de mensajes después del commit | El cierre y cobro permanecen. El dispatcher administra su lease, estado y reintento actuales. No reenviar desde botón de cierre. |
| Dos usuarios cierran con distintos importes | Se serializan por turno. Sólo el primer cierre nuevo confirma; segundo obtiene conflicto/resultado actual y no pisa pago. |
| Repetición de un CLOSE clínico ya confirmado | M106 devuelve recibo original; no emite UPDATE redundante ni vuelve a programar recordatorios. |

POST_VISITA usa la fecha del primer cierre confirmado más dos horas y UNIQUE(turno_id,tipo), con `ON CONFLICT DO NOTHING`; un reintento nunca mueve la hora ni reinicia un job enviado, terminal o con lease. La nueva lógica sólo encola, no envía mensajes. El dispatcher ya exige CERRADO para POST_VISITA y descarta recordatorios previos cuando el turno está cerrado (`app/api/cron/dispatch-recordatorios/route.ts:64-65`). Preservar consentimientos, exclusión de organizaciones sintéticas y resultados inciertos del proveedor.

M107 ya inserta intención de Google dentro del UPDATE del turno (`:36-53`); no agregar otra llamada externa. Eliminar el UPDATE redundante del seguimiento clínico también evita despertar de nuevo el trabajo Google sin necesidad.

## Despliegue compatible

No editar M106 ni ninguna migración aplicada. La nueva migración crea objetos y entradas compatibles primero; luego se despliegan lectores/acciones y se activa el cierre nuevo. No afirmar que esta base o M106 están aplicados en producción: eso requiere inventario posterior fuera de esta subtarea.

La activación debe impedir que una pestaña o instancia antigua conserve el camino UPDATE CERRADO + pago automático: no alcanza con cambiar la UI. Diseñar un guard privado, inicialmente desactivado, que después de la activación exija autoridad transaccional para UPDATE de estado a CERRADO, incluso un no-op CERRADO → CERRADO. La autoridad válida proviene del nuevo RPC o de la autoridad WRITE privada que M106 ya mantiene; nunca del cliente. Así un antiguo seguimiento clínico falla antes de poder insertar su pago automático; su primer commit clínico permanece registrado y recuperable. Un cierre directo antiguo se rechaza sin cerrar el turno y solicita recargar. Revisar grants de INSERT pago y las únicas rutas de inserción para evitar un bypass alternativo; no debilitar UPDATE de saldar que mantiene el agente de Finanzas.

Activar sólo cuando los dos caminos nuevos y la recuperación administrativa estén disponibles y verificados. La desactivación operativa del nuevo cierre no puede reintroducir silenciosamente el cobro automático ni habilitar apertura de historias. Mantener el mecanismo de recuperación y sus registros.

## Decisiones fijadas y decisiones abiertas

**Fijadas por código y reglas actuales:** original bloqueado es inmutable; cierre de agenda puede existir sin sesión; COORDINADOR puede cerrar pero no cobrar; ASISTENTE cobra en agenda sin acceso a Finanzas; PROFESIONAL está limitado a sus turnos; cero explícito no crea pago; pago existente gana; `pagado=false` crea deuda; métodos de pago son asientos de registro y no cobros por API; POST_VISITA se programa dos horas después y es único por turno. Preservar estas reglas salvo cambio explícito de producto.

**Conducta actual que debe cambiar para cumplir la meta:** Guardar y cerrar sin información financiera crea efectivo PAGADO. Recomiendo reemplazarlo por REQUIERE_REGISTRO, con mensaje y acción concreta; no transformar todos esos casos en PENDIENTE porque también atribuiría una deuda no declarada.

**Ambigüedades de producto para revisar sobre una propuesta concreta:** precio de lista cero sin selección expresa, tratamientos incluidos en abono/obra social, gratuidad autorizada por rol y conciliación de cierres históricos. Default conservador: sin pago y sin selección expresa requiere revisión administrativa; no es facturable ni cobrado por inferencia. La recepción puede registrar SIN_CARGO explícito sin editar la historia. No agregar cuotas, pagos parciales, reembolsos, facturación fiscal ni suscripciones a esta corrección.

## Verificación propuesta para la implementación futura

No se ejecutó ninguna de estas pruebas. Antes de considerar terminada la corrección, agregar evidencia de:

- Rollback SQL de cierre directo con falla entre UPDATE y pago, incluyendo que la revisión y el lock clínico no cambian después del aborto.
- M106 CLOSE con éxito, falla antes de commit y pérdida de respuesta: un original, una revisión de cierre, un recibo, un marcador y un POST_VISITA; recuperación del mismo recibo sin nuevos efectos.
- COORDINADOR cierra y deja gestión sin pago; su intento de enviar importe o de usar recuperación se rechaza. ASISTENTE puede recuperar desde agenda sin acceder a historias ni requerir Finanzas.
- OWNER, DIRECTOR y PROFESIONAL con alcance correcto; rechazos de otra organización, portal, MFA insuficiente, cambio de asignación y miembro revocado, incluyendo lectura de recibo.
- Dos sesiones SQL concurrentes con importes diferentes; doble envío idéntico; mismo operation ID con distinto contenido; pago preexistente PAGADO o PENDIENTE preservado.
- Cierre sin cargo explícito distinguible de falta de registro, y cierre clínico sin cobro que nunca aparece como efectivo recibido o deuda confirmada.
- Recuperación sobre CERRADO que no modifica la historia, estado, duración o cola. Una respuesta perdida se resuelve sin volver a cobrar.
- Clientes antiguos antes/después de activación: el seguimiento clínico antiguo no alcanza su upsert de efectivo automático, y el cierre directo antiguo no crea un cierre parcial.
- Replay de migraciones en Postgres 16 con configuración por defecto; pruebas con RLS/MFA reales locales y recorrido navegador sintético. Las pruebas unitarias existentes no certifican estas garantías de base de datos.

Cobertura existente a extender: `tests/sql/M106_session_atomic_revision.spec.sql:90-108` prueba aborto y recibo clínicos; `M106_session_expand.spec.sql:42` protege bloqueo desde agenda; `tests/unit/clinical-save-actions.test.ts:28-39` protege mensajes de guardado; `hoy-transition-replay.test.ts` protege refrescos y respuestas tardías; `hoy-kpi-cobro.test.ts:148-174` codifica el default automático y la conservación del pago existente. La expectativa de default automático debe revisarse deliberadamente, no ocultarse como ajuste mecánico del test.
