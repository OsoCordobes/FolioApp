# Pruebas de navegador locales

Los comandos de pruebas levantan su propio servidor en `http://127.0.0.1:4410`, con salida `.next-test`. No reutilizan `pnpm dev`, no leen archivos `.env*` y descartan las credenciales de proveedores heredadas. Los destinos externos se rechazan en Node y en el navegador, incluidos los redireccionamientos. Las pruebas nuevas deben importar `test` y `expect` desde `../fixtures/local-test` para conservar la protección del navegador.

```powershell
pnpm test:e2e -- --list
pnpm test:e2e -- tests/e2e/not-found.spec.ts
pnpm test:app
pnpm test:isolation:browser
```

Sin Supabase local, las pantallas públicas y los ejemplos que usan mocks pueden comprobarse; los flujos que necesitan Auth, datos clínicos o reservas no quedan verificados. Los escenarios de signup/onboarding y los que requieren login o un consultorio se omiten hasta configurar una instancia local dedicada. Un resultado omitido no es un resultado aprobado.

## Recorrido clínico con servicios reales locales

El procedimiento específico está en [CLINICAL-LOCAL.md](../../scripts/testing/CLINICAL-LOCAL.md).
`node scripts/testing/run-clinical.mjs` exige la instancia dedicada con PostgreSQL 17,
Auth, TOTP y Storage reales, y usa exclusivamente `http://localhost:4420` para
no ocupar el puerto 4410 del runner ordinario/visual. Valida el perfil completo
antes de iniciar su aplicación o navegador y rechaza cualquier override de URL
distinto. La suite integrada prepara datos propios para cada caso y comprueba el
recorrido de cada especialidad: paciente sin turno previo, atención, guardado,
archivo, cobro en efectivo registrado y lectura después de volver a iniciar sesión.
También intenta accesos AAL1, entre consultorios, escritura clínica directa y
uso de un token después de revocar su sesión.
Un escenario adicional conserva la descarga PDF/JSON del archivo clínico cuando
la suscripción sintética está pausada, comprobando que la interfaz común vaya a
cobros y las historias ajenas sigan denegadas; no acredita por sí solo el bloqueo
de mutaciones directas en servidor.

El comando falla si faltan sus cuatro variables locales; el spec se omite
explícitamente en el runner ordinario sin esa habilitación. Sus pruebas preparadas
no cuentan como evidencia de funcionamiento hasta que se ejecuten sin omisiones
contra Auth y Storage reales. El listado `--list` sólo acredita descubrimiento.
No reemplaza las pruebas de suscripción con Mercado Pago, menores, recuperación,
usabilidad ni carga. No reutilizar para este ensayo una base con datos recuperados
de producción: la preparación rechaza organizaciones o usuarios ajenos a su
espacio exclusivamente sintético.

## Instancia local con datos inventados

La instancia debe estar aislada, tener las migraciones y sus fixtures sintéticos. No use túneles, proxies ni puertos reenviados a una base hospedada. El arranque o preparación de esa instancia es un procedimiento separado: este comando no crea, reinicia ni borra bases.

Configure estas variables sólo con los valores de `supabase status` de esa instancia local:

```powershell
$env:FOLIO_TEST_SUPABASE_URL = "http://127.0.0.1:54321"
$env:FOLIO_TEST_SUPABASE_ANON_KEY = "<JWT anon de la instancia local>"
$env:FOLIO_TEST_SUPABASE_SERVICE_KEY = "<JWT service_role de la instancia local>"
$env:FOLIO_TEST_LOGIN_EMAIL = "medico@example.test"
$env:FOLIO_TEST_LOGIN_PASSWORD = "<clave del usuario sintético local>"
$env:FOLIO_TEST_BOOKING_SLUG = "folio-test-booking"
pnpm test:e2e
```

URL y ambas claves se suministran juntas. Se aceptan los JWT locales legacy con emisor `supabase-demo` o `supabase-local`; las claves hospedadas se rechazan aunque el destino sea localhost. Las cuentas clínicas necesitan su inscripción MFA y fixtures correspondientes. No se omite ese control para conseguir un test verde.

Los usuarios y pacientes creados son inventados (`@example.test`, nombres E2E), y el consultorio fixture debe ser sintético. La prueba de reserva exige disponibilidad y servicios locales preparados. Signup puede crear usuarios locales. Las pruebas históricas opcionales de activación de cobro y alta de ficha permanecen deshabilitadas: una interceptación de `page.route` no simula una llamada al proveedor hecha por el servidor. Para habilitarlas hace falta un fixture de proveedor local explícito y revisar el flujo completo.

Los proveedores externos, captcha, correo, pagos, telemetría y fuentes remotas no reciben solicitudes desde estos procesos. Los flujos que los necesitan pueden mostrar un error o quedar pendientes hasta agregar un doble local; eso no demuestra una falla del proveedor ni verifica su integración real. No se deben actualizar imágenes de referencia para ocultar diferencias por fuentes bloqueadas.

## Limpieza y otras comprobaciones

`scripts/cleanup-e2e.mjs` sólo acepta `FOLIO_TEST_DATABASE_URL` en loopback y una base `folio_test_*` o el `postgres` de Supabase local; requiere un consultorio `folio-test-*` marcado sintético. Conserva su modo de vista previa. Revise esa vista antes de usar su opción de borrado. Nunca carga `.env.local`.

`pnpm test:visual` requiere `FOLIO_TEST_PROTOTYPE_ROOT`, el directorio explícito del prototipo estático local. `pnpm test:build` compila con el mismo aislamiento y salida separada. Las pruebas unitarias usan `pnpm test:unit` y no necesitan ninguna variable de entorno real.

Validar una instalación hospedada requiere un procedimiento manual separado, autorización específica, inventario de escrituras y datos de prueba revisados. No se admite cambiar `E2E_BASE_URL` a un sitio hospedado ni a los puertos habituales 3000/3010. Este documento no autoriza esa campaña y no modifica los procedimientos manuales de custodia, captura o recuperación.

El bloqueo protege contra conexiones accidentales del código probado; no es un aislamiento del sistema operativo frente a código hostil. Los permisos de un proceso local y los servicios accesibles en loopback siguen requiriendo una máquina de pruebas controlada.

Baseline clínico histórico (12 de septiembre de 2026): **7/7 aprobados**,
cero fallidos y cero no ejecutados, 2,3 minutos. Las tres especialidades completaron
guardado, adjunto real, cobro efectivo y reapertura; pasaron denegaciones de
acceso, archivo autorizado con suscripción pausada y revocación Auth. Baseline
e7da69f con fixture/perfil/selectores autorizados, sin M120/M121. No acredita
producción ni Mercado Pago. Evidencia y ejecuciones fallidas anteriores en
[CLINICAL-LOCAL.md](../../scripts/testing/CLINICAL-LOCAL.md).

Suite integrada preparada: doce casos independientes con nueve controles de
política obligatorios antes de crear fixtures, sin activarlos desde cada test.
Agrega cierre clínico sin cobro automático, registro explícito en agenda,
recuperación tras respuestas perdidas con commit SQL comprobado y roles reales
ASISTENTE/COORDINADOR en contextos limpios. Los POST se ligan a la sesión AAL2 del
navegador y al intento/pago exacto. La limpieza revoca sesiones y conserva datos.

El checkpoint de pruebas `280ef18c2663a85fd9fd54698f68f338623c1362` conserva la
aplicación de `c57f8f2`: revisión independiente, tipos y lint completos aprobados,
**2212/2212 unitarias**, **20/20 comprobaciones focales de seguridad**, **5 diagnósticos
Auth** y **7 de llegada**. La seguridad incluye discovery de doce casos y rechazo
de escritores durante la consulta real de recuperación. Se corrigieron el selector
accesible de cobro y la longitud exacta del identificador de acción de Next; la
observación de llegada/Auth no amplía plazos ni reintenta solicitudes.

La instalación local ya recibió M120/M121 y sus activaciones auditadas: 115
migraciones y nueve controles activos, con datos y volúmenes anteriores
conservados. La auditoría original corresponde a `3a9823a`; no se reinstala SQL ni
se repiten activaciones por los cambios de código. Run-11 terminó con **2 aprobados
y 10 fallidos** por el desajuste horario entre formulario y agenda. La corrección
de `c57f8f2` aprobó compilación aislada (exit 0, 16 avisos heredados) y **50/50
escenarios de formularios**. Run-12 comprobó fecha y hora completas en sus diez
turnos, pero terminó con **4 aprobados y 8 fallidos, cero omitidos**: seis fallos del
selector/observador y dos de llegada/Auth cuya causa sigue sin determinar.

Run-13 sobre `280ef18`, 115 migraciones y nueve controles terminó con **6 aprobados
y 6 fallidos, cero omitidos, en 8 minutos**. Aprobaron AAL1/portal, aislamiento de
consultorios y archivos, archivo con suscripción pausada, revocación y recuperación
de respuestas perdidas de CLOSE/RESOLVE con commit SQL comprobado. Quiropraxia y
cardiología completaron cobro y reapertura con un nuevo login, pero falló la limpieza
del observador. Psicología y el caso M121 fallaron al comprobar el aviso de cierre
clínico que desaparecía; el caso M121 no alcanzó el saldo. ASISTENTE/COORDINADOR
autenticaron sus roles y alcances, pero encontraron la agenda operacional vacía.

Las correcciones posteriores tienen revisión independiente y pruebas focales:
limpieza única del observador en `57cfd03` (**27/27**), confirmación de cierre propio
en `dfc4af6` (**12/12 navegador y 13/13 unitarias**) y lectura de Hoy en `6a75cc1`
(**22/22 unitarias**). M122 proporciona la lectura operacional de recepción sin
abrir clínica. M123, en `17a3770`, impide que COORDINADOR consulte pagos por SELECT
directo. Los controles finales de aplicación aprobaron **2231/2231 unitarias,
tipos, lint y compilación aislada**, con los 16 avisos heredados de instrumentación.

La fuente final contiene **117 migraciones**. La evidencia SQL es **replay completo
de 116 migraciones / 64 specs**, más **M123 focal y cinco specs afectados aprobados**;
no es un replay completo de 117. El runtime clínico permanece en `280ef18`, 115
migraciones y nueve controles, sin M122/M123. Por instrucción expresa del usuario,
**se cierra la iteración sin repetir el recorrido ni ejecutar run-14**. Las pruebas
focales no transforman run-13 en 12/12 ni verifican el saldo integrado M121 o los
roles de recepción del código final. La evidencia 7/7 anterior corresponde sólo
al baseline señalado arriba.

La entrega se prepara para push y PR en borrador. La lectura del inventario
productivo confirmó 92 migraciones; las 25 faltantes y las activaciones por etapas
impiden fusionar directamente a `master`, que despliega automáticamente. No se
aplicaron cambios en producción. El [registro de iteraciones](../../docs/LAUNCH-RELIABILITY-LOG.md)
conserva las campañas fallidas y la [entrega de revisión](../../docs/LAUNCH-RELIABILITY-DELIVERY.md)
distingue las verificaciones del candidato y los requisitos externos.
