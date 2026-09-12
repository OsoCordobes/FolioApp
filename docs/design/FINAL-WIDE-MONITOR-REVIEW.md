# Cierre de monitores amplios

Landing compilada local en 4410; Chromium, movimiento reducido. Dos capturas, sin cambios de fuente.

| Ventana CSS | Composición inicial | Secciones | Párrafo inicial |
|---|---:|---:|---:|
| 3840 × 2160 | 2440 px; margen 700 por lado | 2240 px; margen 800 por lado | 598 px; fuente 19 px |
| 1920 × 700 | 1656 px; margen 132 por lado | 1456 px; margen 232 por lado | 460 px; fuente 16,9 px |

**Juicio: conservar los límites actuales.** En 4K los márgenes son amplios pero proporcionados a una composición que ya muestra una ilustración inicial de 1256 px y un recorrido de producto de 1541 px. Los párrafos mantienen una medida cómoda; ampliar más no resuelve un recorte ni mejora una tarea concreta. La captura muestra la portada completa y buena parte del recorrido siguiente, con una jerarquía coherente.

En la ventana ancha y baja, el bloque inicial requiere scroll vertical, pero el título, la explicación y las dos acciones principales se ven completos: las acciones terminan a 665 px de los 700 disponibles. La ilustración continúa debajo del borde de la ventana; es continuidad del documento, no contenido cortado por un contenedor.

No hubo desborde horizontal ni errores de consola/página. La misma página mantuvo **Los cobros** y **Cardiología** al cambiar de 3840 × 2160 a 1920 × 700.

Evidencia: `evidence/final-wide-monitor-review.json`, `evidence/final-wide-3840x2160.png` y `evidence/final-wide-1920x700.png`.
