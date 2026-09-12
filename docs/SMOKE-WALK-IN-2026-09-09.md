# Smoke del recorrido walk-in — 9 de septiembre de 2026

El usuario pidió una comprobación corta de ingreso sin turno, atención, guardado, cobro y reapertura. Se ejecutó con datos inventados y conexiones externas bloqueadas. **Es una comprobación por componentes y contratos; no un recorrido autenticado completo contra una base real.** No se usaron claves, pacientes, cobros ni correos reales.

## Hallazgos reproducidos y corrección

El nuevo navegador usa `TurnoCreateModal`, React y el CSS reales. Las respuestas del servidor se controlan para reproducir interrupciones. En desarrollo y producción reprodujo cuatro problemas:

- Dos clics en la misma tarea enviaban dos solicitudes de creación.
- Un clic en el fondo cerraba el formulario mientras la creación seguía pendiente.
- Una excepción al cargar datos dejaba el formulario indefinidamente en «Cargando datos».
- Una respuesta perdida al crear propagaba una excepción y dejaba al usuario sin recuperación.

La corrección serializa los envíos con una referencia síncrona, bloquea todas las salidas mientras espera, ofrece reintento de la carga inicial y conserva el formulario ante una respuesta incierta. En ese último caso bloquea otro envío y ofrece «Revisar agenda», que solicita datos frescos y navega al calendario de la fecha y profesional enviados, incluso desde una ficha o el directorio. Cambios posteriores del formulario no alteran ese destino. No afirma que el turno no se creó: el servidor pudo guardar antes de perder la respuesta.

El primer intento del harness tuvo un problema propio de codificación UTF-8; se corrigieron los encabezados HTTP antes de obtener la reproducción válida. La reproducción válida registró **ocho fallos y dos aprobaciones** (cinco escenarios en dos modos). El componente corregido pasó los mismos diez escenarios; la revisión añadió comprobación de los controles de recuperación: **14/14 aprobados** al finalizar. No se cambiaron base, precios ni proveedores.

## Evidencia y límites

- Navegador de agenda: **16 escenarios aprobados** sobre llegadas, atención, cierre, cobro rechazado, respuestas atrasadas, cancelación y solicitudes simultáneas.
- Pruebas focales de agenda/cobro: **30 aprobadas**.
- Pruebas focales de ficha/guardado/lectura en la rama de preparación `codex/market-ready`: **114 aprobadas**. Conservan cambios tardíos, bloquean cierre adelantado, confirman operaciones inciertas con el mismo identificador y comprueban SOAP/enmiendas con claves sintéticas. Las operaciones de base están simuladas. Estas comprobaciones incluyen controles aún no publicados; no certifican el guardado clínico del despliegue actual.
- Navegador de creación: `node tests/hoy/run-isolated.mjs browser-create`. Usa zona `America/Argentina/Cordoba`, pacientes nuevos inventados, éxito, doble clic, cierres pendientes, carga fallida, respuesta perdida y error de validación.

Los logs locales están en `.flow/smoke-20260909-*` y los resultados del navegador en las carpetas temporales `folio-walkin-browser-*` / `folio-create-smoke-*`. La nueva comprobación de creación forma parte de App CI.

**Pendiente importante:** la creación manual de paciente y turno todavía usa varias operaciones en servidor. Un conflicto después de crear al paciente puede dejarlo creado aunque el turno falle. La protección del formulario no reemplaza una transacción e idempotencia de servidor ni cubre reintentos desde otra pestaña. Esa corrección, la persistencia real al reabrir y el recorrido con Auth/RLS requieren el entorno integral previsto en el plan.
