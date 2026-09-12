# Pantallas grandes: revisión independiente

12 de septiembre de 2026. Investigación de páginas públicas oficiales. Se revisaron su contenido y las descripciones de sus imágenes; no se midieron sus contenedores ni se inspeccionaron sus productos privados. Los tamaños siguientes son una propuesta para Folio, pendiente de contraste visual con la landing real. No hubo cambios de fuente ni uso de CUA en esta revisión.

## Tres referencias y su aplicación

| Referencia oficial | Evidencia en su página | Aplicación propuesta en Folio |
| --- | --- | --- |
| [Jane](https://jane.app/) | Presenta el calendario con detalles de cita, mensajería y consulta; después organiza funciones en cinco categorías, cada una con una demostración específica. | Dar protagonismo y resolución suficiente al producto. Mantener la selección exclusiva de especialidad y una ficha estable; aprovechar el ancho adicional para leer esa ficha, preservando una sola historia a la vez. |
| [Semble](https://www.semble.io/) | Separa gestión, registro clínico y flujos; distingue profesionales individuales, consultorios y organizaciones. | Cada sección debe mostrar un trabajo reconocible. El espacio extra permite emparejar una explicación breve con una demostración amplia de agenda o ficha, sin extender los párrafos. |
| [Cliniko](https://www.cliniko.com/) | Ordena su portada alrededor de la práctica, precio, seguridad, soporte e integraciones, con ilustraciones vinculadas a cada asunto. | Conservar la claridad clínica y alternar superficies de sección con propósito. La profundidad puede venir de una composición, borde y sombra discretos ya presentes en Folio. |

Estas referencias orientan la jerarquía y la presentación del producto; no justifican copiar sus colores, ilustraciones, cifras comerciales ni tamaños técnicos.

## Propuesta de anchos

Separar tres medidas: **superficie de sección a todo el viewport**, **composición de producto amplia** y **texto de lectura limitado**. Los valores son puntos de partida para comparar capturas, no breakpoints observados en los competidores.

| Viewport efectivo en CSS px | Composición principal sugerida | Demostración de producto dentro de la composición | Resultado buscado |
| --- | --- | --- | --- |
| 1920 | 1520–1600 px | Aproximadamente 900–1000 px | Presencia mayor del producto y márgenes laterales de 160–200 px. |
| 2560 | 1840–1920 px | Aproximadamente 1120–1240 px | Dos columnas equilibradas; el crecimiento beneficia principalmente a la ficha. |
| 3440 | 2160–2240 px | Aproximadamente 1360–1440 px | Composición panorámica acotada; las superficies de fondo continúan hasta los bordes para evitar una pequeña isla central sobre blanco. |

En todos los tamaños: párrafos de unas **55–70 letras por línea**, títulos con un límite independiente y botones próximos al texto que los explica. No escalar toda la interfaz con `transform` ni aumentar tipografía, espacios y controles en proporción al monitor. Las tarjetas de precios, preguntas y formularios pueden conservar medidas menores que la demostración. Las columnas y separaciones deben ajustarse por sección, manteniendo alineaciones reconocibles.

La medida de 55–70 es una recomendación editorial propia. WCAG explica el problema de las líneas largas y contempla un máximo de 80 caracteres entre los ajustes del criterio AAA de presentación visual; esto no convierte 70 caracteres en un requisito AA ni demuestra conformidad por sí solo. [W3C, presentación visual](https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html).

## Criterios de aceptación para la siguiente revisión

1. Registrar el ancho real del viewport y el zoom: la resolución física del monitor no equivale necesariamente a CSS px. Comparar 1920 × 1080, 2560 × 1440 y 3440 × 1440, además de una ventana de 1440 px.
2. En hero, ficha y agenda: comprobar ancho de composición, línea de párrafo, tamaño legible de la demostración y equilibrio lateral. Reutilizar el contenido actual; no añadir métricas, paneles ni decoración para ocupar espacio.
3. Mantener las fichas estables al cambiar especialidad. Ampliar el área útil no debe introducir desplazamientos, recortar encabezados o separar la acción de su contexto.
4. Verificar teclado, zoom al 200 % y reflujo a 320 CSS px: el texto y los controles deben conservarse, sin desplazamiento horizontal de toda la landing. W3C distingue explícitamente viewport, zoom y resolución, y define el reflujo a 320 CSS px para contenido vertical. [W3C, reflujo](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

La implementación y las mediciones de Folio corresponden a la tarea principal después del build integrado.
