# Importación durable de pacientes

M112 (`20260908190255_M112_patient_import_durability.sql`) es aditiva y va después de M109/M111 y antes del código nuevo. No modifica fichas existentes ni activa envíos. La interfaz anterior sigue funcionando durante el intervalo de despliegue. No se aplicó a producción.

El servidor vuelve a leer el CSV y sus columnas; no acepta filas procesadas por el navegador. Cada archivo se identifica por una huella HMAC de sus filas normalizadas, dentro de la organización y ligado al autor original. Volver a cargar el mismo archivo y columnas recupera el mismo run incluso después de recargar la página. No hace falta guardar el CSV o los datos del paciente en el almacenamiento del navegador. Nombres, DNI, teléfono y fecha normalizados participan en la huella; un contacto solo nunca identifica una ficha.

Cada fila tiene un comprobante privado por run, número y huella. La identidad, el paciente y el comprobante se guardan juntos, o se revierten juntos. Si la respuesta se pierde, el siguiente intento recupera el comprobante. La función devuelve hasta veinte filas procesadas por llamada y el navegador continúa por bloques; una interrupción deja visibles los resultados confirmados y permite continuar. Los resultados todavía no confirmados se muestran como pendientes.

La página fija la organización y el miembro esperados. Si otra pestaña cambia la sesión o el consultorio, la acción se detiene antes de escribir. Un run no puede transferirse silenciosamente a otro profesional; un cambio de condición colegiada también detiene nuevas filas.

Antes de cada escritura y consulta de progreso, los RPC verifican MFA, organización viva y membresía aceptada/viva con capacidad actual de crear pacientes: OWNER, DIRECTOR o PROFESIONAL, como M03. No conceden esa capacidad a recepción. Un director no colegiado puede importar, sin asignarse como profesional ni recibir datos clínicos de fichas existentes. Los RPC no están disponibles para anon ni service_role. Las tablas privadas conservan referencias, huellas y códigos categóricos; no guardan el CSV, nombres ni contactos. No se emiten correos, mensajes ni analytics con datos de pacientes. Las organizaciones sintéticas pueden probar la importación local.

La importación no concilia identidades automáticamente. Un DNI existente, un DNI repetido en el archivo o una fila con datos iguales a una importación anterior quedan para revisión. No se reutiliza un paciente por teléfono/correo, no se fusionan fichas y no se modifica a la persona encontrada. Esto también evita recrear las filas ya importadas al cargar un archivo parcialmente corregido. Dos familiares con distinto nombre o DNI pueden compartir contacto. Si dos personas distintas tienen exactamente todos los datos iguales, habrá que revisar su identidad y crear la ficha por el flujo manual apropiado.

La vista previa y los resultados tienen páginas de veinte filas y permiten recorrer el archivo completo. La vista previa dice «Por verificar» porque todavía no consultó coincidencias en Folio. Una fila repetida por DNI muestra el aviso correspondiente incluso en páginas posteriores. Los resultados distinguen importada, revisión, inválida, fallida y pendiente. Un archivo con comillas sin cerrar se rechaza para no juntar accidentalmente datos de distintas personas.

## Pruebas

- `tests/unit/import-durability.test.ts`: action real con I/O controlado, reintento sin DNI, respuesta perdida después de guardar, veinte filas por bloque y rechazo de recepción.
- `tests/unit/import-preview-results.test.ts` y parser: contactos compartidos, DNI repetido, huella normalizada, filas pendientes y CSV incompleto.
- `tests/sql/M112_patient_import_durability.spec.sql`: PostgreSQL 16 real, rollback completo, replay, DNI/revisión, alcance de organización, membresía, director no colegiado y MFA.
- `scripts/testing/patient-import-race.mjs`: dos conexiones reales; mismo archivo, misma fila, desconexión/rollback y dos archivos que compiten por datos iguales. Admite sólo una base dedicada local `folio_test_import_race*` y fixtures sintéticos.
- Fixture temporal `.flow/import-review/browser.cjs`: Chromium con componente real, React StrictMode desarrollo y bundle producción. Preview completo, segunda página con duplicado, doble clic, retry con mismo identificador y resultados completos. RED inicial: ocho filas visibles en vez de veinte; GREEN posterior.

## Límites

Sólo las importaciones hechas por esta versión tienen comprobantes. Una carga antigua sin DNI y sin recibos requiere revisión manual antes de reenviarla; no se infiere su identidad por contacto.

Auth/PostgREST reales y un deploy completo de Next no se probaron: los tests SQL usan JWT/roles sintéticos y la fixture de navegador sustituye las actions. Un fallo definitivo de una fila queda registrado; para corregirla se modifica el archivo, se revisan las coincidencias y se procesa la nueva versión. El sistema no decide si dos identidades clínicas deben fusionarse. Las huellas de recuperación dependen de la clave HMAC estable; una rotación debe migrarlas como parte del procedimiento de claves. La prueba focal de M112 no sustituye el replay global del conjunto de migraciones ni la validación del piloto con datos autorizados.
