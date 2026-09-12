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

## Cierre y cobro aprobados en SQL; integración de aplicación en curso

- M120 recibió aprobación independiente de cumplimiento y calidad. Sus 114 migraciones / 62 specs y 8 casos de concurrencia acreditan la frontera SQL local; los consumidores todavía deben adaptarse.
- La revisión de cobros reprodujo una segunda carrera real: tres variantes de UPDATE esperando un bloqueo podían cobrar después de una revocación, reasignación o pérdida de alcance. La lectura posterior de TypeScript no puede deshacer esa escritura. Por eso el helper compartido usará exclusivamente la nueva operación M121, sin fallback al UPDATE anterior.
- M121 fuente `9fbb55cabe047b953a23f822ce3a99d818c61176`, SHA-256 `f0fbd4a705b1266b999ba4a24c08a7cc7f1795c6433ba0f1d6bb867fcf916fec`: replay **115 migraciones / 63 specs SQL** y **6/6 casos de concurrencia aprobados**, revisión independiente de cumplimiento y calidad aprobada. Conserva identidad e importe del pago, autoriza nuevamente y retiene las fuentes de permiso hasta terminar. M120 mantiene su digest anterior.
- Task 1 de `close-callers-recovery` está en implementación: contratos/adapters, actions, confirmaciones honestas y eliminación de cierre/cobro redundantes. UI y activación de los nuevos gates quedan después de su revisión independiente.
- Fixture de reloj `2d4d6a9` aprobado independientemente. El perfil clínico `b59b416` usa exactamente `http://localhost:4420` para respetar la normalización de Next y conservar cookies. Se recargó sólo el Supabase propio preservando sus datos y 113 migraciones; diez pruebas de configuración aprobaron. API/DB siguen en 127.0.0.1 y el runner visual en 4410.
- `2be6a61` extiende únicamente la espera de finalización MFA a 60 segundos tras medir la compilación de desarrollo. Perfil y espera recibieron aprobación independiente; no equivalen a pruebas de latencia de producción.
- Run 6 real: **1 aprobado, 1 fallido, 5 no ejecutados**. Se logró login/MFA, paciente/turno, llegada y guardado cifrado comprobado; se rechazó escritura clínica directa. La expectativa DOM de la nota al recargar superó cinco segundos y el contexto posterior mostró el contenido correcto. Task 2 acota las expectativas DOM positivas a 30 segundos, conserva negativos y límites de SQL/proveedores y repetirá el recorrido. Aún no hay prueba completa de archivos, cobro y reapertura en los servicios reales.
- Se creó una copia propia de integración visual basada en `aa97809` y el publicado `28ab28a93798b09c2a4e092e9cceb0f163262f9e`. Sus 16 conflictos se resuelven por comportamiento; no se modifica master ni se publica. Las mejoras posteriores a ese SHA publicado no forman parte de este checkpoint.
- El usuario autorizó instalar directamente las herramientas necesarias. Vercel CLI se actualizó a **59.16.0**, versión y sesión existentes verificadas. No se extrajeron variables, enlazaron proyectos ni realizaron despliegues.

## Recorrido de referencia completo y candidatos revisados

- Supabase real baseline: `db9e56d` ajusta exclusivamente expectativas DOM y selectores del ensayo. Run 10 aprobó **7/7 escenarios, sin fallos ni omisiones**, con quiropraxia, cardiología y psicología completas: creación, guardado cifrado, archivo real/proxy, cobro efectivo, nueva sesión y reapertura. También aprobaron AAL1/cross-tenant, archivo autorizado con suscripción pausada y revocación real de sesión. Proveedor de pagos no ejercitado.
- La nota persistida no se perdía: el selector exacto de etiqueta incluía el texto inicial SSR; el rol textbox conservaba nombre y valor correctos. El botón real de archivos dice «Subir documento». Se corrigieron esas referencias conservando las aserciones de datos y acceso. Un run anterior falló esperando creación durante carga simultánea de la PC; el mismo código pasó sin esa carga, sin ampliar el límite. RED y límites permanecen documentados.
- Runtime retiene 36 cuentas/TOTP/organizaciones sintéticas, 113 migraciones, 10 pacientes/turnos, 9 sesiones y 4 pagos/documentos/objetos Storage acumulados entre ensayos. Sigue en el baseline `e7da69f` más correcciones de fixture/perfil/spec: este PASS **no cubre todavía M120/M121 ni los nuevos consumidores**.
- Callers Task 1: `418a72e138a23364d65e3d81e40e699f15dcfdfa`, 14 archivos, **71 pruebas focales y 2172 unitarias aprobadas**, tipos/lint aprobados; revisión independiente de cumplimiento y calidad aprobada. Los recibos conservan su permiso histórico: la UI debe consultar permiso actual al habilitar acciones. Las llamadas antiguas de cierre sin ID quedan pendientes de Task 2 y este checkpoint intermedio no se publica.
- Integración visual propia: merge `2696edc` de `aa97809` con el publicado `28ab28a`, más `efe19c68c849696d7d66bc8a43014ac494eb3310`. Resoluciones semánticas y revisión independiente aprobadas. Tipos/lint y 2126 unitarias aprobadas; build del merge aprobado; reprogramación 8/8 y archivo aislado 18/18.
- La comprobación de creación detectó una carrera real del foco tardío: podía escribir un teléfono en Nombre, con cero solicitudes enviadas. Una prueba determinista reprodujo el defecto; `efe19c6` preserva el campo seleccionado y el foco inicial de un diálogo sin selección. **22/22 casos de creación aprobados**, más tipos/lint/2126 unitarias tras el arreglo. No se cambiaron esperas ni el controlador de recuperación para ocultarlo.
- Próximo paso: combinar esos candidatos revisados, implementar el diálogo de cierre/recuperación fuera del ciclo de vida de las filas, revisar y repetir el recorrido con M120/M121 activadas sólo en el entorno local propio. La publicación sigue pendiente.

## Corte combinado y actualización desde la referencia publicada

- `34dc605b025a15d53e1bd2bb8d4e637fa5b44fb5` combina los candidatos ya revisados; conserva «Sin turno» de la visual y las expectativas DOM aprobadas del ensayo real. Tipos, lint y **2172/2172 unitarias** aprobaron sobre ese corte. La UI de cierre/recuperación está en implementación posterior y requiere su propia revisión.
- El inventario local contra `28ab28a` contiene **23 altas de migración, cero modificaciones o eliminaciones**. M118 ya está y sus bytes son idénticos; M98–M117 y M119 son dependencias heredadas, M120/M121 pertenecen a esta corrección. No se consultó el inventario productivo ni se presenta este conjunto como un parche de sólo dos migraciones.
- Prueba real de actualización en PostgreSQL16.15: **92 migraciones de `28ab28a` primero, con M118 incluida → 23 faltantes de `34dc605` → 63 specs SQL**, todo aprobado, exit 0, una ejecución. Ledger final de 115 versiones exactas; 182 archivos de entrada congelados y verificados por hash. Se conservaron checks predeterminados, transacciones por migración y todos los fixtures. Base `folio_test_launch_upgrade_m121_20260912` e informe `.flow/launch-reliability/published-upgrade-report.md` retenidos. Auth/Storage aquí siguen siendo stubs.
- Las políticas M106/M120/M121 quedaron apagadas en esa base después de los rollbacks de las specs; cero autoridades temporales. No es evidencia de activación en el runtime clínico ni de conversión de datos productivos.
- Orden necesario del futuro corte: escritor compatible de M106, activación M106, consumidores completos de cierre, activación M120 y luego M121. El CLOSE nuevo exige M106 aun antes de activar M120. Se conserva la preparación separada de los otros controles heredados; no activar todo de forma automática.
- Se actualizó el contrato documental: `puedeRegistrar` dentro de un recibo es histórico e inmutable; los controles dependen de capacidades actuales y estado autorizado. También se reemplazó el estado desactualizado de replay pendiente de M120 por su evidencia aprobada.
- Próximo paso: aprobar Task 2 UI y preparar el ensayo integrado con respuestas realmente perdidas después de un commit comprobado, más acceso de asistencia/coordinación. Supabase clínico permanece en 113 migraciones con M106 activa; no se aplicaron ni activaron M120/M121 allí todavía.

## Interfaz aprobada y ensayo integrado preparado

- Interfaz de cierre/recuperación: `ad40e4f` y limpieza `ccdc2f2`, seguidos por `8a802e0a8c24a6ad040fa3429c901c266d3519d0`. Dashboard conserva la solicitud y el diálogo fuera del ciclo de vida de las filas; los recibos y estados autorizados confirman pagos, sin dinero optimista. Se preservan capacidades actuales, identidad del pago, duración y reintentos exactos. Registro ausente se muestra por revisar; ASISTENTE recupera desde agenda y COORDINADOR no recibe controles financieros.
- La revisión encontró un P2: una actualización financiera posterior a la lectura inicial dejaba controles viejos dentro del diálogo. Se reprodujo en los dos modos de navegador y se corrigió en `8a802e0`, conservando el reintento incierto y las actualizaciones de turnos ajenos. Revisión independiente final aprobada, sin hallazgos pendientes de UI.
- Checks del SHA exacto `8a802e0`, en copia detached propia para no mezclar pruebas clínicas en desarrollo: tipos y lint completos aprobados, **2172/2172 unitarias y 36/36 pruebas de navegador aprobadas**. También se conservaron las verificaciones de transición ordinaria 12/12 y creación 22/22. Informe `.flow/launch-reliability/close-callers-task2-report.md` y dictamen `close-callers-task2-independent-review.md`.
- `7b8e3cd` agrega el navegador de cierre/recuperación al CI de revisiones. `9468b88` desactiva el despliegue automático por Git de `codex/launch-reliability`, mediante la misma configuración por rama que ya usaba market-ready. No se enviaron commits remotos, crearon despliegues ni publicaron migraciones.
- El plan de ensayo `6080e0b` define doce casos independientes con sus propias cuentas/datos, nueve controles activos comprobados y sesiones reales del navegador: siete recorridos/negativas previos, tres respuestas perdidas después de commit y dos roles de recepción. Incorpora cambio de sesión comprobado, archivo real con acceso OWNER positivo antes de negar a ASISTENTE y limpieza de sesiones incluso tras fallos de preparación.
- Implementación del ensayo `fa5787eeab7761f4b0e3e2859d09cd8693ebf056`: tipos, lint de seis fuentes y **17/17 pruebas de seguridad aprobadas**, descubrimiento de doce casos. La revisión solicita una precisión de evidencia en Case 8: observar el POST real del botón de consulta y rechazar una nueva llamada de escritura, aunque use el mismo ID idempotente. Es una corrección del ensayo en curso; no un defecto demostrado del producto ni un resultado E2E real.
- Conjunto `fa5787e`: **2179/2179 unitarias aprobadas**, sin omisiones, y compilación aislada exitosa. Conserva 16 avisos por versiones diferentes de `import-in-the-middle` en OpenTelemetry, ya observados en compilaciones anteriores; no acredita instrumentación desplegada. Logs `integrated-candidate-unit.log` y `integrated-candidate-build.log`.
- Preflight del runtime actualizado sin drift: mismo `e7da69f` más ocho diffs conocidos, 113 migraciones, siete controles previos activos, 36 cuentas/TOTP/organizaciones sintéticas y todos los conteos/volúmenes conservados. Puerto 4420 libre; 4410 permanece reservado. Parche y manifiesto de los ocho archivos guardados; no hubo stash, checkout, DDL ni nuevas cuentas. Se confirmó el aviso automático de cambios de esquema a PostgREST.
- Próximo paso: aprobar la observación del botón de consulta y el ejecutor local de actualización; fijar el SHA, conservar la copia de runtime, aplicar únicamente M120/M121 con sus ledgers y activar sus controles auditados en orden. Después ejecutar los doce casos reales sin carga pesada concurrente. La goal y los requisitos externos de publicación siguen abiertos.

## 13 de septiembre — candidato revisado y recuperación del entorno local

- Corrección del ensayo en `3a9823ab866c6ebe7dda17b7ea080fcadea42a5e`: Case 8 observa el POST real del botón de consulta, comprueba su actor y solicitud congelada y rechaza escritores durante toda la recuperación, incluso después del recibo. Revisión independiente aprobada; el P2 de evidencia quedó resuelto.
- Tipos, lint focal del ensayo y **18/18 comprobaciones de seguridad aprobados**. Raíz verificó **2180/2180 unitarias, cero fallos u omisiones**, en 27,43 segundos, log `final-candidate-unit.log`. La aplicación y dependencias no cambiaron desde la compilación aprobada en `fa5787e`; las diferencias posteriores son pruebas y documentación.
- Operador de actualización local aprobado independientemente: SHA-256 `ab0ee28ebff099e5ebabc09f9795706c1237461e36a19c6f04f4c27edc0feecb`, siete pruebas puras aprobadas. La revisión no ejecutó DB ni reemplaza el preflight real.
- Runtime fijado en detached `3a9823a`. Los ocho cambios previos se conservaron con rutas explícitas en stash `97fb0e08d1b1ce8103f06024ef7a3dba0862e853`, además del parche binario y manifiesto anteriores. No se aplicó el stash al candidato, no se borraron fixtures ni volúmenes y no se leyeron archivos de entorno reales.
- Después de la pausa, Docker estaba detenido. El arranque falla por sockets temporales obsoletos de inferencia y del gestor local de secretos; se conservan los directorios temporales antes de reparar el inicio. No es un fallo observado de migraciones o aplicación. El inventario vivo debe volver a comprobarse antes de DDL o activación.
- Los doce casos reales siguen pendientes. Próximo paso: recuperar el motor, preflight de datos/controles conservados, instalación M120/M121 con ledgers y activación separada auditada, seguida de la ejecución sin otras pruebas pesadas.
