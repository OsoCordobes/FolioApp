# Revisión cruzada — portada y dependencias

12 de septiembre de 2026. Worktree `folio-experience`. Revisión independiente de SpecialtyShowcase, ProductPreview, FolioMark/icon.svg, MotionProvider y carga global. Sin cambios de arquitectura por parte del revisor, sin backend, build ni reinicio. Root realizó las correcciones de sus archivos.

## Comprobaciones y hallazgos

**9 de 9 escenarios propios aprobados:** [salida](evidence/cross-e2e-results.txt), `tests/e2e/design-cross-review.spec.ts`. A 1440, 1024, 768, 720, 390 y 320 px, Home/End/flechas mantienen foco, selección, un único tab alcanzable y un único título accesible en el panel. Tab pasa al panel. La píldora coincide con la columna seleccionada con menos de 0,04 px de desviación. El SVG de cabecera y `/icon.svg` contienen los mismos tres trazados. Cabecera con texto al 200 % a 390 y 320 px conserva controles dentro del ancho, menú funcional y retorno de foco con Escape.

El script [design-cross-review.mjs](../../scripts/design-cross-review.mjs) recorre las tres vistas y cinco especialidades; registra geometría, accesibilidad y errores. Las capturas de escritorio, tablet y móvil se inspeccionaron. En tamaños normales no se encontró desborde ni cambio de altura entre paneles. [Registro inicial](evidence/cross-layout-review.json).

Se distinguieron dos pruebas: **720 CSS px** reproduce el espacio de reflujo disponible en una ventana de 1440 px ampliada al 200 %; **texto CSS duplicado** es una prueba adicional de esfuerzo, no se presenta como zoom nativo del navegador ni certificación de accesibilidad.

El texto duplicado detectó tres defectos concretos, comunicados antes de editar: el encabezado desplazaba la hamburguesa fuera de pantalla, la barra ilustrativa cortaba una segunda línea y las tarjetas de métricas comprimían cifras. Root hizo crecer el encabezado, eliminó altura fija de la barra y usó columnas adaptables para métricas. La repetición confirma controles alcanzables y métricas sin recorte en 1440, 768, 390 y 320 px; capturas `cross-*-text2-after.png`. Una captura completa posterior se interrumpió por timeout de carga de desarrollo; la repetición dirigida de los dos móviles terminó y está en [registro posterior móvil](evidence/cross-layout-review-after.json). No se confundió ese timeout con una regresión.

**Observación al liberar el servidor a las 19:09 UTC:** en la prueba de texto CSS al 200 %, la columna de segmentos de Quiropraxia aún podía ensanchar la grilla y quedar cortada por el marco. Se informó a root el ajuste propuesto: `min-width: 0`, columna `minmax(0, 1fr)` y envoltura de palabras cuando corresponda. Root aplicó esos ajustes después del informe; su repetición visual queda para después del build conjunto. También se detectó desborde global con esa prueba extrema en móvil; el tamaño normal y reflujo a 720 px pasan. Se investigará qué elemento lo origina antes de proponer más CSS. No se declara resuelta toda la ampliación de texto. El screenshot `cross-specialties-320-text2-after.png` conserva la observación anterior al último ajuste.

Después del build se repitió el diagnóstico móvil: los segmentos de Quiropraxia entran en el marco, comprobado en `cross-specialties-320-text2-final.png`. La causa del ancho global de **418 px** en viewport de 390 y 320 px es la grilla de precios: sus tarjetas llegan a 417,61 px sin un ancestro que recorte. El hero tiene además un ancho mínimo de 493,84 px provocado por contenido ampliado, pero su propio `overflow:hidden` lo recorta y no origina esos 418 px globales. A 320 quedan títulos largos en la cabecera de algunas especialidades compitiendo con el avatar. Estos hallazgos se pasaron a root para sus ajustes de reflujo; no se modificó su CSS. [Diagnóstico DOM con ancestros y geometría](evidence/cross-layout-review-final.json).

No se duplicaron como hallazgos propios la corrección de menú entre 768 y 800 px y el ajuste de separación de la píldora, identificados por root. Un fallo inicial de nuestro test de logo fue un locator ambiguo entre cabecera/pie; se acotó al landmark `banner`, manteniendo la comparación de trazados.

La comprobación matemática de tokens encontró `--ink-3: #706B84` sobre `--surface-2: #F0EFF8` con contraste **4,46:1**, ligeramente inferior a 4,5:1 para texto pequeño. Afecta etiquetas de métricas; se comunicó a root antes de cambiar sus tokens. Los otros cinco pares examinados superan 4,5:1. [Pares y cálculo](evidence/cross-contrast.json). Esta revisión de pares no sustituye una auditoría completa de todos los estados y fondos.

**Revisión posterior, 19:58 UTC:** el ajuste de root a `#6D687F` produce **4,68:1** sobre el mismo fondo. Se verificó el color calculado de «Presión arterial» en la ficha de Cardiología, además de recalcular el par original. La evidencia inicial se conserva; el [registro posterior](evidence/cross-contrast-after.json) contiene ambos valores sin redondear.

El arnés [design-contrast-focus-qa.mjs](../../scripts/design-contrast-focus-qa.mjs) pasó **4 de 4 estados**: preferencias clara y oscura, a 1440 y 390 px. La preferencia se restaura mediante el proveedor real desde almacenamiento local. La portada mantiene su paleta clara en ambas; no se presenta como un rediseño oscuro de la portada. Flecha derecha selecciona y enfoca «La historia clínica», su panel coincide y la píldora queda alineada con menos de 0,02 px de desviación. El texto seleccionado contrasta **7,76:1** y su contorno de foco **5,08:1** con el fondo de la barra. En Cardiología, el botón de escritorio y el selector móvil conservan foco visible de 2 y 3 px respectivamente. Sin errores JavaScript en estas cuatro cargas. [Salida](evidence/contrast-focus-results.txt).

Se inspeccionaron las capturas `contrast-focus-tour-dark-1440.png`, `contrast-focus-tour-light-390.png`, `contrast-focus-specialty-light-1440.png` y `contrast-focus-specialty-dark-390.png`: controles alcanzables, selección distinguible y contornos completos. Son muestras de ilustraciones sintéticas y de estados concretos, no una certificación WCAG ni evidencia de guardado clínico. No se modificó CSS durante esta comprobación.

## Revisión de acceso, portal y avisos

Durante el build se revisaron por código los diffs de recuperación, ingreso al portal, reenvío de email, StepShell, navegación del portal, reagenda y ToastProvider. No se encontró una regresión nueva en esos cambios. La recuperación mantiene su mensaje genérico; las nuevas validaciones no alteran el contrato del servidor. El portal conserva captcha y pendiente; la solicitud de reagenda conserva selección y motivo al recibir un error y devuelve el foco sólo después de confirmar éxito. La navegación desplaza únicamente su fila horizontal y desconecta su ResizeObserver. El asistente evita consumir teclas de selectores nativos, composición de texto o controles externos.

El aviso descuenta sólo el tiempo sin pausa; foco y puntero son causas independientes y salir de una no reinicia el reloj si la otra sigue activa. Cierre manual, expiración y desmontaje limpian el timer y su entrada. No se modificó este código durante la revisión. Las pruebas específicas de estados y la repetición de unidades corresponden a la integración del autor, no se presentan como ejecutadas por este revisor.

Se señaló además una mejora de reposo preexistente en `CheckEmailPanel`: su intervalo de un segundo continuaba después de vencer el cooldown, aunque el contador dejaba de mostrarse. No era una regresión introducida por el rediseño. Root autorizó la corrección después del snapshot: ahora el tick de vencimiento libera su intervalo, y un nuevo reenvío inicia otro con su nuevo plazo. La limpieza de desmontaje se conserva.

El arnés dedicado [design-email-cooldown-qa.mjs](../../scripts/design-email-cooldown-qa.mjs) usa el componente real, reloj controlado, acciones sintéticas y red limitada a loopback. Reprodujo cuatro fallos de reposo antes del cambio y pasó **8 de 8** después, en desarrollo con StrictMode y producción. Comprueba primer plazo de 60 s, siguiente de 5 min, bloqueo durante respuesta pendiente, error con reintento explícito, reload que conserva sólo el tiempo restante, desmontaje y una espera almacenada ya vencida. [Antes](evidence/email-cooldown-before.txt), [después](evidence/email-cooldown-after.txt), [resultado estructurado](evidence/email-cooldown-results.json). No se envió ningún correo. ESLint del componente/script y typecheck global terminaron con salida 0 después del cambio.

Repetición general por este cambio de lógica, terminada a las 19:21 UTC: **1.628 de 1.628 unidades**, cero fallos, omitidas o canceladas, 14,2 s. [Salida completa](evidence/unit-cooldown-results.txt).

## Coste inicial y propuesta

[Estimaciones reproducibles](evidence/cross-dependencies.json) con esbuild en modo producción y React externo. No son bundles de Next ni ahorro de First Load confirmado.

| Componente aislado | Minificado | Gzip |
| --- | ---: | ---: |
| QueryProvider | 24.959 B | 7.555 B |
| MotionProvider con domAnimation | 62.432 B | 22.175 B |
| El mismo wrapper con domMax | 105.796 B | 34.922 B |

La búsqueda en todo TS/TSX encuentra TanStack sólo en `lib/query-client.tsx`; no hay consumidores de consulta, mutación ni hidratación. Se propuso retirar únicamente el wrapper/import global y conservar archivo/dependencia. Root ya aplicó ese cambio. Así no se introduce un provider condicionado por pathname ni una frontera que monte/desmonte subárboles al navegar. El ahorro real debe contrastarse con el build conjunto.

Los consumidores vivos de MotionProvider no usan drag/layout/shared elements. Los `layoutId` encontrados pertenecen a slides antiguos sin imports desde las rutas actuales. La sustitución domMax → domAnimation tiene una diferencia aislada de **12.747 B gzip** y es coherente con los consumidores revisados.

La cobertura CSS observada en portada, cuatro tamaños, tres vistas, cinco fichas, FAQ y menú móvil utilizó **8,07 %** de los caracteres del chunk general (42.653/528.634). El stylesheet específico de especialidades alcanzó **91,51 %**. [Cobertura](evidence/cross-css-coverage.json). Lo no usado aquí pertenece también a otras rutas, interacciones, impresión o temas: estos datos **no son una lista de CSS que pueda borrarse**.

Los cuatro archivos `platform.css`, `clinical-experience.css`, `auth-experience.css` y `public-experience.css` sumaban **14.442 B gzip** medidos por separado y están importados globalmente. Se puede estudiar llevar reglas de rutas a sus layouts, pero requiere comprobar cascada y navegación de ida/vuelta entre portada, acceso, portal y app. No se implementó esa división. No conviene trocear `public/folio.css` (531.101 B de fuente, 99.590 B gzip) basándose sólo en esta cobertura de portada; el build ya aplica su propia transformación y compresión.

## Integración

Los nueve escenarios nuevos están incluidos en `playwright.design.config.ts`. Se ejecutaron dirigidos con reporter propio para conservar evidencia de la suite general. La compilación conjunta y su comparación de tamaños corresponden a root. Este informe describe revisión visual y técnica aislada, no datos guardados, cobros ni funcionamiento de proveedores reales.

ESLint sobre los tres scripts de esta revisión, el spec y la configuración aislada: salida 0, sin avisos, 19:14 UTC. No se repitió el typecheck global en paralelo con el build conjunto.
