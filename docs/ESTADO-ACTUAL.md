# Folio: estado de implementación al 12 de septiembre de 2026

Este documento distingue lo publicado, la preparación comprobada y las condiciones que faltan para vender con pacientes reales. No acredita todavía el piloto ni la capacidad de 200 profesionales.

## Publicado

Producción sirve `a0fe34e6853d42c5072741584775983de4f7bc53`, PR #163, despliegue Vercel `dpl_FF56jE36rk5i5BuC56V8MHLLvQjm`, READY en `gru1` y asignado a `foliosalud.com`. Se comprobaron inicio, login y health el 12 de septiembre a las 19:52 UTC; los tres respondieron 200 y el health indicó ok/production y no-store. App CI `34708399378` y SQL `34708399359` del commit fusionado finalizaron correctamente. Este smoke público no prueba una atención clínica autenticada.

Los checkpoints #160, #161 y #162 incluyen el arreglo de llegadas/cobros del video, Next 15.5.24, PDF sin recorte a diez sesiones, enmiendas, retirada de ejecutores administrativos destructivos y protección del modal frente a doble clic, cierre pendiente y respuesta perdida. Las URLs de retorno de autenticación, portal y recuperación de contraseña fueron comprobadas nuevamente el 12 de septiembre.

El checkout original en Desktop está en ese master. Se preservaron y verificaron sus cinco archivos `.env*` mediante copias DPAPI externas al repositorio antes de actualizar; todos conservaron sus hashes. GitHub quedó con `master` y `codex/market-ready`, sin PRs abiertos. Las ramas y worktrees de revisión locales se conservan; no hay stashes pendientes.

## Recuperación y respaldo

Las 42 variables de producción están recuperadas bajo custodia cifrada. La custodia de la frase fuera de esta PC sigue pendiente por decisión del propietario; no se requiere pegarla en chat.

El 12 de septiembre se detectó que la última copia válida seguía siendo la del 8. Una captura manual terminó y se autenticó a las **16:20:50 UTC del 12/09**: `backup_20260912T161810256Z_54e938a4-043e-49d5-b007-664faf4cf0d1`. Conserva base consistente, roles sin contraseñas y configuración cifrada; Storage fue verificado independientemente y tenía cero objetos. Se conservaron ambas copias válidas y las carpetas incompletas anteriores. La causa de las ejecuciones antiguas no está demostrada.

La tarea Windows independiente de Codex se actualizó primero a v2 y después al runtime inmutable v3. Su ejecución del 12/09 a las 17:00:43 UTC terminó con código 0, `not_due`, copia nueva reconocida, `stale24h=false` y aviso `not_needed`. Conserva horario, identidad, límites y definiciones anteriores. El diagnóstico conserva etapa/categoría y la antigüedad verificada cuando falla un intento; solicita un aviso local si supera 24 horas. Windows requiere PC/sesión disponibles y puede ocultar avisos. Detalles y hashes en [la evidencia del 12/09](RESPALDOS-ACTUALIZACION-2026-09-12.md).

Siguen pendientes la restauración integral con inicio de sesión y archivos, la configuración de plataforma completa, el disco externo y la custodia externa de la frase. Una verificación criptográfica no sustituye restaurar el servicio.

## Preparación de producto en la rama de trabajo

La rama amplia conserva M98–M119 y el resto de las correcciones del plan. Su despliegue automático continúa desactivado. **M118 se instaló por separado el 12/09 a las 17:29 UTC**, con versión canónica `20260912163934`: producción tiene 92 migraciones. M98–M117 y M119 siguen pendientes; no se marcaron como aplicadas.

- M117 hace transaccional la creación manual de identidad, paciente, turno, recordatorios y comprobante. Los reintentos recuperan la misma operación y los conflictos revierten todo. Pasaron 111 migraciones y 56 pruebas SQL en PostgreSQL 16 local con stubs, cuatro escenarios reales de concurrencia de DB y veinte escenarios de navegador con respuestas sintéticas.
- El archivo clínico fuera del bloqueo comercial permite consulta y PDF/JSON al titular o dirección clínica autorizados. Se comprobaron quince negativas de permisos y dieciocho escenarios de interfaz. Los archivos y permisos parciales continúan con entrega revisada; véase `ARCHIVO-CLINICO-CONTINUIDAD.md`.
- Se preparó la prueba clínica real con Supabase local PG17, Auth/TOTP, Storage y controles de seguridad activados. La enumeración de casos y las negativas del entorno pasan; el recorrido integrado no ha sido ejecutado.
- M118 protege suscripciones, fecha de inicio de prueba y exenciones internas. El archivo aplicado tiene SHA-256 `a8ad760dc9359f85aa355454890b306fee7dfa1a633b295cb44ca3cd1225fc19`. El control posterior confirmó permisos de escritura retirados a usuarios comunes, permisos de servicio y lectura conservados, tres triggers activos y política amplia retirada. No se alteraron suscripciones reales ni las nueve exenciones preexistentes. PR #163 y su despliegue de aplicación quedaron verificados como se registra arriba.
- M119 hace la reprogramación como sustitución transaccional con comprobante de operación. El fallo del reemplazo revierte original, recordatorios e intenciones de Google. Pasaron diez unitarias, ocho escenarios de navegador y cuatro carreras con conexiones reales de PostgreSQL.
- La revisión adicional de M110 cerró casos de autorización en la conversión de pedidos y la recuperación de sus comprobantes, y preservó el comprobante público mínimo. Sus tres archivos de pruebas SQL se incluyeron en el replay completo.

Después de M110/M119 aprobaron **2.111 unitarias, tipos, lint y el replay de 113 migraciones con 60 archivos de pruebas SQL**. El replay final usa transacciones por migración y prueba además que un fallo del registro de M118 revierte todo el cambio. La integración de producción se resolvió en `a814b33`, sin modificar el árbol previamente probado en `11f0206`. La compilación aislada final de ese árbol terminó con código 0; conserva advertencias de versiones distintas de instrumentación de OpenTelemetry. Evidencia local: `.flow/build-final-20260912.log`. No se presenta como una prueba de observabilidad desplegada.

## Condiciones para cerrar la preparación

1. Iniciar Docker Desktop manualmente para disponer de Supabase local real. El inicio automático fue rechazado por la revisión de permisos; no se reintentó por otro mecanismo.
2. Ejecutar y corregir el recorrido real de las tres especialidades: crear walk-in, marcar llegada, atender, guardar, adjuntar, registrar cobro, volver a iniciar sesión y reabrir; negativas de Auth, RLS, REST, Storage y revocación.
3. Cerrar las vías de elusión de cobro y comprobar pagos, reintentos, proveedores y comunicaciones controlados desde servidor. El bloqueo visual por suscripción no prueba un bloqueo de escrituras directas.
4. Completar y ensayar recuperación integral y restauración alojada. El aviso local ya está configurado; la PC apagada no interrumpe Folio, pero retrasa copias y avisos locales.
5. Revisar el corte integrado, aplicar migraciones compatibles antes del código, comprobar producción y activar cada control sólo después de sus pruebas. Conservar la versión de recuperación compatible con cada activación.
6. Completar validación profesional de instrumentos, menores y consentimientos; responsables de soporte y condiciones del servicio; Vercel Pro y programación; carga local y campaña alojada acotada.

Las pruebas aisladas, la página pública disponible y una compilación correcta son evidencias distintas. Ninguna, por separado, permite marcar listo el lanzamiento.

## Retomar sin este chat

El punto de trabajo completo está en `C:\Users\amiun\Documents\Codex\folio-market-ready`, rama `codex/market-ready`; la carpeta `C:\Users\amiun\Desktop\folio-app` conserva el `master` publicado. No empezar otra implementación desde Desktop sin revisar primero esta rama: contiene los cambios aún no publicados. La rama amplia tiene el despliegue automático desactivado deliberadamente porque requiere migraciones y pruebas integradas antes de producción.

Para continuar, pedir: «Leé docs/ESTADO-ACTUAL.md en C:\Users\amiun\Documents\Codex\folio-market-ready, verificá el estado actual y continuá el plan de Folio desde sus pendientes». La siguiente prioridad es Supabase local real y el recorrido clínico autenticado; después, el control comercial de escrituras y la restauración integral. El plan no está terminado ni se habilitó el piloto con pacientes reales.

La recuperación y la tarea de respaldo están en `C:\Users\amiun\folio-recovery\initial-20260908-182017`, fuera de Git y de este chat. Borrar la conversación no borra el código, las claves ni la tarea de Windows. No borrar esas carpetas al limpiar conversaciones.
