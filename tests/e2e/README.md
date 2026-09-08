# Pruebas de navegador locales

Los comandos de pruebas levantan su propio servidor en `http://127.0.0.1:4410`, con salida `.next-test`. No reutilizan `pnpm dev`, no leen archivos `.env*` y descartan las credenciales de proveedores heredadas. Los destinos externos se rechazan en Node y en el navegador, incluidos los redireccionamientos. Las pruebas nuevas deben importar `test` y `expect` desde `../fixtures/local-test` para conservar la protección del navegador.

```powershell
pnpm test:e2e -- --list
pnpm test:e2e -- tests/e2e/not-found.spec.ts
pnpm test:app
pnpm test:isolation:browser
```

Sin Supabase local, las pantallas públicas y los ejemplos que usan mocks pueden comprobarse; los flujos que necesitan Auth, datos clínicos o reservas no quedan verificados. Los escenarios de signup/onboarding y los que requieren login o un consultorio se omiten hasta configurar una instancia local dedicada. Un resultado omitido no es un resultado aprobado.

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
