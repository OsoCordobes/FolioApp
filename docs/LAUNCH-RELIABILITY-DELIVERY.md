# Candidato de confiabilidad — entrega de revisión

Preparación local al 13 de septiembre de 2026. El ensayo integrado de doce casos sigue pendiente; este documento no declara cerrada la goal ni autoriza publicar.

## Qué cambia para quien usa Folio

- Guardar y cerrar la consulta confirma la escritura clínica sin inventar un cobro. La decisión financiera se registra explícitamente desde agenda.
- Cerrar un turno con una decisión financiera confirma ambos cambios en una transacción. Si se pierde la respuesta, la interfaz conserva la solicitud y permite consultar el resultado o repetir exactamente la misma operación.
- Marcar un pago como cobrado conserva su identidad, importe y fecha de cobro original al reintentar. La base vuelve a comprobar los permisos al obtener los bloqueos necesarios.
- Un resultado incierto mantiene el diálogo y evita ediciones o duplicaciones. Los recibos históricos no sustituyen los permisos ni el estado financiero actuales.
- ASISTENTE puede recuperar un cobro desde agenda dentro de su alcance. COORDINADOR conserva su acceso operativo sin recibir datos o controles financieros.

## Código y dependencias

Rama `codex/launch-reliability`, copia aislada `C:/Users/amiun/Documents/Codex/folio-reliability`. Fuente de aplicación e interfaz aprobada en `8a802e0a8c24a6ad040fa3429c901c266d3519d0`; candidato de pruebas aprobado en `3a9823ab866c6ebe7dda17b7ea080fcadea42a5e`.

La rama incluye la preparación heredada de `11f020685f15cd65be61b030e1f628d2ad6a6941` y la visual publicada observada en `28ab28a93798b09c2a4e092e9cceb0f163262f9e`. Frente a esta última hay **23 migraciones pendientes según Git**, incluidas M120/M121. No es un parche aislado de dos migraciones ni un inventario de producción. El [manifiesto](LAUNCH-RELIABILITY-MIGRATIONS.md) enumera las versiones y el [procedimiento de publicación](LAUNCH-RUNBOOK.md) ordena instalación, código y activaciones.

## Evidencia verificada

| Comprobación | Resultado y revisión exacta | Límite |
|---|---|---|
| Unidades del candidato | 2180/2180, cero fallos u omisiones, `3a9823a` | No ejecutan el recorrido con servicios reales |
| Tipos y lint | Completos en `8a802e0`; tipos y lint focales de los cambios de pruebas en `3a9823a` | El cliente Supabase `any` requiere cotejar SQL por separado |
| Interfaz de cierre y recuperación | 36/36 escenarios de navegador, modos desarrollo y producción, `8a802e0` | Las respuestas de estos escenarios son controladas |
| Seguridad del ensayo integrado | 18/18 y doce casos descubiertos, `3a9823a` | Descubrir casos no equivale a ejecutarlos |
| Compilación aislada | Exit 0 en `fa5787eeab7761f4b0e3e2859d09cd8693ebf056`; desde allí sólo cambiaron pruebas y documentos | 16 avisos heredados de instrumentación; no acredita observabilidad desplegada |
| SQL cronológico | 115 migraciones y 63 archivos de pruebas aprobados | PostgreSQL 16 local con stubs de plataforma |
| Orden de actualización | 92 migraciones de `28ab28a`, luego las 23 faltantes de `34dc605` y 63 archivos de pruebas aprobados | Base sintética propia; no datos productivos |
| Concurrencia | M120 8/8, M121 6/6, conexiones reales de PostgreSQL | No prueba latencia ni carga de producción |
| Recorrido clínico anterior | 7/7 con Auth/TOTP/Storage reales locales, run-10 | Baseline de 113 migraciones, anterior a M120/M121 |
| Recorrido integrado nuevo | Pendiente de ejecución real | Doce casos, nueve controles activos, una sola ejecución por caso |

Las revisiones independientes de SQL, consumidores, interfaz y observación de respuestas perdidas quedaron aprobadas. Los fallos intermedios y su corrección se conservan en el [registro de iteraciones](LAUNCH-RELIABILITY-LOG.md); los informes detallados permanecen en `.flow/launch-reliability/` de la copia de trabajo.

## Qué falta para publicar

El siguiente paso de esta goal es actualizar la instancia sintética preservada, ejecutar los doce casos y revisar su evidencia. La actualización local tiene fases separadas de inventario, instalación M120/M121 con registro canónico y activación auditada M120 → M121, con M106 previamente activa.

Para publicar después, hace falta inventariar el destino autorizado, resolver las dependencias heredadas y ejecutar el corte compatible descrito en el runbook. Las pruebas de efectivo no certifican Mercado Pago, correo ni otros proveedores. La restauración integral, las validaciones profesionales, los responsables de soporte y la campaña alojada de acceso/carga mantienen su propia aprobación y evidencia.

Esta tarea no aplicó migraciones en producción, no desplegó ni realizó cargos reales. El despliegue automático por Git de esta rama está desactivado para conservar una entrega revisable; integrar en `master` requiere completar el procedimiento de publicación.
