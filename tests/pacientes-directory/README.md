# Directorio: pruebas de navegador sintéticas

Ejecutar desde la raíz: `node tests/pacientes-directory/run-isolated.mjs`.

El wrapper usa el aislamiento central: sin heredar secretos, sin `.env`, sin red externa. El harness compila el componente real con React development/StrictMode y production; simula únicamente acciones del servidor, navegación y modales. Sirve una página en loopback, no inicia Next, Docker ni servicios de producción. Los bundles temporales sólo contienen fixtures sintéticas.

Diez escenarios comprueban páginas de cincuenta, búsqueda/filtros enviados al servidor, respuesta tardía descartada, fallo sin resultados falsos, reintento y refresh SSR sin perder filtros. La evidencia de SQL/mapper/export está en `docs/DIRECTORIO-PACIENTES.md`.
