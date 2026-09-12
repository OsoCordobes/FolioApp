# Pantallas amplias, reflujo y lectura

Revisión del 12 de septiembre de 2026. El usuario señaló que su segunda pantalla dejaba demasiado margen blanco en la landing. La composición aprobada a 1440 px se conserva; por encima, marcos y tipografía crecen gradualmente. A partir de 1800 px, el recorrido distribuye explicación y producto en dos columnas. Los fondos siguen ocupando toda la pantalla y los párrafos mantienen una medida limitada.

## Anchos comprobados

Mediciones CSS, no pulgadas físicas. El navegador y la escala del sistema pueden convertir la resolución del monitor en un viewport distinto.

| Ventana | Hero anterior | Hero actual | Sección de especialidades anterior | Sección actual |
| --- | ---: | ---: | ---: | ---: |
|1440 px|1320 px|1320 px|1120 px|1120 px|
|1920 px|1320 px|1656 px|1120 px|1456 px|
|2560 px|1320 px|2104 px|1120 px|1904 px|
|3440 px|1320 px|2440 px|1120 px|2240 px|

El límite superior es deliberado: una pantalla ultrapanorámica gana espacio para las composiciones sin convertir los párrafos en renglones excesivos. La descripción del hero crece desde 400 hasta 598 px; el título y la ilustración aumentan a ritmos distintos. No se aplica zoom o transform a toda la página.

La revisión independiente detectó tres mejoras sobre la primera versión ancha: alinear el texto de especialidades con el inicio de sus opciones, mantener la ventana de producto cerca de 1000 px antes del cambio a dos columnas y hacer gradual el ancho del párrafo principal. Las tres se aplicaron. El salto de la ventana en 1799→1800 pasó de 1251→943 a 1000→943 px; el cambio restante corresponde a la nueva distribución.

[Medidas reproducibles](evidence/wide-responsive-results.json), [arnés](../../scripts/design-wide-qa.mjs). Diez tamaños: 320, 390, 768, 1440, 1600, 1799, 1800, 1920, 2560, 3440. Sin desbordamiento de página ni errores JS observados; las tres pestañas mantienen la misma altura en cada tamaño. Capturas anteriores: `polish-compiled-*.png`; actuales: `wide-*-after.png`.

## Texto grande y controles

Se realizó además un stress separado que duplica por CSS los tamaños calculados de texto y línea. No equivale a zoom nativo ni constituye certificación. Encontró mínimos intrínsecos de grids, palabras largas, botones que no envolvían texto y filas de cobro ilustrativas comprimidas.

Se corrigieron tamaños mínimos de las columnas, ajustes de texto largo, cierre del footer, lectura del precio y columnas adaptables de métricas. A 320 y 390 px con este stress, el documento queda dentro del ancho y las cinco fichas no recortan texto. El precio se mantiene numéricamente completo: en la condición extrema el símbolo monetario puede ocupar su propia línea; no se abrevia ni se parten cifras. La vista móvil normal conserva los valores y las mismas fuentes canónicas de precios.

[Diagnóstico](evidence/cross-layout-review-final.json), [precio al 200% de texto](evidence/text-stress-pricing-320.png). La repetición final esperó a que React terminara de hidratar antes de modificar estilos: cero errores de consola o de página en ambos tamaños. La advertencia de hidratación de una captura anterior procedía de una carrera en este arnés, documentada en [CONSOLE-CHECK.md](CONSOLE-CHECK.md).

## Confirmación sobre el build final local

El build de `2d02096`, identificador `Sr0tdXv5RNBdPY4pKAzR_`, volvió a comprobarse a **1440, 1920, 2560 y 3440 px**. Los anchos de hero y especialidades coinciden con la tabla anterior; no se observó desborde horizontal ni errores de página/consola. [Mediciones y capturas compiladas finales](evidence/polish-production-smoke-final.json). La suite visual pasó **14 de 14** después de generar e inspeccionar los baselines, esta vez **sin actualizarlos**: [comparación](evidence/polish-visual-compare.txt).

Dos contextos adicionales de la aplicación compilada —1440 × 900 normal y 390 × 844 con CPU ×4/latencia de 150 ms— mantienen su altura en las tres transiciones del recorrido. No registraron desplazamientos de contenido sin interacción reciente ni errores de página/consola en esa muestra; el móvil ralentizado sí registró dos tareas largas. [Perfil local](evidence/polish-runtime-profile.json). No equivale a mediciones de Core Web Vitals de usuarios reales. El [índice de verificación](POLISH-VERIFICATION.md) conserva el alcance completo y separa el cierre local de la publicación.

## Referencias y alcance

La inspiración visual se documenta en [WIDE-SCREEN-REVIEW.md](WIDE-SCREEN-REVIEW.md), con páginas oficiales de Jane, Semble y Cliniko. Los tamaños adoptados son decisiones para Folio, no medidas atribuidas a esas empresas.

La revisión toma como criterios que el contenido pueda redistribuirse en ventanas estrechas ([W3C: Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)), que ampliar texto conserve información y controles ([W3C: Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html)) y que el foco no quede oculto por elementos fijos ([W3C: Focus Not Obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)). Estos controles dirigidos no sustituyen una auditoría completa de accesibilidad.

Las pruebas se limitan al servidor local aislado, con datos ficticios y red externa bloqueada. No acreditan guardados, proveedores, pagos o producción.
