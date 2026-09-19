# Directorio de pacientes: paginación y búsqueda (M114)

## Comportamiento y alcance

El directorio muestra 50 pacientes por página, ordenados por alta descendente y UUID como desempate. Los recuentos y opciones de cobertura se calculan en SQL sobre todo el conjunto autorizado; los filtros y la búsqueda se aplican antes del límite. Sólo se descifran las identidades de esa página. Nunca se usa el teléfono como identidad: los familiares con un contacto compartido conservan filas separadas.

La búsqueda acepta coincidencia exacta del nombre y apellido completos, DNI o teléfono. El nombre usa la normalización existente (trim y minúsculas; conserva tildes y espacios internos). El teléfono usa el índice existente sobre sus últimos diez dígitos, con mínimo ocho; por eso no constituye un identificador único y puede devolver varios pacientes. Los candidatos salted por consultorio y legacy sin salt se consultan simultáneamente, para cada clave HMAC de lectura durante rotación. No hay búsqueda parcial ni por tags. Los pickers antiguos de turno no se modifican en este corte y conservan sus límites anteriores.

`pacientes_directory_page` es SECURITY INVOKER y exige usuario, membresía vigente y MFA cuando está habilitado. Mantiene la RLS existente de paciente, identidad y turno, incluida asignación profesional y caja fuerte. No amplía acceso clínico: ASISTENTE puede recibir cero pacientes por esa RLS, aunque el comentario histórico de M14 describiera otra intención. Los agregados son sobre lo que ese actor puede leer, no sobre filas ocultas.

Los cursores llevan fecha PostgreSQL textual (microsegundos intactos), UUID y corte, autenticados con HMAC ligado a consultorio, miembro y filtros exactos. La fecha de presentación usa Córdoba. Un refresh SSR invalida peticiones en vuelo y recarga los filtros vigentes; los datos del contexto anterior se ocultan mientras se carga. Los errores no se convierten en lista vacía ni en cobertura Particular.

## Exportación

POST `/pacientes/export` valida origen, sesión y filtros, recorre páginas y genera el archivo sólo al completar la validación. Revalida consultorio/miembro dentro de la misma sesión que usa cada consulta. Rechaza filas o cursores repetidos, ciclos, páginas vacías intermedias, recuentos incompletos, cambios de revisión/corte, fallos de lectura y límites. No entrega un CSV parcial. El texto está protegido contra fórmulas de planilla.

Límites del corte: 10.000 filas y 4 MiB tanto para el contenido de filas acumulado como para el CSV final; la UI dice 4 MB. El umbral es conservador para respuestas de funciones alojadas y puede rechazar antes de 10.000 filas si los textos son extensos. La generación es en memoria, sin archivo de PHI en disco ni registro de contenido. No es una exportación ilimitada.

Cada petición SQL tiene un snapshot consistente. Entre páginas se comparan el recuento y una huella de todas las filas filtradas, incluidos cifrados, cobertura, tags y agregados de turno. Se repite la consulta inicial al finalizar para detectar cambios tardíos. Las altas posteriores al corte inicial quedan fuera. Esto detecta cambios observables entre lecturas; no es una transacción repeatable-read única mantenida durante todas las llamadas HTTP, y no promete detectar una edición transitoria revertida entre lecturas o un cambio posterior a la comprobación final. No hay garantía de snapshot común entre base, Auth y otros sistemas.

## Despliegue

Aplicar primero `20260908194000_M114_pacientes_directory.sql`, aditiva (índice y RPC). Después desplegar el código que llama al RPC. No activar MFA ni modificar políticas de acceso como parte de este despliegue. La migración sigue disponible para código anterior; no requiere mantenimiento ni backfill de datos. No se aplicó a producción durante este trabajo.

## Evidencia local sintética

- PostgreSQL16, base `folio_test_m114_volume` clonada de la plantilla hasta M112: migración y `M114_pacientes_directory.spec.sql` PASS; 1.205 pacientes con timestamps iguales, 25 páginas sin duplicados, búsqueda y cobertura en la última página, familia compartida y revisión ante cambio de igual recuento.
- `M114_directory_independent.spec.sql`: revisión independiente de RLS, membresía revocada, caja fuerte, rol, org ajena, MFA, ACL anónima, cursores empatados y contactos compartidos.
- `node scripts/testing/run-unit.mjs tests/unit/pacientes-directory.test.ts tests/unit/pacientes-directory-loader.test.ts tests/unit/pacientes-directory-export-route.test.ts`: 27 casos. Incluye reuso de cursor PAMI/pami RED→GREEN, cursor manipulado/otra org, fechas Córdoba, errores de SDK/cifrado sin contenido, 1.205 filas y errores tardíos de exportación.
- `node tests/pacientes-directory/run-isolated.mjs`: 10 escenarios de navegador (React development/StrictMode y production), componentes reales y fronteras servidor simuladas, únicamente loopback. Paginación, filtros globales, respuestas fuera de orden, error/reintento y refresh SSR conservando filtros. Sin capturas ni datos reales.

Estos ensayos no certifican Supabase Auth/Storage reales ni latencia/cuotas del despliegue hospedado. El replay completo y compilación final del conjunto de cambios los coordina el integrador.
