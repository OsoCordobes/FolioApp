# Folio: goal de confiabilidad para lanzamiento

Fecha de inicio: 12 de septiembre de 2026. Seguimiento en la tarea `01a09720-6c99-71a1-9160-84dc002c19bb`.

## Resultado buscado

Un candidato de lanzamiento revisable en el que el recorrido **paciente sin turno → atención → guardar consulta → registrar cobro → volver a entrar y reabrir** conserve los datos, detecte conflictos y permita recuperarse de interrupciones sin duplicar operaciones ni anunciar éxitos no comprobados.

La entrega debe incluir correcciones implementadas, pruebas reproducibles, revisión independiente y condiciones explícitas de publicación. La reanudación del 19 de septiembre permite continuar las verificaciones y preparar el corte para merge cuando esté listo. Un candidato probado localmente no equivale a un lanzamiento público aprobado.

### Ajuste de cierre solicitado por el usuario — 13 de septiembre

Después de run-13, el usuario indicó: «no repitas mas recorrido. cierra cuando termines estas tareas importantes» y luego «cierra y pushea / mergea!». En ese cierre se completaron las correcciones y verificaciones puntuales, conservando run-13 con **6 aprobados / 6 fallidos**, y se entregó una PR en borrador sin nueva campaña. Esa restricción histórica quedó sustituida el 19 de septiembre por la autorización renovada para continuar y fusionar cuando estén cumplidos los requisitos. Run-14 y el ensayo enfocado posterior se registran abajo; no convierten run-13 retroactivamente en aprobado.

## Entorno y coordinación

- Copia propia: `C:/Users/amiun/Documents/Codex/folio-reliability`.
- Rama: `codex/launch-reliability`; base fija: `11f020685f15cd65be61b030e1f628d2ad6a6941` de `codex/market-ready`.
- `master` observado al inicio: `2dae580`. La base contiene trabajo previo aún no integrado; revisar esas dependencias antes de publicar. No se presenta como una rama basada únicamente en producción.
- Checkpoint combinado `34dc605`: incorporó la visual publicada observada en `28ab28a` y los consumidores de servidor revisados. El corte posterior `3a9823a` también contiene la UI y el ensayo revisados. La fuente final `17a3770` contiene **117 migraciones, 25 nuevas frente a `28ab28a`**: M98–M117 y M119–M123. El último cambio de aplicación es `6a75cc1`. El [manifiesto](LAUNCH-RELIABILITY-MIGRATIONS.md) documenta esa comparación y el inventario posterior de producción, obtenido en sólo lectura.
- La tarea visual trabaja en `C:/Users/amiun/Documents/Codex/folio-experience`, rama `codex/folio-experience`, servidor 4410. No modificar su copia ni detener su servidor.
- Priorizar lógica de servidor, persistencia y pruebas. Registrar cualquier contrato o componente compartido que necesite integración con la rama visual.
- Datos exclusivamente sintéticos. No leer `.env.local` para ejecutar pruebas. Conservar los bloqueos de red y credenciales del entorno de ensayo.
- `vercel.json` desactiva el despliegue automático por Git de `codex/launch-reliability`, además de la rama heredada `codex/market-ready`, para poder entregar la revisión sin desplegar el candidato. Es la configuración documentada de [Vercel por rama](https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled); no bloquea una invocación manual de despliegue ni autoriza integrar en master.

## Iteraciones y criterios de cierre

| Iteración | Trabajo | Evidencia necesaria para cerrar |
|---|---|---|
| 1. Diagnóstico reproducible | Inventariar protecciones y ramas; ejecutar base; reproducir riesgos de cierre/cobro y preparar el ensayo clínico | Contratos y casos documentados; resultados vinculados al código; fallos demostrados antes de corregir |
| 2. Corrección y recuperación | Resolver operaciones parciales, éxitos falsos, respuestas perdidas y conflictos simultáneos | Cada defecto tiene prueba de fallo, corrección y repetición satisfactoria; los datos anteriores se conservan |
| 3. Recorrido completo | Probar guardado, cierre, cobro y reapertura, con negativos de acceso y servicios reales locales | Supabase Auth/MFA y Storage reales; conteos y contenido persistidos; pruebas sin omisiones; distinguir registro de efectivo de Mercado Pago |
| 4. Candidato de lanzamiento | Revisión independiente, verificaciones pertinentes e integración preparada | Cero defectos críticos/altos abiertos dentro del alcance; evidencia de la revisión exacta; migraciones y compatibilidad ordenadas; checklist de publicación con pendientes externos |

Cada vuelta: **reproducir → priorizar → corregir la causa → verificar → revisar → guardar avance**. Completar primero este recorrido; ampliar el alcance sólo ante un riesgo concreto que impida su confiabilidad o el lanzamiento.

## Hallazgos iniciales

1. `transitionTurno` actualiza el turno y registra el pago en solicitudes distintas. Si falla el pago, puede quedar cerrado sin movimiento financiero. La instrucción de recuperarlo en Finanzas no corresponde a una acción de alta de pago disponible.
2. `marcarPagoCobradoAction` sólo comprueba el error del UPDATE; no verifica las filas modificadas. Cero filas puede significar pérdida de permiso, no sólo que otra persona ya cobró.
3. El conteo final de `tests/e2e/clinical-path.spec.ts` filtra `pago.organization_id`, columna inexistente. La organización se obtiene mediante `pago.turno_id → turno.organization_id`.
4. El ensayo clínico usa el puerto 4410, ocupado por la tarea visual. Preparar un puerto dedicado y mantener las comprobaciones de aislamiento.

Estos hallazgos vienen de lectura de código al inicio. La reproducción y la evidencia de cada corrección se registran por separado; no se declaran errores observados en producción.

## Avance comprobado al 19 de septiembre

- El baseline de 113 migraciones aprobó **7/7** con Auth/MFA/Storage reales locales. Ese resultado histórico no cubre M120/M121. El candidato de 115 migraciones se ejecutó en tres campañas: **run-11, 2 aprobados y 10 fallidos; run-12, 4 aprobados y 8 fallidos; run-13, 6 aprobados y 6 fallidos**, todas sin omisiones. Se conservan separadas de la evidencia posterior de run-14 y run-16; no hay una campaña única 12/12 aprobada.
- La UI de cierre/recuperación recibió aprobación independiente en `8a802e0`, con **36/36 pruebas de navegador aisladas**. El arreglo horario `c57f8f2` recibió revisión independiente y aprobó **50/50 escenarios de creación/reagendado/pedidos**, además de la compilación aislada con exit 0. Los 16 avisos heredados de instrumentación no acreditan observabilidad desplegada. Run-12 comprobó que los diez turnos creados conservaban la fecha y hora completas entre formulario y SQL, resolviendo el desajuste detectado en run-11.
- El candidato de pruebas `280ef18c2663a85fd9fd54698f68f338623c1362` conserva la aplicación de `c57f8f2` y modifica sólo ocho archivos de pruebas. Corrige el selector de cobro y la vinculación del identificador de acción de Next, y agrega observación sanitizada de llegada y Auth sin ampliar plazos ni reintentar. Su revisión independiente, tipos y lint completos aprobaron, junto con **2212/2212 unitarias**, **20/20 comprobaciones de seguridad**, **5 diagnósticos Auth** y **7 de llegada**. Estas pruebas no acreditan el recorrido real.
- El operador local histórico fue aprobado con digest `ab0ee28ebff099e5ebabc09f9795706c1237461e36a19c6f04f4c27edc0feecb` y **7/7 pruebas puras**. Instaló M120/M121 con sus registros canónicos y activó sus controles en una transacción separada: el corte del 13/09 quedó en 115 migraciones y nueve controles. Se conservaron filas, registros y volúmenes; las cinco rutas RPC rechazaron a anon con `42501`. Las activaciones conservan la revisión original `3a9823a` y no se repiten por cambios de código.
- Run-12 encontró seis fallos del selector/observador corregidos en `280ef18`, además de una llegada sin transición persistida y un rechazo de Auth inicial sin causa demostrada en esa ejecución. Run-13 terminó en 8 minutos sobre `280ef18`: aprobaron AAL1/portal, aislamiento y archivos, archivo con suscripción pausada, revocación y respuestas perdidas de CLOSE/RESOLVE. Quiropraxia y cardiología completaron cobro y reapertura, pero falló la limpieza del observador. Psicología y el caso M121 fallaron al comprobar el aviso de cierre clínico; M121 no alcanzó el saldo. ASISTENTE/COORDINADOR autenticaron sus roles y alcances, pero la agenda operacional quedó vacía.
- Los arreglos posteriores tienen revisión independiente y evidencia focal: limpieza única del observador en `57cfd03` (**27/27**), confirmación de cierre propio en `dfc4af6` (**12/12 navegador y 13/13 unitarias**) y lectura de Hoy en `6a75cc1` (**22/22 unitarias**). M122 restituye la lectura operacional sin abrir clínica; M123 en `17a3770` impide además que COORDINADOR consulte pagos por SELECT directo. Los controles finales de aplicación aprobaron **2231/2231 unitarias, tipos, lint y compilación aislada**, con los 16 avisos heredados de instrumentación.
- GitHub aprobó el **replay completo de 117 migraciones / 65 specs** sobre `cae1a3d` el 13/09, después de la evidencia local 116/64 y la regresión focal M123. El 19/09 el operador de recepción, con **14/14 pruebas puras**, instaló M122/M123 y ambos registros canónicos en una transacción local. El preflight por conexión nueva confirmó 117 versiones, 21 tablas conservadas, dos volúmenes, nueve controles y auditoría original `3a9823a`, sin reactivaciones.
- Run-14 sobre `cae1a3da3d2586ce1d5a2ee7283723796481694c` terminó con **11 aprobados y 1 fallido**. El selector CSS de COORDINADOR coincidió con dos filas; el snapshot mostró una fila accesible y no establece la causa del segundo nodo. `8f9014cc2ae0d69ffce766555912337cce610669` cambia sólo esa selección a rol/nombre accesibles con conteo uno; pasó revisión independiente, tipos y lint, preservando producto `6a75cc1`, SQL `17a3770` y las negativas financieras.
- Run-15 enfocado falló durante la preparación OWNER, antes de comprobar COORDINADOR: el cierre clínico se confirmó en SQL a las 15:30:21 UTC, pero la pantalla seguía en «Guardando», sin aviso a los 30 segundos y aún pendiente a los 42. La causa sigue sin establecerse; no se repitió esa escritura a ciegas. La auditoría posterior conserva cero sesiones Auth propias, 23 anteriores, nueve controles y cero cargos/autoridades temporales.
- Run-16 instrumentado sobre `8f9014c` aprobó **1/1, COORDINADOR**, en 50,1 s de prueba y 1,1 min total. Junto a los once escenarios aprobados en run-14 aporta **evidencia combinada de los doce escenarios**, conservando la misma aplicación `6a75cc1` y SQL `17a3770`. No reprodujo ni explicó la demora de run-15. Las huellas de los datos anteriores y las activaciones se conservaron; quedaron cero sesiones Auth propias y cargos/autoridades temporales. Se restauraron exactamente siete archivos y se retiraron dos auxiliares de instrumentación, con diff tracked vacío en el runtime. La [entrega](LAUNCH-RELIABILITY-DELIVERY.md) distingue los resultados y sus límites.
- Se autenticó una copia cifrada nueva el 19/09 a las 15:27:05 UTC con el runtime privado v3: tres copias conservadas y cero eliminadas, sin escrituras productivas. No acredita restauración integral ni custodia externa.

## Pendientes del candidato y condiciones de publicación

- Conservar la demora de run-15 como límite sin causa establecida: el PASS focal de run-16 no la explica. Mantener la evidencia combinada de doce escenarios y los ensayos anteriores separados; no declarar 12/12 en una sola campaña.
- Completar las dependencias antes del merge autorizado: producción tiene 92 migraciones y le faltan las 25 del candidato, además de activaciones y consumidores compatibles. La PR #165 ya está abierta; integrar en `master` desplegaría automáticamente el código.
- Validar acceso y recuperación de cuenta, reserva pública, comunicaciones y pagos de proveedor en entorno autorizado; el registro de efectivo no cubre la suscripción de Folio.
- Completar la restauración integral, responsables de soporte y validaciones profesionales/comerciales aplicables. Esta goal no certifica por sí sola estos requisitos.

## Evidencia inicial

- Dependencias instaladas desde caché con lockfile fijo, sin archivos de entorno en esta copia.
- `pnpm test:unit`: **2111 aprobadas, 0 fallidas, 0 omitidas**, sobre la base 11f0206. Log local: `.flow/launch-reliability/baseline-unit.log`.
- Se preparó PostgreSQL16 dedicado en loopback 55439 para los ensayos SQL; esa evidencia usa stubs de Auth/Storage.
- Estado de avance y próximas acciones: [registro de iteraciones](LAUNCH-RELIABILITY-LOG.md).

## Dependencia de instalación y activación

La actualización histórica de 92 migraciones publicadas a 115 pasó en PostgreSQL16 local, incluso con M118 instalada antes de las 23 faltantes de ese corte. Esto acredita aquel orden sobre una base sintética nueva; no verifica producción ni incluye M122/M123. La fuente final tiene 117 migraciones. El preflight productivo de sólo lectura del 19/09, entre 15:14 y 15:18 UTC, confirmó 92 versiones y las 25 ausentes. Evidencia local: `.flow/launch-reliability/production-preflight-20260919.json` y `production-rollout-analysis.md`. No hubo DDL ni activaciones productivas ni merge.

El orden operativo requiere **escritor clínico compatible → M106 activa → exponer los nuevos consumidores de cierre → M120 activa → M121 activa**. El puente `efe19c68c849696d7d66bc8a43014ac494eb3310`, despliegue `dpl_J7Pk9fWqzTF1aCyucVWmjMgz9YN6`, está READY en gru1, sin promoción al dominio publicado. Su comprobación anónima respondió health 200, login 200 y Hoy 307 hacia login; el dominio publicado mantuvo health 200. Eso no acredita escrituras autenticadas ni el corte. El CLOSE nuevo exige M106 aunque el guard M120 esté apagado; aplicar los archivos con controles apagados y desplegar el final no basta. Hoy necesita M122 antes del código dependiente y la frontera financiera requiere M123. Las activaciones heredadas conservan sus propias condiciones. La ejecución y verificación de ese corte productivo siguen pendientes.
