# Coherencia visual — entrega local

Base: `36d6c8f62c81e315862c11197413919b6ec83574`, branch `codex/design-coherence`.

## Cambios

- Tokens efectivos extraídos de `experience.css` a `design-system.css`, importados después del CSS histórico.
- Paleta pública compartida con texto neutral y violeta funcional; bloques de color duplicados retirados de miniweb/directorio.
- Landing completa conservada, con cuerpo de 16px, demos legibles, menor separación repetida y bloque reservas/equipo/portal de jerarquía asimétrica.
- Marca compartida en seis enlaces de landing, acceso y onboarding. Altura/radio de controles compartidos y enlace de recorrido con área táctil de 44px.
- Fichas por especialidad con un único marco; navegación, datos ilustrativos, precios, FAQ y destinos conservados.

## Evidencia

La vista local se sirve con `E2E_BASE_URL=http://127.0.0.1:4460 node scripts/testing/app-server.mjs`. Este bootstrap usa loopback, elimina credenciales heredadas y bloquea la lectura de archivos de entorno.

Los logs originales se preservan en `test-results/design-coherence/`:

- `typecheck-final.log`: `pnpm typecheck`, exit 0.
- `lint-final-clean.log`: ESLint en los siete archivos TSX afectados, exit 0 sin advertencias.
- `browser.log`: runner aislado, 26 casos completados: 12 E2E de contenido/SEO/destinos/teclado y 14 capturas de landing. Las 14 baselines se actualizan intencionalmente para este diseño; esta ejecución calibra las imágenes, no compara contra el aspecto anterior.
- `build.log`: `pnpm test:build`, Turbopack, exit 0; incluye compilación y comprobaciones de tipos/lint.
- `impeccable-detect.log`: un señalamiento de franja de miniweb en una regla histórica que está anulada por `display:none` en la misma hoja. No corresponde a una franja visible.

La revisión independiente emitió **SHIP visual, sin P1/P2 pendientes**. Revisó 10 vistas públicas en 1440×900 y 390×844 (landing, acceso, miniweb Solo/Clínica y onboarding sintético), todas con HTTP 200, cero desbordamiento horizontal y cero errores de página. Un spotcheck adicional de Hoy sintético en ambas medidas preserva su composición y las variantes compactas de controles.

El subtítulo de la consulta activa mide 11/12px y contraste 5,06:1; `Recorrer Folio` tiene 44px de alto. Flechas de pestañas, foco de 3px y supresión de movimiento bajo la preferencia de movimiento reducido se verificaron en el navegador. Se conserva la paleta clara pública al activar la preferencia oscura global.

El informe completo y capturas de viewport/página están en `C:/Users/amiun/Documents/Codex/folio-manager-evidence/design-coherence/READONLY-REVIEW.md` y su carpeta `finish-review/`. El autor inspeccionó las capturas de portada de escritorio/móvil y las baselines de cobros ancho y ficha móvil.

El único cambio de `app/layout.tsx` es la importación de la hoja central. Las fuentes de precios, contenido SEO, aviso de retorno de acceso, analítica y páginas legales quedan fuera del cambio. Los componentes de acceso y onboarding sólo sustituyen su enlace visual de marca; su lógica conserva el contenido previo.

## Límite de entrega

Se preserva el aviso previo de OpenTelemetry sobre las versiones 3.0.1/2.0.6 de `import-in-the-middle`; no impide preview, pruebas o build y su corrección de dependencias no pertenece a esta entrega.

La revisión visual es acotada: no cubre WCAG/NVDA completo, cada estado o contraste de la aplicación, todos los flujos clínicos, ni todas las variantes de miniweb. Las vistas operativas emplean fixtures sintéticas. La mayor legibilidad aumenta la altura móvil; no se afirma que la página sea más corta.

La entrega queda en una PR revisable con CI por completar. No incluye merge ni publicación. No acredita un lanzamiento final de Folio.
