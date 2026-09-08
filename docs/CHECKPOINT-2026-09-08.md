# Checkpoint de implementación — 8 de septiembre de 2026

Esta rama conserva el trabajo del plan de preparación. **No está desplegada ni lista para pacientes reales.** Sus migraciones M98–M116 todavía no fueron aplicadas a producción. Vercel no debe desplegar automáticamente `codex/market-ready`; la configuración de esta rama lo desactiva expresamente.

El arreglo de llegadas y cobros del video está publicado mediante #160, SHA `a6eecc55a78c20310e30b2e1498aa28e11bc59b4`. El usuario pidió conservar el avance y publicar un corte adicional acotado antes de agotar su cuota. **El segundo checkpoint fue publicado mediante #161**, sin las migraciones nuevas.

## Publicación verificada

- Producción/master: `18b57247048ea20e08ad1e90f6e1276cf709d721`, PR https://github.com/OsoCordobes/FolioApp/pull/161, fusionado a las 21:12:43 UTC.
- Vercel: `dpl_F1WWoqBTMpVmdcsKx5fhaePCBwGW`, READY y alias `foliosalud.com`. A las 21:17:16 UTC, health respondió 200/ok/production, login 200 y su HTML contenía el SHA nuevo.
- Incluye Next.js 15.5.24, PDF autorizado sin recorte a diez sesiones, resúmenes clínicos y enmiendas, corrección del renderer multipágina, baja por revisión humana y retirada de cuatro endpoints administrativos.
- Pruebas del corte: 1.628 unitarias, 16 escenarios de navegador, types/lint/build y CI aprobados. Renderer real: 62 sesiones/62 enmiendas en 13 páginas y sesión extensa de nueve páginas; todos los marcadores comprobados también con pypdf.
- Esta rama grande conserva el checkpoint de código `110ef70b018caf24ba3c24722f8b26f9963dba79`: 2.022 unitarias, types, lint, build y 109 migraciones/54 pruebas SQL locales pasaron. La prueba SQL usa stubs de Auth/Storage; no acredita esos servicios reales ni carga.
- El checkout original `C:\Users\amiun\Desktop\folio-app` se actualizó a master y se instalaron las dependencias del lockfile. Sus cuatro archivos de entorno se respaldaron con DPAPI y conservaron exactamente sus hashes después de ambas operaciones.
- GitHub quedó sin PRs abiertos y con sólo `master` y `codex/market-ready`. Las ramas remotas fusionadas y sus referencias obsoletas se retiraron; los worktrees locales de verificación se conservan.

**Reconciliación completada en `92940bb`:** #160/#161 están integrados, conservando exportación ampliada, MFA, revisiones de agenda y contratos nuevos. Se incorporaron el renderer multipágina/CI y las negativas de autorización, UUID, auditoría y cronología. Verificación integrada: **2.067 unitarias**, tipos, lint y compilación aislada aprobados; **110 migraciones y 55 specs SQL** sobre PostgreSQL 16.15 nuevo, con controles por defecto; **68 pruebas de recuperación aprobadas y una omitida** porque exige ensayo local explícito. Renderer real: 62 sesiones y enmiendas en 14 páginas; una atención extensa con 540 marcadores en ocho páginas. Los 16 escenarios reales de navegador de agenda también pasaron. Son comprobaciones distintas de Auth/Storage reales, proveedores y carga.

M116 retira adicionalmente la función antigua `pseudonimizar_paciente`: conserva firma/default, rechaza siempre sin modificar datos y revoca acceso de roles de aplicación. Los tests verifican filas completas clínicas/Auth, incluso ante una concesión accidental de permisos. Las versiones previas de las pruebas siguen comprobándose contra M115. No se aplicó a producción.

## Continuación

1. Leer `INTEGRACION-Y-DESPLIEGUE.md` y `plans/2026-09-08-market-readiness.md`. Mantener la publicación acotada y el resto de la preparación identificados por separado.
2. Conservar la reconciliación comprobada; usar el commit de merge como punto de comparación al continuar. Desplegar migraciones compatibles antes del código según la guía, con activaciones independientes.
3. Validar la cadena completa, Auth/Storage reales, proveedores, recuperación integral y carga antes de activar controles o declarar apto el piloto.
4. Las claves fueron recuperadas y verificadas en el paquete privado del propietario. No hay secretos ni datos clínicos en este checkpoint. La custodia externa de la frase sigue pendiente por decisión del propietario.
5. Existe una copia cifrada verificada del 8 de septiembre a las 18:06 UTC y un programa privado sellado. **La tarea Windows está registrada y ensayada**, independiente de Codex y sus cuotas. Ejecuta CatchUp cada hora y al iniciar sesión; requiere sesión Windows iniciada. El ensayo fue `not_due`, con 15 archivos de respaldo intactos. Faltan ciclo vencido, aviso por más de 24 horas, disco externo y restauración integral. Detalles en `RESPALDOS-RUNTIME-PRIVADO.md`.
6. La revisión de títulos, condiciones del servicio, responsables, soporte y validación profesional sigue pendiente. No volver a pedir todo junto al propietario: solicitó explicaciones sencillas y continuar primero con la parte técnica.

Las evidencias detalladas están en los documentos temáticos. `.flow` contiene logs locales de pruebas y no se publica. El inventario y una copia Git recuperable se conservan fuera del repositorio antes del push. Los archivos `.env` no fueron modificados ni incluidos.
