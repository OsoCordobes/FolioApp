# Pulido de fichas clínicas — ciclo 1

Se mantiene la identidad Clínica clara. Este ciclo corrige continuidad del foco, estados de controles y respuestas visuales breves en los componentes reales de las cinco especialidades.

## Hallazgos y cambios

- **Escalas y dominios ampliados:** al abrir PHQ-9 con Enter, el botón se desmontaba y el foco caía en `BODY`. Ahora pasa al primer campo sin responderlo. Al quitar una escala, vuelve a su botón de carga. El mismo comportamiento cubre GAD-7, los dominios ampliados del examen mental y los instrumentos genéricos NDI/ODI/Borg. El hook de presentación no mueve el foco al montar ni mientras otro control lo conserva.
- **Historiales:** los controles de expansión de Cardiología, Kinesiología y Nutrición comunican `aria-expanded` y apuntan a su contenido mediante identificadores únicos. El historial reciente ya no ofrece «Ver todas» cuando sus cuatro filas visibles abarcan todo el historial. El detalle de una sesión abierta tiene una referencia accesible desde su botón.
- **Interacción visual:** los botones y las pestañas muestran foco definido; radios y EVA ofrecen una respuesta al pasar el puntero; las leyendas y el encabezado SOAP indican el campo en edición. Los cambios de color duran 120 ms y el detalle de sesión aparece en 140 ms, solo cuando el usuario permite movimiento.
- **Movimiento reducido:** la ficha anula animaciones y transiciones con esa preferencia. El mapa vertebral elige desplazamiento inmediato en vez de suave. Las reglas impresas siguen sin animación y conservan la paleta de papel.

No se modificaron datos clínicos, cálculos, puntuaciones, interpretación, validaciones, callbacks de datos ni los mecanismos de guardado, resultado incierto o conservación del borrador.

## Evidencia ejecutada

Galería aislada: `/dev/experience?panel=ficha&esp=…&editing=1`, Chrome independiente de la pestaña visible del usuario. Los ejemplos son ficticios y las solicitudes a servicios están bloqueadas por la galería.

| Comprobación | Resultado |
| --- | --- |
| PHQ-9, Enter sobre «Cargar» | Foco en la primera opción; cero radios marcados. |
| PHQ-9, Enter sobre «Quitar» | Foco vuelve a «Cargar PHQ-9». |
| Examen mental ampliado | Foco en el primer selector ampliado. |
| NDI, abrir y quitar con Enter | Foco en primera opción, sin marcarla; retorno al botón de carga. |
| Borg RPE, abrir con Enter | Foco en el selector de esfuerzo percibido, vacío. |
| PHQ-9 / NDI / ODI, regresión automatizada | Abrir y quitar con Enter conserva el foco; no marca respuestas. |
| Pestañas Información → Plan con flechas | Se conserva una nota ROM aún sin agregar; el foco termina en Plan y solo hay un panel visible. La nota de comprobación se borra después. |
| Mapa vertebral en móvil | Elegir C4 sigue mostrando la técnica ficticia «diversificada». |
| Cinco fichas a 390×844 | Sin desborde horizontal; ancho del documento 380 px excluyendo la barra de desplazamiento. Radios de Psicología de 48×44 px. |
| Escritorio a 1440×1000 | Las cinco fichas se revisaron mediante capturas. Cardiología, Nutrición y Quiropraxia registraron ancho de documento 1430 px. |
| Movimiento reducido / permitido | Las cinco fichas a 390×844 muestran transición 0 s / 120 ms respectivamente, sin desborde. El mapa elige `auto` / `smooth` y conserva la nota ficticia C4. |

La captura nueva anterior al cambio es `evidence/polish-clinical-psychology-before.jpg`, con el tamaño normal de Chrome. Para comparación móvil previa están las cinco capturas `evidence/clinical-*-mobile.png` del ciclo de identidad. Las capturas posteriores son `evidence/polish-clinical-*-desktop.jpg`, `*-mobile.jpg` y el detalle del mapa. Los cuestionarios se muestran abiertos y con foco en las capturas de Psicología/Kinesiología; las otras vistas muestran su estado inicial. `evidence/polish-clinical-results.json` conserva las lecturas de DOM y la prueba de teclado.

## Verificación y límites

- `pnpm typecheck`: sin errores.
- ESLint dirigido a los ocho archivos TypeScript clínicos modificados: sin errores.
- `tests/e2e/design-clinical-polish.spec.ts`: **7/7 pruebas pasando** con el bootstrap de aislamiento y una barrera de rutas que solo permite GET/HEAD al servidor local. ESLint del spec y typecheck posterior sin errores. La primera ejecución detectó un selector de prueba ambiguo entre la técnica general y la técnica de C4; se acotó al mapa y la segunda ejecución completa pasó.
- `git diff --check`: sin errores de whitespace.
- Los historial largos (>4 filas) se verificaron por fuente; el ejemplo disponible tiene una sola sesión y no ejercita esa expansión.
- CUA Chrome solo ofrece control de viewport. La emulación de movimiento reducido se completó en el runner Playwright aislado; sus cinco capturas son `evidence/polish-clinical-*-reduced-motion.png`. La inspección manual en Chrome tenía `no-preference`.
- No se probaron persistencia ni servicios reales. Algunos paneles de evolución siguen indicando carga porque la galería bloquea sus lecturas; sus avisos de vista previa se descartaron únicamente para capturar la interfaz.
- No se compiló, reinició el servidor, modificó el entorno, migró la DB ni creó un commit.

## Archivos

Presentación: `styles/clinical-experience.css`, `components/paciente/paciente-detalle.tsx`, las herramientas de Cardiología/Kinesiología/Nutrición/Psicología y `quiropraxia/spine-map.tsx`. Ampliación informada al coordinador: `lib/especialidades/use-disclosure-focus.ts` y `lib/instrumentos/components/PlanillaRenderer.tsx`, para corregir el mismo problema en la biblioteca que monta Kinesiología.

Prueba de regresión propia: `tests/e2e/design-clinical-polish.spec.ts`. El coordinador de verificación incorporó este nombre en `playwright.design.config.ts`; no hubo ediciones concurrentes del spec.

## Revisión final de foco y estados — 12 septiembre 2026

Se revisaron de nuevo los cambios clínicos, Cobro/Editar plan, Toast y las páginas de error, buscando regresiones concretas. Se encontró y corrigió un P2 del helper de expansión: con `preventScroll: true`, NDI recibía foco a 433,67–446,67 px en una ventana 390×500, debajo de la navegación que empieza en 431 px; ODI lo recibía a 566,67–579,67 px, fuera de pantalla. El foco nativo ahora expone la respuesta sin solicitar desplazamiento animado. Se conservan las guardas que evitan enfocar al montar o mientras otro campo tiene el foco.

La regresión ampliada pasa **15/15** en Chromium, con barreras de red y escritura intactas:

- PHQ-9, GAD-7, NDI, ODI y Borg: abrir con Enter enfoca sin responder; quitar devuelve un botón visible y no tapado.
- Esos cinco instrumentos y MSE: 390×500 y 844×390, con movimiento reducido y permitido. Se verifica geometría y el elemento que recibe el centro del control, no sólo `activeElement`.
- Aperturas programáticas de los seis bloques mientras otro campo conserva el foco: no lo toman ni desplazan su posición dentro de la ventana. El anclaje nativo puede cambiar `scrollY` al crecer contenido anterior, manteniendo estable el campo que se está leyendo.
- El protocolo C-SSRS que aparece al seleccionar Riesgo conserva el foco en Riesgo al montar su escala.
- Se mantienen las pruebas de borrador al cambiar pestañas y del mapa vertebral en las cinco fichas.

Capturas finales inspeccionadas: `evidence/polish-disclosure-ndi-390x500.png`, `evidence/polish-disclosure-odi-390x500.png`, `evidence/polish-disclosure-mse-390x500.png`. El primer pase de esta ampliación fue 13/15: se ajustó exclusivamente la prueba para descartar un aviso asíncrono de la galería sin mover el foco y medir posición del campo en vez de `scrollY`. La segunda ejecución completa pasó en 41 s. Se usó reporter de consola y un directorio propio para no sustituir la evidencia integrada de root.

También se comprobó navegación cliente a 390×500: `html.scrollPaddingBottom` pasa de `69px` en ficha a `auto` en Pacientes y Hoy, sin `.pc-content` remanente. La regla está dentro de `@media screen`, con ancho máximo 920 px y selector `html:has(.pc-content)`; no reserva ese espacio fuera de las fichas ni al imprimir.

El repaso de fuente no encontró otras regresiones nuevas reproducibles en guardas de pendiente, callbacks de cobro, temporizadores de Toast ni regiones de anuncio. Las comprobaciones dinámicas de esos estados siguen siendo las documentadas en `POLISH-STATES.md` y `POLISH-SHORT-VIEWPORT.md`; no se repitieron globalmente en este pase. No se comprobó un lector de pantalla real ni una conexión clínica real. Las ayudas de Diagnóstico y Notas en Editar plan ahora dicen «Se guarda cifrado.» / «Se guardan cifradas.», sin cambiar su comportamiento.

ESLint de helper, Plan y spec, y `git diff --check`: sin errores. Fuente clínica congelada tras esta verificación; typecheck, unidades y build integrados quedan a cargo de root.

La integración detectó dos tipos demasiado amplios en callbacks de la prueba (`HTMLElement | SVGElement`). Se añadió comprobación explícita `instanceof HTMLButtonElement` con error claro antes del mismo `click()`. El typecheck global posterior pasó sin errores. No se repitieron unidades ni la suite clínica por esta corrección de tipos; la suite integrada de root seguía en curso.
