# Candidato de confiabilidad — entrega de revisión

## Corte productivo del 19 de septiembre, 17:43 UTC

Producción ya tiene las **117 migraciones canónicas**: expansión 92→113 y cierre 113→117 confirmados en transacciones separadas, con verificación posterior y conservación de las columnas y registros anteriores auditados. M106 está activa desde las 17:33:53 UTC. El puente aprobó ingreso, guardado, recuperación de respuesta perdida, cierre y reapertura tanto antes como después de esa activación.

La conexión Upstash quedó reparada reemplazando solamente sus dos variables productivas; las otras 93 entradas se conservaron y el par nuevo tiene respaldo cifrado separado. Vercel Pro está activo; el candidato programa recordatorios y correo cada minuto y conciliación cada 15 minutos. La entrega global de correo sigue desactivada.

El candidato `0e38ce8` quedó publicado en `foliosalud.com` a las 17:42 UTC. Su ensayo confirmó cierre y registro de un único pago ficticio pendiente, pero se detuvo antes de marcarlo cobrado: el botón «Listo» podía aparecer mientras la actualización del estado seguía ocupada e ignorar un clic temprano. La corrección conserva el estado pendiente hasta terminar esa lectura. M120/M121 y la comprobación final de cobro seguían pendientes al redactar este corte; no se presenta ese ensayo parcial como aprobado.

El **resultado definitivo del merge, activaciones y despliegue** se registra en la [PR #165](https://github.com/OsoCordobes/FolioApp/pull/165). Las secciones siguientes conservan la evidencia de preparación anterior al corte; sus bloqueos históricos no sustituyen ese registro final.

Preparación local documentada el 19 de septiembre de 2026, antes del corte productivo anterior. El usuario reanudó el trabajo y autorizó continuar hasta dejar listo el merge. El corte local tiene **117 migraciones y nueve controles activos**. Run-14 aprobó once escenarios y run-16 aprobó el caso enfocado de COORDINADOR: hay **evidencia combinada de los doce escenarios**, sin una campaña única 12/12 aprobada. Run-15 falló en la preparación OWNER y la causa de su demora sigue sin establecerse. En ese momento el corte productivo y el merge estaban pendientes.

## Qué cambia para quien usa Folio

- Guardar y cerrar la consulta confirma la escritura clínica sin inventar un cobro. La decisión financiera se registra explícitamente desde agenda.
- Cerrar un turno con una decisión financiera confirma ambos cambios en una transacción. Si se pierde la respuesta, la interfaz conserva la solicitud y permite consultar el resultado o repetir exactamente la misma operación.
- Marcar un pago como cobrado conserva su identidad, importe y fecha de cobro original al reintentar. La base vuelve a comprobar los permisos al obtener los bloqueos necesarios.
- Un resultado incierto mantiene el diálogo y evita ediciones o duplicaciones. Los recibos históricos no sustituyen los permisos ni el estado financiero actuales.
- ASISTENTE puede recuperar un cobro desde agenda dentro de su alcance. COORDINADOR conserva su acceso operativo sin recibir datos o controles financieros.
- Crear, reagendar y elegir otro horario en pedidos muestran e interpretan la hora del consultorio, incluso cuando la computadora está en otra zona. Los reintentos conservan el horario original.

## Código y dependencias

Rama `codex/launch-reliability`, copia aislada `C:/Users/amiun/Documents/Codex/folio-reliability`. Fuente SQL `17a377039e9f9812d80d23593c851a6fe86bf7de`; aplicación `6a75cc1`, confirmación del cierre propio `dfc4af6`, retirada única de observadores `57cfd03` y zona horaria `c57f8f2`. Run-14 usó `cae1a3da3d2586ce1d5a2ee7283723796481694c`; `8f9014cc2ae0d69ffce766555912337cce610669` cambia sólo la selección de la fila accesible de COORDINADOR en la prueba, sin modificar producto ni SQL.

La rama incluye la preparación heredada de `11f020685f15cd65be61b030e1f628d2ad6a6941` y la visual publicada observada en `28ab28a93798b09c2a4e092e9cceb0f163262f9e`. Tiene **117 migraciones, 25 altas** frente a esa referencia. El preflight productivo de sólo lectura del 19/09, entre 15:14 y 15:18 UTC, confirmó **92 versiones y 25 ausentes**. El [manifiesto](LAUNCH-RELIABILITY-MIGRATIONS.md) enumera las versiones y el [procedimiento de publicación](LAUNCH-RUNBOOK.md) ordena instalación, código y activaciones. M122 recupera la agenda de Hoy para recepción sin abrir la historia clínica; M123 impide a COORDINADOR leer pagos también por acceso directo.

## Evidencia verificada

| Comprobación | Resultado y revisión exacta | Límite |
|---|---|---|
| Unidades del candidato | 2231/2231, cero fallos u omisiones, aplicación final `6a75cc1` | No ejecutan el recorrido con servicios reales |
| Tipos y lint | Aplicación final `6a75cc1` y corrección de prueba `8f9014c` aprobadas | El cliente Supabase `any` requiere cotejar SQL por separado |
| Interfaz de cierre y recuperación | 36/36 escenarios de navegador, modos desarrollo y producción, `8a802e0` | Las respuestas de estos escenarios son controladas |
| Formularios y zonas horarias | 26/26 creación y 24/24 reagendado/pedidos, desarrollo y producción, `c57f8f2` | Navegador Auckland, organización Córdoba, reloj fijo y respuestas controladas; no son la campaña de Auth/Storage |
| Retirada de observadores | RED 7 fallos → GREEN 27/27 en `57cfd03` | Incluye 7 regresiones nuevas y 20 controles de seguridad; no repite el recorrido |
| Confirmación de cierre propio | RED 6 fallos → GREEN 12/12 de navegador y 13/13 unidades en `dfc4af6` | Navegador desarrollo/producción con respuestas controladas |
| Recepción y lectura de pagos | 22/22 unidades del lector; SQL M122/M123; ASISTENTE aprobado en run-14 y COORDINADOR en run-16 | Evidencia local; no certifica Calendario |
| Compilación aislada | Exit 0 sobre la aplicación final `6a75cc1` | 16 avisos heredados de instrumentación; no acredita observabilidad desplegada |
| SQL cronológico | **117 migraciones / 65 specs aprobadas** en GitHub sobre `cae1a3d`, 13/09; conserva la evidencia anterior de `19c08d0` | PostgreSQL16 con stubs y checks predeterminados; no acredita servicios ni datos productivos |
| Orden de actualización | 92 migraciones de `28ab28a`, luego las 23 faltantes de `34dc605` y 63 archivos de pruebas aprobados | Base sintética propia; no datos productivos |
| Concurrencia | M120 8/8, M121 6/6, conexiones reales de PostgreSQL | No prueba latencia ni carga de producción |
| Recorrido clínico anterior | 7/7 con Auth/TOTP/Storage reales locales, run-10 | Baseline de 113 migraciones, anterior a M120/M121 |
| Corte local M122/M123 | 115 → 117 en una transacción, preflight posterior por conexión nueva aprobado el 19/09 | Conservó 21 tablas, dos volúmenes, nueve controles y auditoría original `3a9823a`; no es producción |
| Último recorrido integrado completo | Run-14: **11 aprobados y 1 fallido** en `cae1a3d`, con 117 migraciones | Falló la selección CSS de la fila de COORDINADOR; no es 12/12 |
| Primer intento enfocado de COORDINADOR | Run-15 en `8f9014c`: **falló en la preparación OWNER** | No llegó a los controles de COORDINADOR; cierre SQL confirmado, demora de UI sin causa establecida |
| Comprobación enfocada de COORDINADOR | Run-16 instrumentado en `8f9014c`: **1/1 aprobado**, 50,1 s de prueba y 1,1 min total | No reprodujo la demora de run-15; instrumentación retirada y bytes originales restaurados |
| Respaldo cifrado | Captura autenticada el 19/09 a las 15:27:05 UTC; tres copias conservadas, cero eliminadas | No demuestra restauración integral ni custodia externa |

Las revisiones independientes de SQL, consumidores, interfaz y observación de respuestas perdidas quedaron aprobadas. Los fallos intermedios y su corrección se conservan en el [registro de iteraciones](LAUNCH-RELIABILITY-LOG.md); los informes detallados permanecen en `.flow/launch-reliability/` de la copia de trabajo.

## Qué falta para publicar

M122/M123 ya están instaladas en la instancia sintética. Run-14 falló porque el selector CSS coincidió con dos filas, mientras el snapshot mostró una sola fila accesible; la evidencia no establece la causa del segundo nodo. La prueba corregida exige rol/nombre accesibles y exactamente una coincidencia, preservando los controles financieros negativos, RPC/REST e invariantes. Run-15 falló antes de esos controles: el cierre OWNER se confirmó en SQL a las 15:30:21 UTC, pero la UI siguió en «Guardando» sin el aviso durante 30 segundos y continuaba pendiente en la captura a los 42 segundos. Su causa sigue sin establecerse; no se repitió esa escritura a ciegas. Run-16 aprobó el caso enfocado con un fixture nuevo, sin cambios de producto ni SQL. Esto completa la evidencia combinada de doce escenarios, conservando los fallos de run-14/run-15 y el resultado histórico de run-13.

La auditoría posterior a run-14 confirmó 16 cuentas y 16 factores TOTP nuevos, cero sesiones Auth propias y 23 anteriores preservadas. Totales: 40 sesiones clínicas, 17 pagos, 21 documentos y 21 objetos Storage, 27 registros de cierre y 13 recibos; cero cargos de proveedor y autoridades temporales. Las nueve protecciones y la auditoría original `3a9823a` se mantienen.

Después de run-15 quedaron dos cuentas/TOTP nuevos sin sesiones propias y las 23 anteriores preservadas; 41 sesiones clínicas, 17 pagos, 21 documentos/objetos, 28 cierres y 13 recibos, con cero cargos/autoridades. El turno OWNER quedó CERRADO, requiere registro administrativo y no agregó un pago.

Después de run-16 quedaron dos cuentas/TOTP nuevos, cero sesiones propias y las 23 anteriores; 42 sesiones clínicas, 18 pagos, 21 documentos/objetos, 29 cierres y 14 recibos, con cero cargos/autoridades. Las huellas de los datos anteriores y las activaciones coincidieron; siguen las 117 migraciones y nueve controles. La promesa de CLOSE se resolvió en 2.476 ms, después de persistir el cierre, pero no se capturaron tiempos internos del servidor que expliquen run-15. Se restauraron exactamente siete archivos y se retiraron dos auxiliares, con diff tracked vacío en el runtime. Evidencia: `.flow/runtime-evidence/run-16-post-audit.json`, `run-16-retained-post.json`, `run-16-gates-audit.json` y `run-16-instrumentation/restored.json` del runtime clínico.

Para publicar, hace falta resolver las 25 migraciones ausentes en producción y verificar compatibilidad, activaciones y retorno. El puente del escritor M106, `efe19c68c849696d7d66bc8a43014ac494eb3310`, tiene despliegue `dpl_J7Pk9fWqzTF1aCyucVWmjMgz9YN6` **READY en gru1, sin promoción al dominio publicado**. La comprobación anónima dio health 200, login 200 y Hoy 307 hacia login; el health del dominio publicado también respondió 200. No hubo comprobación autenticada de escritura ni corte productivo. Evidencia: `.flow/launch-reliability/bridge-anonymous-smoke-20260919.json`. Fusionar con las dependencias ausentes desplegaría código que necesita funciones inexistentes; el corte debe seguir el runbook. Calendario también comparte la vista clínica que excluye recepción y queda fuera del arreglo de Hoy: no ofrecerlo a esos roles sin verificar/corregir su acceso. Las pruebas de efectivo no certifican Mercado Pago, correo ni otros proveedores. Restauración integral, validaciones profesionales, soporte y campaña alojada de acceso/carga conservan su propia evidencia pendiente.

Al corte de preparación de esta sección todavía no se habían aplicado DDL ni activaciones productivas. Esa situación fue superada por los hitos documentados arriba. El despliegue automático por Git de esta rama está desactivado; los cargos reales y la habilitación de proveedores no forman parte de los ensayos sintéticos.

## Recepción de la PR

La [PR #165](https://github.com/OsoCordobes/FolioApp/pull/165) se abrió en borrador
con el commit documental `19c08d08111d8ef77515e54df2582e95d1e20e7a`, sin auto-merge.
El [control SQL de GitHub](https://github.com/OsoCordobes/FolioApp/actions/runs/34766930893/job/103749446911)
aprobó las117migraciones y65specs a las15:55UTC del13/09. Supabase Preview también
aprobó su control automático; eso no actualiza el ledger productivo.
El primer control de aplicación falló en el inspector de PDF sintético después
de aprobar tipos, lint, unidades y los cuatro navegadores aislados. Su error
`Z_BUF_ERROR` procede de la lectura del stream comprimido; el registro de
iteraciones conserva la corrección y su verificación posterior.
El inspector ahora lee la longitud declarada, preservando los bytes comprimidos.
La regresión reprodujo el error anterior; después aprobaron cuatro documentos
sintéticos reales, incluida una sesión de ocho páginas con540marcadores.
