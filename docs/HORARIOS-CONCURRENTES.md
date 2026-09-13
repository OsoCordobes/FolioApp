# Horarios: guardado con revisión

M113 agrega una revisión por organización y profesional, más un recibo por intento. La lectura entrega la semana activa y vigente en Córdoba junto con esa revisión. Guardar valida sesión/MFA, membresía actual, organización y profesional; bloquea la revisión, rechaza una semana vieja y reemplaza las franjas dentro de una sola transacción. El recibo confirma el resultado sin repetir el cambio si se pierde la respuesta. La operación queda vinculada al contenido real además de su huella del servidor.

La pantalla conserva el borrador ante un conflicto. «Reemplazar borrador con horarios guardados» hace una lectura autorizada nueva y descarta ese borrador explícitamente. Si falla la lectura, conserva los datos. Ante un resultado incierto sólo permite reintentar el mismo intento; una respuesta vieja o un cambio de consultorio no rebaja la revisión ni escribe en otra agenda.

Las franjas deben estar completas, ordenadas y sin superposición. Una semana totalmente cerrada es válida en Configuración; el alta inicial requiere al menos una franja. Se conservan filas inactivas e históricas. Si existen horarios con vigencia futura o fecha de fin activa, el editor semanal queda protegido: no elimina esas fechas ni las transforma en una semana permanente. El editor de vigencias queda pendiente. La disponibilidad pública y su validación de reservas siguen leyendo la misma tabla, con activa/vigencias y horario de Córdoba.

## Alta inicial

El paso 5 ahora lee una revisión antes de habilitar sus controles. Su RPC autenticada usa el mismo escritor y recibo; revalida OWNER vigente, organización activa, registro incompleto y paso 4 guardado bajo lock. La disponibilidad y el avance al paso 5 se confirman juntos. Un registro que se finaliza mientras una escritura espera no puede ser alterado después. Ya no usa DELETE/INSERT privilegiados separados. La pantalla espera el resultado antes de avanzar y conserva el intento durante un fallo de red. Si un registro legado tiene franjas distintas por día o vigencias especiales, pide revisión: no las combina para todos los días.

## Instalación por etapas

1. Aplicar `20260908192500_M113_availability_revision.sql` como migración aditiva. No altera ni elimina datos existentes. El guard efectivo comienza apagado. El contador observa también las escrituras legadas y el marcador M111 continúa funcionando.
2. Desplegar el código nuevo. Probar autenticado lectura, doble pestaña, reintento con respuesta perdida, cambio de consultorio, semana cerrada y paso 5 con finalización concurrente. Comprobar previamente agendas con fechas especiales o franjas no uniformes durante onboarding: necesitarán revisión explícita.
3. Sólo después del smoke, invocar `public.enable_availability_revision(p_reason)` como service_role con el motivo auditable de la activación. La política privada registra fecha/motivo. Desde allí, las escrituras autenticadas directas y el RPC M97 dejan de poder eludir el escritor con revisión. No habilitar antes de desplegar: el cliente antiguo depende de M97. Un rollback de código requiere evaluar esa dependencia; no desactivar el guard automáticamente.

RPC autenticadas: `read_availability_snapshot`, `save_availability_revision`, `read_onboarding_availability`, `save_onboarding_availability`. Las tablas de revisión, autoridad y recibos son privadas; no guardan contenido clínico, contactos ni copias de pacientes. Service_role conserva su autoridad administrativa y no debe usarse como sustituto del escritor autenticado. No se activó nada en producción.

## Evidencia local y límites

- SQL real sobre PostgreSQL 16 con controles por defecto: `M113_availability_revision.spec.sql`; prueba rollback de franjas/revisión/avance inicial, replay, contenido distinto con el mismo intento, fechas protegidas, historial, rol/contexto, revocación, MFA, fase aditiva y guard activado.
- `scripts/testing/availability-race.mjs`, dos conexiones reales en una base sintética dedicada: competidores con revisión igual, desconexión, replay después de otra escritura, invalidación legada, marcador M111, inicialización duplicada y finalización concurrente.
- Pruebas unitarias focalizadas y navegador Chromium con Configuración y Onboarding/Step5/StepShell reales, React dev StrictMode y compilación de producción; acciones externas controladas. Evidencia temporal en `.flow/availability-review/`.
- No se probó aquí Auth/PostgREST ni transporte de Server Actions de un despliegue real. Los intentos del navegador se conservan en memoria: recargar pierde un intento sin confirmar, pero la siguiente lectura recupera la semana confirmada y nunca reenvía automáticamente el borrador antiguo. No hay vencimiento/purga automática de recibos en este corte.
- Otros pasos del onboarding conservan sus contratos existentes. No se implementó un coordinador transaccional de todo el registro ni un editor de horarios por vigencia.

### Revisión independiente local (8 de septiembre de 2026)

Una prueba SQL autenticada reprodujo un solapamiento aceptado si el mismo día se enviaba como `1` y `"01"`: el detector comparaba texto y la inserción lo convertía a número. M113 normaliza ahora esa comparación antes de decidir si las franjas se superponen. La prueba falló antes y pasó después del cambio. No se modificó una migración aplicada en producción.

La especificación también comprueba que un recibo no acepta otro contenido con la misma huella declarada, otra revisión, otro actor autorizado ni un actor revocado o sin MFA suficiente. La prueba de dos conexiones confirma que un replay esperando la revocación de su miembro devuelve `42501` cuando ésta se confirma.

Resultado independiente: 15 pruebas unitarias focales, siete escenarios de carrera y replay nuevo `folio_test_replay_m113_final1` con 107 migraciones y 50 especificaciones SQL correctas; `check_function_bodies` activado por defecto. El límite explícito fue `--through=M113`: M114 y posteriores quedaron excluidas. Evidencia en `.flow/m113-independent-verification.json`, `.flow/m113-independent-unit.log`, `.flow/m113-independent-race.log` y `.flow/replay-m113-final1.log`. El replay utiliza PostgreSQL 16 y stubs de Auth/Storage; no sustituye las pruebas autenticadas del despliegue real.
