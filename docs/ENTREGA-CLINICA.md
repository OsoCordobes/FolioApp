# Entrega clínica: extensión revisable v2

## Qué incluye este corte

El JSON mediado por un profesional conserva las claves existentes y añade `format_version: folio.patient-export.v2`, `manifest` y nuevas categorías dentro de `historia_clinica`:

- `instrumentos`: cada aplicación autorizada, sus respuestas JSON originales, ID y versión, score y banda registrados, sesión asociada, quién completó y fechas de creación/modificación/cierre. No vuelve a ejecutar una escala ni interpreta versiones históricas. Un campo de respuestas nulo se identifica como `ausentes_en_origen`; nunca se reconstruye desde el puntaje.
- `documentos`: inventario autorizado, metadatos, descripción descifrada, tamaño y hash registrado cuando existen. Incluye el estado retirado si la RLS permite leer ese registro. `bytes_incluidos` y `bytes_verificados` son siempre falsos. Sólo ofrece un endpoint autenticado para documentos vigentes; no expone bucket/path ni una URL firmada de Storage.
- `consentimientos_evidencia`: texto y versión del acto, estado de evidencia, revocación, evaluación asociada y participantes originales. Cada firma tiene una referencia al endpoint existente `/api/consentimientos/:id/firma?participante=N`, que vuelve a comprobar sesión, MFA y permisos. La evidencia antigua queda identificada como pendiente; no se acredita retrospectivamente.
- `evaluaciones_consentimiento`: fundamento y participación descifrados, modo, riesgo, autor, vigencia, revocación y snapshots originales de identidad/representación. Los campos cifrados dentro de esos snapshots se descifran; no se sustituyen por la identidad actual.

El portal conserva su alcance anterior: no recibe estas categorías clínicas por reutilizar el builder. No se modifican roles, RLS ni MFA. Ninguna lectura nueva usa service_role; todos los datos se consultan con el cliente autenticado del actor.

El PDF incorpora respuestas, versión y resultados originales de los instrumentos y un texto visible de alcance. Sigue siendo un documento de lectura, con los resúmenes de herramientas existentes: no es un archivo de restauración ni contiene firmas/documentos binarios.

## Errores, paginación y límites

Las nuevas colecciones, sesiones, notas e intake usan dos lecturas paginadas de hasta 500 filas por petición, con recuento exacto, IDs sin repetir y comparación del contenido entre recorridos. Una colección falla si cambia el recuento/contenido, se repite un ID, falta una página, el servidor falla o se supera el límite de 10.000 filas / 4 MiB por recorrido. El descifrado o JSON ilegible aborta la entrega; tampoco se omite silenciosamente una evaluación vinculada que el actor no puede recuperar.

Turnos, metadata de consentimientos, metadata de intake y enmiendas conservan lectura paginada completa y comprobación de recuentos. El builder clínico vuelve a verificar acceso al paciente antes de devolver el resultado. JSON y PDF finales tienen límite de 4 MiB y no se entregan parcialmente si lo exceden. Los datos se procesan en memoria, sin archivos de PHI ni mensajes con contenido clínico en logs.

**No hay un snapshot transaccional único entre todas las consultas ni entre PostgreSQL y Storage.** Dos recorridos detectan cambios observables; no detectan necesariamente una edición transitoria revertida entre lecturas o cambios posteriores a la última verificación. El manifiesto registra el intervalo de lectura y declara ese límite. No se comprobó disponibilidad ni integridad de bytes porque no se descargaron.

## Manifiesto y pendientes

`archivo_restaurable` permanece **false**. El manifiesto enumera categorías, recuentos y estados: datos incluidos, inventario sin bytes o ausencia de registros autorizados. También identifica respuestas ausentes y consentimientos de evidencia antigua.

Siguen pendientes los bytes de documentos/firmas y sus hashes comprobados, la evidencia vigente de verificación de representantes fuera del snapshot del acto, un snapshot global consistente y un contrato de importación/restauración ensayado. Los endpoints requieren sesión válida y pueden dejar de ser accesibles tras revocación de permisos o retirada del documento. Una referencia descargable no equivale a archivo entregado.

## Propuesta para cerrar la entrega completa (sin implementar M116)

1. Definir un manifiesto de archivo versionado con inventario exhaustivo de categorías, esquema de datos, IDs de origen, relaciones, hash SHA-256/tamaño de cada artefacto, estado de borradores/cierres/enmiendas y ausencia explícita de archivos históricos faltantes. El paquete debe incluir bytes propios; no depender de URLs temporales.
2. Obtener los registros del paciente bajo un único snapshot SQL autorizado, con un marcador de revisión. Una RPC INVOKER aditiva podría devolver lotes/corte estables; si necesita persistir un snapshot, definir antes el almacenamiento cifrado, límites, retención y permisos del trabajo. No elevar roles para completar filas ocultas.
3. Vincular cada objeto al hash/versión de sus metadatos congelados; descargar bajo autorización vigente y verificar bytes, tamaño y hash. Un objeto alterado, ausente o sin evidencia suficiente impide declarar el paquete completo. Revalidar permisos y revisión antes de sellarlo; documentar que PostgreSQL y Storage no ofrecen una transacción distribuida conjunta.
4. Sellar un único archivo descargable con manifiesto interno, resultado por categoría y recibo de generación. Definir explícitamente el canal de entrega y protección del archivo de PHI. Manejar vencimiento/cancelación/reintento sin entregar un archivo incompleto como exitoso.
5. Ensayar importación/restauración en destino aislado con datos y archivos sintéticos: relaciones clínicas, respuestas de instrumentos, ambas firmas, revocaciones, enmiendas, corruptos/faltantes y fallo durante generación. Recién entonces evaluar el cierre de la puerta C.

No se creó ni aplicó M116 en este corte; requiere coordinación del siguiente contrato. La extensión actual depende de las columnas ya previstas en M73/M102/M103 y debe desplegarse después de esas migraciones.

## Evidencia

`node scripts/testing/run-unit.mjs tests/unit/clinical-export-completeness.test.ts tests/unit/clinical-export-pdf.test.ts tests/unit/patient-clinical-export.test.ts tests/unit/patient-export-scope.test.ts`

Incluye 1.201 instrumentos con respuestas/versiones/resultados originales, páginas posteriores, corrupción de JSON/cifrado, cambio de igual recuento, documentos sin bytes ni rutas de Storage, dos participantes, snapshot de identidad original, evaluación faltante y firma fuera del paciente. Las primeras ocho negativas fueron RED antes de la extensión. El PDF se verifica como árbol de presentación y se renderiza realmente en memoria con datos sintéticos.

El ensayo PDF carga únicamente el WASM de Yoga incluido en la dependencia mediante su data URI en memoria; el guard central sigue bloqueando toda red externa. No usa pacientes, claves, archivos ni servicios reales.

## Revisión independiente del mismo corte

La revisión independiente reprodujo 21 negativas y las corrigió: pérdida/cambio de rol, membresía, actor, MFA o acceso al paciente durante generación/auditoría; transporte que antes escapaba del contrato HTTP; cifrado no nulo vacío mal presentado como ausente; filas de otro paciente en instrumentos/evidencias; snapshot de identidad desconocido que antes dejaba pasar objetos opacos; conteo exacto ausente/inválido y corrección fuera de las sesiones solicitadas.

JSON y PDF comprueban de nuevo paciente (y sesión puntual, si corresponde) bajo RLS y después resuelven Auth/MFA y membresía/rol actuales, tras render y auditoría, antes de liberar bytes. Las denegaciones/errores son estáticos y `no-store`. Esta comprobación no promete una transacción global ni impedir cambios posteriores al último chequeo. Los snapshots de identidad siguen el esquema explícito de M103; una estructura desconocida exige revisión en lugar de omitir o exportar campos opacos.

Evidencia final: **141 pruebas focales PASS**, incluido PDF real sintético en memoria, regresiones de paginación/agenda y descargas autorizadas de documentos/firmas; lint focal PASS. Casos nuevos en `tests/unit/clinical-export-independent.test.ts`; RED inicial `.flow/clinical-export-independent-red.log`, conteo/enmienda RED `.flow/clinical-export-independent-count-red.log`, GREEN final `.flow/clinical-export-independent-green.log`. No se consultó producción ni se agregó SQL. Typecheck global queda a cargo de la integración del worktree.
