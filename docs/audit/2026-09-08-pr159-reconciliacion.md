# Reconciliación de la auditoría anterior (PR 159)

Se revisó la propuesta `docs(audit): auditoría end-to-end post-incidente .env.local`,
commit `d7254b3d149c73e2456a3e86ac92277653d0f429`. Era un documento de 237 líneas,
sin cambios de aplicación ni migraciones. Su estado se contrastó con esta implementación.

| Aporte anterior | Resultado de la revisión actual |
| --- | --- |
| Distinguir pérdida local de exposición pública | Conservado. La pérdida por sí sola no demuestra filtración. |
| Verificar todas las variables y el destino de los scripts | Recuperadas las 42 variables actuales de Production; inventario por nombres contrastado. Conexión de respaldo verificada contra FolioApp con TLS y certificado oficial, sin escrituras. Los tests usan credenciales sintéticas. |
| “Las claves no se podrán leer nunca más” y obligar a un endpoint de rotación | Descartado: recuperación cifrada completada desde una compilación administrativa aislada. Sus tres despliegues temporales fueron retirados. El endpoint remoto de migraciones se eliminó. |
| Reponer claves aleatorias para volver a trabajar | Aplicable sólo a pruebas sintéticas aisladas. No sustituye las claves que descifran información existente. Las originales se recuperaron y comprobaron contra datos existentes. |
| Validar las claves actuales y opcionales en el arranque | Implementado: base64 canónico de 32 bytes para las cuatro variables; error con nombres, sin valores. Health usa la misma comprobación e incluye HMAC. 46 pruebas de configuración/crypto pasaron. |
| Blind indexes, búsqueda y duplicados durante una rotación | Se conserva como requisito previo en `ROTACION-CLAVES.md`. No se habilitó ninguna `_NEXT`; esta recuperación no requiere rotar. Antes de una rotación futura deben verificarse lectores, escritores, conflictos y todos los índices. |
| Recifrado reanudable, organizaciones archivadas y sonda de cobertura | Pendiente de una futura rotación planificada. Recuperar claves no demuestra que todas las filas estén sanas; la muestra actual encontró dos campos pendientes de revisión. No se borraron ni modificaron. |
| Backups y archivo de configuración previo a herramientas | Copias protegidas de configuración conservadas. Nuevo pipeline de base consistente + Storage separado, cifrado y pruebas de restauración. La restauración integral del servicio sigue siendo una puerta de lanzamiento pendiente. |

Las fuentes operativas vigentes son [recuperación](../RECUPERACION-CLAVES.md),
[rotación](../ROTACION-CLAVES.md), [respaldos](../RESPALDOS.md) y
[estado de implementación](../plans/2026-09-08-market-readiness.md).
El documento anterior queda preservado en el bundle de ramas, sin incorporarlo como
instrucción vigente. Su PR podrá cerrarse cuando esta reconciliación esté guardada
en una entrega revisable.
