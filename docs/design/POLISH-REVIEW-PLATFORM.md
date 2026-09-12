# Revisión cruzada de plataforma — 12 de septiembre de 2026

Revisión independiente del diff y del código de `components/pacientes/pacientes-dir.tsx`, `components/calendario/calendario.tsx`, `components/finanzas/finanzas.tsx`, `styles/platform.css` y `scripts/design-interactions-qa.mjs`. Durante el build de integración se trabajó sólo en lectura. Las comprobaciones posteriores usaron datos ficticios, contextos de navegador separados y una barrera que permite únicamente GET al origen local.

## Hallazgo corregido

**El nuevo nombre accesible del turno omitía contexto que la tarjeta mostraba.** En la galería, el texto visible «Mateo V. · 11:15 · Sesión de seguimiento» tenía el nombre accesible «Mateo Vidal · 11:15». El `aria-label` sustituía el nombre derivado de sus descendientes y omitía también el profesional y la indicación de Google cuando estaban presentes.

Se informó a root y al autor de plataforma antes de editar. Con su autorización se amplió únicamente el `aria-label`: nombre completo, hora, servicio, profesional si existe e indicación de Google si corresponde. No cambian el contenido visual, las acciones, los datos ni la apertura del detalle. Dos turnos del mismo paciente y hora con profesionales distintos tienen ahora nombres accesibles distinguibles incluso en tarjetas estrechas.

- [Árbol accesible anterior](evidence/platform-review-aria-before.json).
- [Árbol posterior y comprobación de importes](evidence/platform-review-gallery.json).
- [Casos con y sin opcionales, desarrollo y producción](evidence/platform-cross-review-results.json).
- Capturas inspeccionadas de [tarjeta habitual](evidence/polish-platform-review-rich-card.png) y [tarjeta estrecha](evidence/polish-platform-review-narrow-card.png). La corrección no altera sus dimensiones ni su texto visible.

## Comprobaciones y límites

| Área | Resultado observado |
| --- | --- |
| Selección y filtros de pacientes | La selección general compara las identidades visibles y comunica el estado parcial nativo. Seleccionar por teclado o etiqueta no abre la ficha. El estado oculto por filtros conserva la conducta anterior del componente; no se cambió esa política. |
| Diálogos | Enter abre el detalle de agenda; Tab y Shift+Tab permanecen dentro; Escape cierra y devuelve el foco a la tarjeta. El atajo `/` no roba el foco a la confirmación de WhatsApp. No se confirmó ningún envío. |
| Finanzas | Los seis importes de ejemplo y los cinco resúmenes coinciden antes y después de buscar, combinar filtros de estado y limpiar. La búsqueda numérica conserva los dos pendientes de ejemplo. No se ejecutaron cobros ni exportaciones. |
| Móvil | Las tablas responden a flechas y no ensanchan la página a 375/390 px. Los filtros de agenda caben y anuncian selección. [Finanzas a 390 px](evidence/polish-platform-review-finance-mobile.png). |
| Contraste y tacto | La ayuda de tablas tiene contraste calculado 5,59:1 en claro y 7,40:1 en oscuro. El checkbox general conserva una etiqueta de 16×16 px; es un tamaño heredado, no una regresión de este diff. La medición por sí sola no evalúa las excepciones de separación entre objetivos. No se amplió en esta revisión. |
| Movimiento reducido | La suite confirma desplazamiento instantáneo y ausencia del pulso en reducido; mantiene desplazamiento suave cuando está permitido. |

Validación ejecutada tras el ajuste:

- `node scripts/design-platform-cross-review.mjs`: **6/6**. Componentes reales de agenda y detalle; sólo se sustituyen navegación, refresco y modales de mutación fuera de alcance. El primer montaje del arnés señaló una referencia de entorno del hook de refresco; se aisló explícitamente ese límite y la ejecución final pasó sin errores de página.
- `design-platform.spec.ts`, config de diseño aislado, salida sólo de lista: **8/8**, 10,8 s. Se actualizó la expectativa del nombre accesible para conservar el servicio.
- `node scripts/design-interactions-qa.mjs`: **18/18**, incluyendo selección mixta y cancelación de la confirmación de WhatsApp; [resultado](evidence/interaction-results.json).
- ESLint de los dos archivos TypeScript modificados, comprobación de sintaxis del arnés y `git diff --check`: sin errores.

No se ejecutaron build, typecheck global ni unidad global en esta revisión; root gestiona esos controles de integración. Las pruebas son locales y sintéticas, no acreditan funcionamiento de base de datos, permisos, proveedores ni cobros reales. No se encontraron otras regresiones concretas en el diff revisado.
