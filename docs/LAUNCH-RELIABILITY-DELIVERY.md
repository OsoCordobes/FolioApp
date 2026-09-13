# Candidato de confiabilidad — entrega de revisión

Entrega local al 13 de septiembre de 2026. El usuario pidió terminar las correcciones importantes, no repetir el recorrido y subir la entrega. Run-13 permanece con **6 aprobados y 6 fallidos**; sus defectos identificados se corrigieron y verificaron de forma focal. No se ejecutó run-14 ni se declara el recorrido final 12/12 aprobado. El lanzamiento público y el merge siguen bloqueados por dependencias productivas pendientes.

## Qué cambia para quien usa Folio

- Guardar y cerrar la consulta confirma la escritura clínica sin inventar un cobro. La decisión financiera se registra explícitamente desde agenda.
- Cerrar un turno con una decisión financiera confirma ambos cambios en una transacción. Si se pierde la respuesta, la interfaz conserva la solicitud y permite consultar el resultado o repetir exactamente la misma operación.
- Marcar un pago como cobrado conserva su identidad, importe y fecha de cobro original al reintentar. La base vuelve a comprobar los permisos al obtener los bloqueos necesarios.
- Un resultado incierto mantiene el diálogo y evita ediciones o duplicaciones. Los recibos históricos no sustituyen los permisos ni el estado financiero actuales.
- ASISTENTE puede recuperar un cobro desde agenda dentro de su alcance. COORDINADOR conserva su acceso operativo sin recibir datos o controles financieros.
- Crear, reagendar y elegir otro horario en pedidos muestran e interpretan la hora del consultorio, incluso cuando la computadora está en otra zona. Los reintentos conservan el horario original.

## Código y dependencias

Rama `codex/launch-reliability`, copia aislada `C:/Users/amiun/Documents/Codex/folio-reliability`. Fuente final `17a377039e9f9812d80d23593c851a6fe86bf7de`; aplicación `6a75cc1`, confirmación del cierre propio `dfc4af6`, retirada única de observadores `57cfd03` y zona horaria `c57f8f2`.

La rama incluye la preparación heredada de `11f020685f15cd65be61b030e1f628d2ad6a6941` y la visual publicada observada en `28ab28a93798b09c2a4e092e9cceb0f163262f9e`. Tiene **117 migraciones, 25 altas** frente a esa referencia. La consulta productiva de sólo lectura del 13 de septiembre confirmó **92 versiones** y ausencia de MFA, M106, M120, M121 y M122. El [manifiesto](LAUNCH-RELIABILITY-MIGRATIONS.md) enumera las versiones y el [procedimiento de publicación](LAUNCH-RUNBOOK.md) ordena instalación, código y activaciones. M122 recupera la agenda de Hoy para recepción sin abrir la historia clínica; M123 impide a COORDINADOR leer pagos también por acceso directo.

## Evidencia verificada

| Comprobación | Resultado y revisión exacta | Límite |
|---|---|---|
| Unidades del candidato | 2231/2231, cero fallos u omisiones, aplicación final `6a75cc1` | No ejecutan el recorrido con servicios reales |
| Tipos y lint | Completos sobre la aplicación final `6a75cc1` | El cliente Supabase `any` requiere cotejar SQL por separado |
| Interfaz de cierre y recuperación | 36/36 escenarios de navegador, modos desarrollo y producción, `8a802e0` | Las respuestas de estos escenarios son controladas |
| Formularios y zonas horarias | 26/26 creación y 24/24 reagendado/pedidos, desarrollo y producción, `c57f8f2` | Navegador Auckland, organización Córdoba, reloj fijo y respuestas controladas; no son la campaña de Auth/Storage |
| Retirada de observadores | RED 7 fallos → GREEN 27/27 en `57cfd03` | Incluye 7 regresiones nuevas y 20 controles de seguridad; no repite el recorrido |
| Confirmación de cierre propio | RED 6 fallos → GREEN 12/12 de navegador y 13/13 unidades en `dfc4af6` | Navegador desarrollo/producción con respuestas controladas |
| Recepción y lectura de pagos | 22/22 unidades del lector; SQL M122 y M123 con roles, alcance, MFA y revocación | No certifica la pantalla de Calendario ni una nueva sesión integrada del candidato final |
| Compilación aislada | Exit 0 sobre la aplicación final `6a75cc1` | 16 avisos heredados de instrumentación; no acredita observabilidad desplegada |
| SQL cronológico | 116 migraciones y 64 archivos de pruebas aprobados; después M123 focal y cinco specs afectadas aprobadas | PostgreSQL 16 con stubs; no se afirma replay completo de 117/65 |
| Orden de actualización | 92 migraciones de `28ab28a`, luego las 23 faltantes de `34dc605` y 63 archivos de pruebas aprobados | Base sintética propia; no datos productivos |
| Concurrencia | M120 8/8, M121 6/6, conexiones reales de PostgreSQL | No prueba latencia ni carga de producción |
| Recorrido clínico anterior | 7/7 con Auth/TOTP/Storage reales locales, run-10 | Baseline de 113 migraciones, anterior a M120/M121 |
| Último recorrido integrado | Run-13: 6 aprobados, 6 fallidos, 0 omitidos en `280ef18` | Runtime de 115 migraciones; no se repitió tras los arreglos finales por indicación del usuario |

Las revisiones independientes de SQL, consumidores, interfaz y observación de respuestas perdidas quedaron aprobadas. Los fallos intermedios y su corrección se conservan en el [registro de iteraciones](LAUNCH-RELIABILITY-LOG.md); los informes detallados permanecen en `.flow/launch-reliability/` de la copia de trabajo.

## Qué falta para publicar

La instancia sintética permanece en `280ef18`, 115 migraciones y nueve controles activos. M122/M123 no se instalaron allí. Run-13 aprobó AAL1, aislamiento/archivos, archivo pausado, revocación y recuperación real de CLOSE/RESOLVE. Quiropraxia y cardiología completaron pago y reapertura, pero fallaron en limpieza del observador. Psicología y el prerrequisito de M121 fallaron en la confirmación visual; recepción encontró la agenda vacía. Esos resultados se conservan sin convertirlos retroactivamente en aprobados. La auditoría posterior confirmó cero sesiones propias, 23 anteriores preservadas y cero cargos de proveedor/autoridades temporales. Las activaciones mantienen su registro original `3a9823a`; no se acredita restauración integral.

Para publicar después, hace falta resolver las 25 migraciones ausentes en producción, revisar sus datos y compatibilidad e identificar la revisión intermedia del escritor M106 y la versión de retorno. Fusionar ahora en `master` desplegaría código que necesita funciones todavía inexistentes. El corte debe seguir el runbook; queda pendiente la verificación integrada del candidato corregido. Calendario también comparte la vista clínica que excluye recepción y queda fuera del arreglo de Hoy: no ofrecerlo a esos roles sin verificar/corregir su acceso. Las pruebas de efectivo no certifican Mercado Pago, correo ni otros proveedores. Restauración integral, validaciones profesionales, soporte y campaña alojada de acceso/carga conservan su propia evidencia pendiente.

Esta tarea no aplicó migraciones en producción, no desplegó ni realizó cargos reales. El despliegue automático por Git de esta rama está desactivado para conservar una entrega revisable; integrar en `master` requiere completar el procedimiento de publicación.
