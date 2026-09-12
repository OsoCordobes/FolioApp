# Registro de iteraciones de confiabilidad

## 12 de septiembre de 2026 — inicio

- Goal creada y activa; especificación: `docs/LAUNCH-RELIABILITY.md`.
- Copia `folio-reliability`, rama `codex/launch-reliability`, base 11f0206. Ninguna edición en copias ajenas.
- Se revisaron instrucciones del repositorio, tarea visual y evidencia previa. El trabajo M106/M117/M119 se reutiliza; no se reimplementa sin defecto reproducible.
- Dos auditorías independientes leyeron guardado/creación y cobros. Encontraron cierre/pago parcial, éxito sin filas en Finanzas y una columna inexistente en el ensayo E2E.
- Base unitaria: 2111/2111, sin omisiones. Comprobación de tipos aprobada.
- Se detectó que 4410 pertenece a la vista visual. Los ensayos propios deberán usar otro puerto y nunca reutilizar ese servidor.
- Docker Desktop detenido; PostgreSQL 16 de ensayo disponible. El recorrido con Supabase real sigue sin comprobar.

## Primera reproducción

- Se ejecutó el cuerpo real de `transitionTurno` con límites de persistencia sintéticos: la actualización del turno persiste CERRADO y un rechazo posterior 42501 del pago deja cero filas de pago. Resultado observado: `ok:true`, `pagoRegistrado:false`. Evidencia `.flow/launch-reliability/close-reproduction.json`; no es una prueba contra una base real.
- El agente de Finanzas reprodujo RED con el cuerpo real de la acción: UPDATE vacío seguido de pago ausente devuelve éxito antes del arreglo. Corrección y suite focal en curso.
- Preflight estático del ensayo clínico confirmó las firmas y columnas de las siete políticas; encontró además que M101 puede devolver denegación 42501 donde el spec exige sólo filas vacías. Se incorporó al plan clínico con negativos que rechazan datos expuestos y errores ajenos.
- PostgreSQL 16 está escuchando en 55439, pero sus conexiones respondieron `database system is starting up`; el log muestra recuperación tras interrupción. No se reinició ni modificó el servicio, ni se ejecutó SQL de ensayo.

### Decisiones de alcance

- Ruling: usar 11f0206 como base fija porque ya contiene protecciones necesarias de identidad, agenda y clínica — evita duplicarlas — implica revisar e integrar sus migraciones y diferencias con master antes de publicar.
- Ruling: no tomar los tests unitarios existentes como evidencia de que el cobro se persistió — se agregarán escenarios de cero filas y fallo intermedio — cuesta pruebas específicas adicionales, sin cambiar reglas de negocio por suposición.

### Próximo trabajo

1. Reproducir y corregir la confirmación sin filas en `marcarPagoCobradoAction`, conservando la idempotencia sólo si una nueva lectura autorizada confirma PAGADO.
2. Corregir/preparar el ensayo clínico: conteo por JOIN y puerto 4420 dedicado, manteniendo los rechazos de destinos externos, puertos de desarrollo y DB con datos ajenos.
3. Reproducir cierre sin pago y diseñar la corrección teniendo en cuenta el cierre clínico M106, permisos y pagos ya existentes.
4. Preparar evidencia SQL real en una base nueva propia del servidor local 55439.

## Primer cambio aprobado y preparación SQL

- Finanzas: commit `7bc3f3f`, 18 pruebas focales y 2122 unitarias completas aprobadas, tipos/lint aprobados. Revisión independiente de `/root/finance_review`: cumplimiento y calidad aprobados, sin hallazgos. Este tramo está cerrado; no acredita persistencia/Auth/RLS reales por sí solo.
- PostgreSQL local: la recuperación terminó y una sesión WSL propia mantiene disponible la instancia. Se creó el rol sintético exclusivo `folio_test_launch_20260912` y bases nuevas propias; nunca se cambió el password de postgres ni se borraron bases ajenas.
- El primer replay aplicó 113 migraciones, pero el primer spec rechazó el nombre del administrador sintético: los guards exigen la identidad de plataforma `postgres`. Se preservó esa base para inspección y no se modificaron los guards.
- Un segundo replay en `folio_test_launch_baseline_pg_20260912`, con identidad de sesión postgres, aprobó **113 migraciones con checks por defecto y 60 specs SQL**. Copia local del runner `.flow/launch-reliability/replay-postgres-identity.mjs`: mantiene validación loopback/base vacía y agrega `SET SESSION AUTHORIZATION postgres` al inicio de cada invocación psql. Log `.flow/launch-reliability/baseline-sql-postgres.log`. Auth/Storage siguen siendo stubs en este ensayo.
- Se reprodujo realmente `42703` por `pago.organization_id` y se ejecutó correctamente el JOIN con turno en esa base. Evidencia `.flow/launch-reliability/clinical-count-proof.sql` y `.log`; es una comprobación SQL de la consulta, no el recorrido clínico completo.
- Preflight clínico: implementación en revisión previa a commit por `/root/clinical_preflight_fix`, puerto 4420, conteo y contrato de denegación AAL1. Las siete pruebas del recorrido están enumeradas; no ejecutadas con servicios reales.
- Se solicitó al usuario abrir Docker Desktop mediante pregunta asincrónica; puede continuar el trabajo independiente mientras responde. El motivo es el rechazo de inicio automático registrado en el ensayo anterior.

### Próxima iteración de producto

- Ruling: Guardar y cerrar no debe convertir ausencia de información financiera en efectivo PAGADO — el cierre dejará cobro sin registrar; Cobrar y cerrar conservará confirmación explícita y atómica — cuesta un paso financiero explícito cuando se cierra desde la ficha, documentado y visible.
- Especificación `docs/CLOSE-RELIABILITY-SPEC.md`; plan SQL `docs/superpowers/plans/2026-09-12-atomic-visit-close.md`. Agente `/root/atomic_close_sql` implementa únicamente nueva migración, pruebas SQL/concurrencia y contrato; los callers y la recuperación en agenda se integrarán después de revisar esa frontera.
- Se mantiene pendiente la integración con la rama visual activa y la autorización final de publicación. No hay despliegue ni migraciones de producción desde esta goal.

## Ensayo completo desbloqueado

- El usuario confirmó que abrió Docker Desktop. Se verificó la versión del motor 29.3.0 y ausencia de contenedores en ejecución; se mantienen los contenedores y volúmenes detenidos ajenos.
- Preflight implementado en `ad75dd9`; limpieza de seguimiento del reporte local en `e7da69f`. Revisión independiente en curso sobre el rango fijo `783f85c..e7da69f`.
- Integración de Finanzas y preflight: **2124/2124 pruebas unitarias**, sin fallos ni omisiones. Log `.flow/launch-reliability/first-iteration-unit.log`.
- `/root/clinical_local_runtime` prepara el primer ensayo con Auth/TOTP/Storage reales en una copia detached de `e7da69f`, `folio-clinical-runtime`, aplicación 4420. No usa la migración M120 en desarrollo ni el servidor visual 4410. No hay resultado E2E todavía.
- Revisión de consumidores: `CerradoRow` actualmente presenta ausencia de pago como «sin cargo». Se incorpora a la corrección del cierre: sólo una decisión gratuita confirmada permite esa etiqueta; ausencia o incertidumbre requiere revisión, sin sumarse a recaudación o deuda.
- Revisión independiente del preflight concluida: cumplimiento aprobado y calidad aprobada con límites de evidencia real pendientes. Sin defectos de código. Se corrigió una observación documental baja para precisar el ensayo PG16 con cero filas y el inicio actual de Docker; no se repitieron pruebas por esa edición textual.
- Plan de consumidores y recuperación preparado en `docs/superpowers/plans/2026-09-12-close-callers-recovery.md`; implementación posterior a aprobación de la frontera SQL. Incluye lectura de recibos, respuesta incierta, preservación del formulario, recuperación administrativa en agenda y ausencia de dinero optimista.
- Revisión independiente de ese plan incorporada antes de programar: diálogo fuera del ciclo de vida de las filas, comparación de identidad/fecha real del pago ante respuestas viejas, acción de agenda para que ASISTENTE pueda saldar sin abrir Finanzas, y resultado explícito rechazado/incierto/requiere revisión. Se preserva el gate de Finanzas y la corrección ya aprobada de actualización sin filas.
- Inventario local de integración: la base fija `11f0206` difiere del master local inicial en 536 archivos; contiene preparación amplia ajena a esta iteración. Esta rama no debe publicarse como un parche aislado de cobros sin revisar esa dependencia. Las afirmaciones de producción en `ESTADO-ACTUAL.md` pertenecen a su evidencia previa, no son verificaciones nuevas de esta tarea.
- La tarea visual informó que prepara su publicación sobre master y conservará las otras ramas. No se incorporaron sus cambios a esta copia; la integración de estos arreglos seguirá siendo posterior y revisable.

## Frontera SQL lista para revisión y primer fallo E2E real

- M120 fuente fija `808f298`; limpieza del reporte ignorado `8077064`. Replay final en base propia nueva: **114 migraciones / 62 specs SQL aprobados** y **8/8 casos reales de concurrencia aprobados**. Revisión independiente en curso; aún no se integraron los consumidores. SHA-256: `3a8047fee2323c671def88c6976f91a2dcb9b8d401cd70ba51aa7038b7260464`.
- Una ejecución intermedia se detuvo por timeout del servicio WSL durante M68 al competir con extracción Docker. Se conservó la base; la siguiente base nueva completó el replay. No se alteró SQL para ocultar ese fallo de infraestructura.
- Supabase local real PG17.6 inició y aplicó 113 migraciones y cinco seeds del snapshot `e7da69f`. Auth/Storage/REST reales disponibles. El primer recorrido terminó **0 aprobados, 1 fallo en preparación y 6 no ejecutados**: no equivale a siete pruebas de producto realizadas.
- Reproducción: Windows adelanta 973–975ms al reloj de DB; el fixture usa hora de Windows para activar MFA y su comprobación inmediata rechaza ese instante todavía futuro. Más tarde los siete controles estaban activos. Se conservaron tres cuentas TOTP reales y tres organizaciones sintéticas; cero pacientes, turnos, sesiones, pagos o archivos.
- Plan puntual `docs/superpowers/plans/2026-09-12-clinical-database-clock.md`: tomar fecha desde la propia DB validada, conservar comprobaciones estrictas y repetir. No cambiar las protecciones ni esperar un tiempo arbitrario. La copia de runtime mantiene la base anterior sin M120 para aislar este hallazgo.
