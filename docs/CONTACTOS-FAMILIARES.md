# Contactos compartidos e identidad del paciente

Un teléfono o correo familiar es un canal de contacto. Nunca autoriza a reutilizar
una ficha, vincular una cuenta al portal ni leer la historia de otra persona.

M109 elimina solamente el índice único de teléfono de M30. Conserva el índice de
búsqueda, los datos existentes y la restricción de DNI activo por organización.
Dos hermanos, incluso sin DNI cargado, pueden tener fichas distintas con el mismo
teléfono. El profesional debe verificar a quién corresponde cada atención.

Las reservas dejan de buscar y reutilizar pacientes por una colisión de teléfono.
Durante un despliegue parcial, una base con la restricción anterior devuelve un
error que requiere resolver la configuración; nunca escoge a otro familiar.
La importación sólo omite por DNI coincidente, no por teléfono compartido.

## Despliegue y recuperación

Aplicar M109 y después el código compatible; los escritores anteriores también
aceptan un teléfono repetido al desaparecer el índice. Su importador anterior
puede seguir omitiendo familiares hasta que se despliegue el código nuevo.
Verificar dos fichas sintéticas con el mismo teléfono y distinto DNI, y otra sin
DNI, además del rechazo de un DNI activo repetido. No volver a crear el índice
único ni borrar fichas para permitir ese retorno. Un rollback de aplicación debe
mantener la corrección que impide reutilizar fichas por contactos.

## Evidencia y pendientes

Dos pruebas funcionales nuevas fallaron antes del cambio y pasaron después:
hermanos compartiendo contacto en importación y reserva frente al índice antiguo.
43 pruebas de importación/reservas pasaron. M109 se comprobó en PostgreSQL16 local:
la misma inserción de tres familiares falló antes de aplicar el cambio y pasó
después; el DNI repetido sigue rechazado y no se otorga cuenta de portal.

Esto no es un proceso completo de conciliación de duplicados. M112 agrega
transacciones por fila y comprobantes durables: reenviar el mismo archivo recupera
su progreso, incluso sin DNI, para cargas realizadas por esta versión. Las cargas
antiguas sin comprobante requieren revisión antes de reenviarlas. Las coincidencias por DNI o por una fila completa
ya importada requieren revisión humana; nunca se reutiliza una ficha por teléfono.
La vista previa y los resultados permiten recorrer todas las filas.
Ver [Importación durable de pacientes](IMPORTACION-PACIENTES.md) para despliegue,
pruebas y límites. No se fusionan ni se borran fichas existentes automáticamente.
