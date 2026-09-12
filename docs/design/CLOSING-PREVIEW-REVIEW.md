# Revisión independiente de vistas públicas

320, 650, 1024 y 2560 CSS px; Chromium con movimiento reducido, carga local completa antes de inspeccionar. Sin edición de producto.

Las tres pestañas de producto y las cinco fichas conservaron exactamente su altura al cambiar de estado en cada ancho. Los controles ocultos no son alcanzables, el panel seleccionado recibe Tab después de la pestaña y End lleva a Cobros. End en el selector de escritorio lleva a Quiropraxia. Con movimiento reducido las pantallas y fichas tienen `animation-name: none` y el contenido sigue visible. No hubo errores de consola, errores de página ni desborde horizontal.

El detector de recortes encontró únicamente el anuncio `sr-only`, oculto visualmente a propósito. Las capturas de Cobros a 320, Historia a 650 y Nutrición a 650 muestran todos los importes, estados, notas y métricas. El selector y la ficha estrecha de 650 siguen siendo legibles; no justifican otro cambio de breakpoint en este cierre.

Historia deja 134, 111, 136 y 152 px bajo su última visita, respectivamente. Es el efecto de conservar la altura de la pestaña más larga; a estos anchos la determina Cobros. Es un detalle de densidad, no un fallo de contenido.

Única propuesta: reducir el padding vertical de `.fx-payment-row` de 19 a 14 px. Una prueba temporal en el navegador redujo 30 px las tres vistas a 320/650/1024, y 17 px a 2560 (Agenda pasa a determinar la altura). No hubo saltos entre pestañas. Mantener la altura compartida y evitar añadir información de relleno a Historia. El ajuste es discrecional; el estado actual es utilizable y no bloquea el cierre.

Evidencia: `evidence/closing-preview-review.json`, `evidence/closing-preview-density-proposal.json`, `evidence/closing-review-product-320-cobros.png`, `evidence/closing-review-product-650-historia.png`, `evidence/closing-review-specialty-650.png`.
