# Checkpoint de implementación — 8 de septiembre de 2026

Esta rama conserva el trabajo del plan de preparación. **No está desplegada ni lista para pacientes reales.** Sus migraciones M98–M115 todavía no fueron aplicadas a producción. Vercel no debe desplegar automáticamente `codex/market-ready`; la configuración de esta rama lo desactiva expresamente.

El arreglo de llegadas y cobros del video está publicado mediante #160, SHA `a6eecc55a78c20310e30b2e1498aa28e11bc59b4`. El usuario pidió conservar el avance y publicar un corte adicional acotado antes de agotar su cuota. **El segundo checkpoint fue publicado mediante #161**, sin las migraciones nuevas.

## Publicación verificada

- Producción/master: `18b57247048ea20e08ad1e90f6e1276cf709d721`, PR https://github.com/OsoCordobes/FolioApp/pull/161, fusionado a las 21:12:43 UTC.
- Vercel: `dpl_F1WWoqBTMpVmdcsKx5fhaePCBwGW`, READY y alias `foliosalud.com`. A las 21:17:16 UTC, health respondió 200/ok/production, login 200 y su HTML contenía el SHA nuevo.
- Incluye Next.js 15.5.24, PDF autorizado sin recorte a diez sesiones, resúmenes clínicos y enmiendas, corrección del renderer multipágina, baja por revisión humana y retirada de cuatro endpoints administrativos.
- Pruebas del corte: 1.628 unitarias, 16 escenarios de navegador, types/lint/build y CI aprobados. Renderer real: 62 sesiones/62 enmiendas en 13 páginas y sesión extensa de nueve páginas; todos los marcadores comprobados también con pypdf.
- Esta rama grande conserva el checkpoint de código `110ef70b018caf24ba3c24722f8b26f9963dba79`: 2.022 unitarias, types, lint, build y 109 migraciones/54 pruebas SQL locales pasaron. La prueba SQL usa stubs de Auth/Storage; no acredita esos servicios reales ni carga.
- El checkout original `C:\Users\amiun\Desktop\folio-app` se actualizó a master y se instalaron las dependencias del lockfile. Sus cuatro archivos de entorno se respaldaron con DPAPI y conservaron exactamente sus hashes después de ambas operaciones.
- GitHub quedó sin PRs abiertos y con sólo `master` y `codex/market-ready`. Las ramas remotas fusionadas y sus referencias obsoletas se retiraron; los worktrees locales de verificación se conservan.

**Reconciliación imprescindible antes de desplegar esta rama grande:** #161 agregó después del checkpoint 110ef70 la corrección real del renderer (`lineHeight` heredado por el pie), el runner `tests/pdf/render-real.cjs`/CI y negativas de autorización/UUID/auditoría/cronología. Integrar esas correcciones sin sustituir los exports ampliados, MFA ni los contratos nuevos presentes aquí. No repetir el fallo de PDF largo por desplegar una versión anterior del componente.

## Continuación

1. Leer `INTEGRACION-Y-DESPLIEGUE.md` y `plans/2026-09-08-market-readiness.md`. Mantener la publicación acotada y el resto de la preparación identificados por separado.
2. Reconciliar esta rama con el checkpoint publicado, conservando las mejoras clínicas más completas presentes aquí; no sobrescribir exports ni controles con las versiones acotadas de producción.
3. Validar la cadena completa, Auth/Storage reales, proveedores, recuperación integral y carga antes de activar controles o declarar apto el piloto.
4. Las claves fueron recuperadas y verificadas en el paquete privado del propietario. No hay secretos ni datos clínicos en este checkpoint. La custodia externa de la frase sigue pendiente por decisión del propietario.
5. Existe una copia cifrada verificada del 8 de septiembre a las 18:06 UTC y un programa privado de respaldo sellado. **La programación todavía no está activada**; la creación de automatización previa no completó su validación. No confundir una copia existente con copias diarias activas ni con restauración integral.
6. La revisión de títulos, condiciones del servicio, responsables, soporte y validación profesional sigue pendiente. No volver a pedir todo junto al propietario: solicitó explicaciones sencillas y continuar primero con la parte técnica.

Las evidencias detalladas están en los documentos temáticos. `.flow` contiene logs locales de pruebas y no se publica. El inventario y una copia Git recuperable se conservan fuera del repositorio antes del push. Los archivos `.env` no fueron modificados ni incluidos.
