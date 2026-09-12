# Estados transversales — pulido

Se inspeccionaron errores, página no encontrada, carga de ficha, confirmaciones, avisos y las tres políticas públicas. Se eligieron cuatro cambios con un beneficio verificable, manteniendo los mecanismos de recuperación y las reglas del producto.

## Cambios realizados

1. **Error recuperable:** «No pudimos cargar esta página» explica el problema y mantiene Reintentar, inicio y soporte. Se retiró la promesa «Sentry capturó el error y lo estamos viendo»: invocar el capturador no demuestra recepción o atención humana. La captura del error, `reset()` y los destinos siguen iguales; el detalle técnico continúa oculto y el identificador queda como referencia para soporte.
2. **Fallo del layout raíz:** la pantalla independiente usa blanco/lavanda, foco visible, botón de al menos 44 px y texto claro. Incluye título y viewport propios y no necesita fuentes, CSS ni servicios externos. Se conserva la captura y recuperación originales.
3. **Cookies en móvil:** se confirmó un ancho de página de **461 px en un viewport de 390 px**, causado por la tabla. La tabla ahora vive en una región identificada, desplazable por teclado y tacto, con encabezados de columna semánticos. El documento permanece dentro del viewport. No cambió ninguna fila, afirmación jurídica, fecha, versión o enlace de la política.
4. **Tiempo de lectura de avisos:** los cuatro segundos de cierre automático se suspenden mientras el puntero está encima o un control del aviso tiene foco. Al salir se reanuda el tiempo restante. Las dos pausas pueden coexistir; pausar un aviso no pausa los demás. Cerrar y desmontar eliminan sus timers. Se preservan el texto, tono, API de `show`, callbacks de acciones y región de anuncio única. El cierre tiene un área de 44×44 px.

No se añadió movimiento clínico. El estado 404, las políticas de privacidad/términos, el esqueleto de ficha y ConfirmDialog se conservaron tras revisión; no se detectó un defecto de alto impacto que justificara editar esos componentes en este ciclo. ConfirmDialog queda bajo propiedad del coordinador de verificación y su recorrido de foco ya tenía cobertura.

## Verificación

`node scripts/design-states-qa.mjs` monta los componentes reales con ejemplos sintéticos en un servidor efímero de loopback. Importa la política de aislamiento, limpia el entorno heredado, sustituye Next Link/Sentry en el fixture y bloquea toda ruta externa y todo método distinto de GET. El modo global se prueba sin la hoja CSS de la aplicación. Los demás ejemplos usan la fuente local de Folio.

**24/24 casos pasan**, en desarrollo con StrictMode y en producción:

- Pausa por foco durante diez segundos sin perder el aviso ni el foco.
- Reanudación exacta del tiempo restante, sin reiniciar otros cuatro segundos.
- Pausas simultáneas de foco/puntero y timers independientes entre avisos.
- Limpieza de timeout al desmontar; cierre manual y severidad de error conservados.
- Cierre accesible de 44 px y ausencia de animación bajo movimiento reducido.
- Errores sin mensajes técnicos ni promesa de recepción; `reset()` y capturador conservados.
- Tabla de cookies con cuatro encabezados, foco y desplazamiento con flecha derecha, sin desborde de página.
- 404, privacidad, términos y loading a 390×844; skeleton sin shimmer bajo movimiento reducido.

Además, `pnpm test:unit` pasó **1628/1628** después del ajuste del timer. ESLint dirigido pasó. Typecheck conjunto pasó después de corregir el tipo de `window.setTimeout` y la fixture de invitación del otro agente.

El primer ensayo de timing usó un reloj virtual que todavía avanzaba entre operaciones. Se fijó y pausó el reloj para comprobar los milisegundos restantes de forma determinista. La prueba de desplazamiento espera el cambio observable del scroll, en vez de asumir que la animación nativa terminó al avanzar timers. Una ejecución simultánea con otras verificaciones superó el timeout de navegación de 4 s; se amplió a 15 s, manteniendo las aserciones de interacción acotadas. La ejecución final completa pasó.

## Evidencia y límites

- `evidence/polish-states-cookies-before.jpg`: captura manual del desborde en el servidor de diseño 4410.
- `evidence/polish-states-error-mobile.png`, `polish-states-global-mobile.png`, `polish-states-cookies-mobile.png`: estados reales montados por el fixture aislado con movimiento reducido. La tabla aparece desplazada porque documenta la navegación con flecha.
- `evidence/states-results.json`: resultados de los 24 casos.

No se provocó un fallo real de un consultorio ni se enviaron eventos a Sentry; la prueba verifica que se invoca el límite simulado. Tampoco se revisó la vigencia jurídica de las políticas ni se modificó su contenido. Las pruebas son evidencia de interacción y presentación, no de integración con servicios o persistencia.

## Revisión cruzada de SpecialtyShowcase

Los campos ilustrados corresponden a herramientas existentes; el IMC mostrado concuerda con el peso y la talla. Las escalas se presentan como herramientas de registro sin prometer diagnóstico. Las capturas de Psicología y Quiropraxia son legibles. Se sugirió al coordinador precisar «Frecuencia cardíaca» y conservar el pequeño mapa como ilustración esquemática, sin presentarlo como anatomía real. No se editó ese componente.

## Archivos propios

`app/error.tsx`, `app/global-error.tsx`, `app/(public)/cookies/page.tsx`, `components/ui/toast.tsx`, `styles/states-experience.css`, `scripts/design-states-qa.mjs`. La propiedad compartida de ToastProvider se acordó antes de editar. No hubo compilación, reinicio de 4410, cambio de entorno real, DB, despliegue ni commit por parte de este agente.
