# Checkpoint publicable — 8 de septiembre de 2026

Este corte parte de `a6eecc55a78c20310e30b2e1498aa28e11bc59b4` (#160), que corrigió las llegadas walk-in y la conservación de cobros confirmados. No instala migraciones ni modifica variables de entorno.

## Comportamiento

- El PDF recorre todas las sesiones y enmiendas que permite leer el rol actual, con páginas de consulta de 200 filas. Ya no recorta la evolución a diez sesiones ni las escalas a veinte resultados. Conserva originales y agrega autor, fecha, motivo y texto de las enmiendas.
- Una página fallida, un conteo inconsistente, registros repetidos, una sesión puntual inexistente o datos clínicos ilegibles impiden entregar un archivo presentado como correcto. Los límites de 10.000 filas por colección y 4 MiB generan un error explícito.
- El PDF indica su alcance: historial autorizado por permisos, sin adjuntos ni firmas, sin garantía de snapshot transaccional. Una entrega puntual incluye sólo la sesión pedida. No es el archivo completo de recuperación previsto en el plan general.
- Se verifican permisos antes de leer y después de generar el PDF. Un director necesita su condición de profesional colegiado. La revocación comprobada impide entregar los bytes preparados.
- Las solicitudes de baja se conservan para revisión humana; no disparan borrados automáticos por antigüedad, aunque siga configurada una variable antigua. La interfaz distingue fallos y confirma que la solicitud fue guardada.
- Se retiran las cuatro rutas web administrativas para migrar/reiniciar, confirmar usuarios y sembrar demos, junto con el workflow que las invocaba. Los datos existentes se conservan.
- Next.js y eslint-config-next pasan a 15.5.24. Las verificaciones unitarias y de compilación usan claves sintéticas, bloquean lecturas de archivos de entorno y conexiones externas.

## Verificación y recuperación

Ejecutar `pnpm test:unit`, `pnpm typecheck`, `pnpm lint`, `pnpm test:build`, `node tests/pdf/render-real.cjs` y `node tests/hoy/run-isolated.mjs browser`. Las pruebas de autorización simulan consultas desde el servidor; no crean pacientes ni envían mensajes. La prueba de navegador ejercita las llegadas y sus estados pendientes en React de desarrollo y producción.

La prueba del renderer real encontró un desbordamiento del pie al heredar el interlineado de la página; se corrigió retirando esa herencia. Verificación: 62 sesiones y 62 enmiendas en 13 páginas, y una sesión extensa de nueve páginas con 540 marcadores de texto conservados. Un inspector sintético de streams y una lectura independiente con pypdf confirmaron el contenido. CI ejecuta el renderer real para evitar que las pruebas con mocks oculten una regresión de paginación.

La auditoría registra la preparación del PDF con entrega no confirmada. Una revocación posterior puede impedir enviar la respuesta y no debe aparecer como una exportación recibida con éxito.

La publicación depende de CI y de un despliegue READY del mismo commit fusionado. El registro final debe incluir PR, SHA, despliegue y comprobaciones públicas. Las comprobaciones públicas no certifican acceso clínico autenticado ni uso real de proveedores.

No hay migraciones que revertir. Ante una regresión se puede volver al despliegue anterior de #160 mientras se corrige, teniendo presente que esa versión restaura las rutas administrativas y el ejecutor de purga anterior; no activar su variable de borrado. Una corrección hacia delante evita reintroducir esos riesgos.

## Trabajo conservado para continuar

El resto del plan está en `codex/market-ready`, checkpoint `110ef70b018caf24ba3c24722f8b26f9963dba79`, con despliegue automático desactivado para esa rama. Sus migraciones M98–M115 siguen pendientes de producción. La validación local final pasó 2.022 pruebas unitarias y 109 migraciones/54 pruebas SQL sobre PostgreSQL 16; Auth y Storage todavía usan stubs SQL.

El piloto profesional sigue pendiente: MFA real, menores, recuperación integral, proveedores, carga y validación humana. Hay una copia cifrada verificada y un programa de respaldo preparado, pero la programación diaria aún no está activada. No confundir este checkpoint publicado con la finalización del plan completo.
