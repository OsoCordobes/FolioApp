# Comprobación focal con WebKit

12/09/2026. Playwright WebKit 26.4, revisión 2287, automatizado en Windows. No equivale a Safari real ni a una prueba en iPhone.

Se descargó con el instalador oficial de Playwright en `C:\Users\amiun\AppData\Local\Temp\folio-experience-webkit-20260912`. Sus auxiliares FFmpeg y Winldd quedaron en la misma carpeta temporal. No se instalaron navegadores visibles, paquetes del proyecto ni dependencias del sistema; no se modificaron archivos de entorno.

## Limitación del servidor HTTP local

La respuesta de `http://127.0.0.1:4410/` incluye `upgrade-insecure-requests` en la política CSP (`next.config.ts`). WebKit elevó las solicitudes de fuente, CSS y JavaScript a HTTPS en ese mismo puerto HTTP, de modo que la primera revisión no podía cargar la experiencia. Chromium no mostró esa elevación durante estas pruebas. El resultado original se conserva en `evidence/webkit-local-http-original.json`.

Para revisar la presentación, el arnés quitó únicamente esa directiva de la respuesta local del documento, conservando las demás directivas CSP y bloqueando solicitudes que no fueran GET/HEAD al origen HTTP local. No se cambió el servidor, la configuración del producto ni su código. Esto permite comparar el renderizado; no certifica la política de seguridad ni el despliegue HTTPS.

## Resultado con esa adaptación del arnés

390, 1440 y 2560 CSS px pasaron:

- Tres pestañas de producto con altura estable, un solo estado visible, y secuencia de teclado Home, flecha derecha, End y Tab al panel.
- Cinco especialidades con altura estable, selección móvil y activación de botones de escritorio con teclado.
- Menú móvil: Espacio abre, Escape cierra y restaura el foco, y un enlace de sección cierra el menú.
- Sin desborde horizontal, errores de consola, errores de página ni solicitudes externas. Movimiento reducido activo.

Las capturas de portada y Cobros a 390 se revisaron visualmente. WebKit reserva 10 px para la barra vertical en este entorno; sus anchos útiles son algo menores que en Chromium. No produjo recortes. La fuente local estaba cargada en ambos motores: los pesos 400/600/700 dieron métricas de texto prácticamente idénticas, descartando un fallo de carga o de ejes de la fuente en la diferencia visual percibida.

Evidencia: `evidence/webkit-public-review.json`, `evidence/webkit-font-comparison.json`, `evidence/webkit-390-hero.png`, `evidence/webkit-390-cobros.png`.

No se detectó una corrección de producto necesaria en esta comprobación focal. Firefox continúa sin comprobarse; no se ejecutó una suite completa en WebKit.
