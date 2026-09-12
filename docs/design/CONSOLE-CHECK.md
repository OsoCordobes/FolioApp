# Diagnóstico del indicador «1 Issue»

12 de septiembre de 2026. Sin modificaciones de producto, SDK, observabilidad, dependencias o configuración.

**La causa se reprodujo en el arnés de texto ampliado.** `scripts/design-cross-review.mjs` esperaba `domcontentloaded` y la carga de fuentes, y luego añadía estilos inline de tamaño e interlineado a todo `.fx-marketing`. Eso podía ocurrir antes de completar la hidratación de React. La advertencia resultante señala en su diff precisamente los estilos añadidos por la prueba: por ejemplo, `font-size:28px` y `line-height:42px` en elementos que no tenían esos atributos en React.

La comparación A/B a 320 × 1000 dejó estos resultados: [registro](evidence/console-text-stress-check.json).

| Inicio de la mutación de texto | Resultado |
| --- | --- |
| Tras `domcontentloaded` y fuentes | Advertencia real de atributos diferentes durante hidratación; badge visible con una incidencia; ningún `pageerror`. |
| Tras `networkidle` y fuentes | Sin errores de consola ni de página; badge de incidencias invisible. |

Es un aviso real generado por la manipulación anticipada del arnés. No se reprodujo en una visita normal. La tarea principal recibió la recomendación de esperar la carga completa antes de esa mutación y capturar `console.error` además de `pageerror`.

**Cuatro visitas nuevas a `/`, `/login`, `/forgot` y `/dev/experience`:** todas respondieron 200, con cero errores y advertencias de consola, cero `pageerror`, cero peticiones fallidas y ninguna petición externa. Sólo aparecieron la sugerencia informativa de React DevTools y mensajes normales de Fast Refresh. [Registro de visitas](evidence/console-check.json).

Una comprobación adicional del canal de desarrollo recibió mensajes `built` / `sync` con `errors:[]` y `warnings:[]`; el botón de incidencias no era visible. Los contadores ocultos de transición en el Shadow DOM (`-1`, `0`) no representan una incidencia actual. [Registro del indicador](evidence/console-issue-overlay.json).

**Advertencias anteriores, separadas:** el build intermedio contiene 52 advertencias de Turbopack sobre `import-in-the-middle` como dependencia externa, bajo OpenTelemetry. Están registradas desde `evidence/polish-build-first.txt:9`; no son la causa del aviso de la captura de texto ampliado. No se alteraron proveedores o paquetes para tratarlas.

Al abrir el overlay durante la reproducción, la política del arnés mantiene únicamente GET al origen local. El registro A/B conserva también un fallo de recurso de ese diagnóstico; no se usó para atribuir un fallo a la aplicación.
