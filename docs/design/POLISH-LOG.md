# Pulido de Clínica clara · 12 septiembre 2026

El usuario aprobó la estética y pidió inicialmente dos horas y media de iteración, aproximadamente de 18:26 a 20:56 UTC. Después dejó sin efecto esa duración fija y autorizó terminar, integrar y publicar el rediseño. La meta se mantuvo: mejorar el comportamiento y la calidad del producto conservando su dirección visual. Trabajo en `codex/folio-experience`, desde `8f1a6d5`, con vista aislada en 4410. El cierre y la incorporación local de `master` se documentan abajo; este registro no acredita todavía la integración del PR en `master` o un despliegue completado.

## Criterio de movimiento

El movimiento responde a una acción: elegir una especialidad, cambiar de vista, abrir un campo o confirmar una selección. Duraciones breves, sin rebotes, reproducción automática ni cascadas de entradas al hacer scroll. Se conserva contenido legible y se respeta movimiento reducido. Las transiciones de ilustraciones usan opacidad y desplazamientos de pocos píxeles; el marco mantiene su lugar.

Referencias técnicas consultadas: [patrón de acordeón WAI](https://www.w3.org/WAI/ARIA/apg/patterns/accordion/), [animaciones y rendimiento](https://web.dev/articles/animations-guide), [movimiento reducido](https://web.dev/articles/prefers-reduced-motion). Son criterios de interacción; las fichas se basan en herramientas existentes de Folio.

## Primera iteración

- Especialidades: el anterior bloque permitía abrir varias descripciones y centraba la ilustración contra la altura cambiante de la lista. Ahora hay una selección exclusiva, un marco anclado al inicio y una ficha ilustrativa distinta para Psicología, Cardiología, Kinesiología, Nutrición y Quiropraxia. Móvil usa un selector nativo junto a la ficha. Teclado, estados expandidos y anuncio de selección incluidos.
- Recorrido del producto: indicador de selección que acompaña a las pestañas; sus tres pantallas comparten una celda de tamaño natural para evitar saltos de altura. Sólo la vista activa queda expuesta al lector de pantalla.
- Tres subagentes revisan acceso/alta, fichas clínicas y plataforma/rendimiento. Los problemas encontrados y la evidencia de cada módulo se registran por separado.

Cada ciclo incluye inspección, corrección y comprobación. Los resultados finales se agregan cuando se ejecutan; este documento no acredita servicios conectados ni producción.

## Segunda iteración · controles, marca y carga

- La marca elegida, Hoja clara, conserva la hoja y su pliegue con una F abierta. Se compararon tres variantes y el símbolo se inspeccionó también a 16, 32 y 48 px. El favicon anterior aún era el triángulo de Next; ahora coincide con Folio. `scripts/design-brand-assets.mjs` reproduce el ICO desde el SVG, sin imágenes externas.
- Se corrigió el intervalo de 768–800 px donde aparecía el botón de menú sin su panel. El menú cierra al salir, al pasar a escritorio y con Escape. La navegación por teclado a una sección mueve el foco al destino.
- Las fichas comparten una celda de altura natural, incluso cuando el texto se envuelve. Las métricas usan columnas adaptables y la barra ilustrativa puede crecer con el texto. Se retiraron los estilos de la ficha genérica reemplazada.
- Se retiró del layout el QueryProvider sin consumidores. La búsqueda de imports/hooks abarcó app, components, lib y tests; se conserva el módulo y la dependencia para un uso futuro explícito. La medición aislada de su coste no equivale al ahorro del build final.
- MotionProvider usa domAnimation: ninguna ruta actual requiere las funciones de arrastre o layout incluidas en domMax. No se eliminó la preferencia de movimiento reducido.
- Pruebas de esta tanda en Next aislado: 14/14 para cinco fichas en cinco anchos, altura de las tres vistas, teclado, movimiento reducido y menú de tablet/móvil. Capturas finales de ficha guardadas en evidence/polish-specialty-*-final.png.

Los módulos tienen registros propios: [acceso](POLISH-ACCESS.md), [clínica](POLISH-CLINICAL.md), [plataforma](POLISH-PLATFORM.md), [portal e invitaciones](POLISH-PORTAL.md) y [estados excepcionales](POLISH-STATES.md). La revisión continuó por ciclos hasta el cierre autorizado por el usuario, sin mantener como obligación el horario inicialmente previsto.

## Checkpoint compilado · 19:11 UTC

El build intermedio pasó compilación, tipos y lint. La portada informa 217 kB First Load frente a 223 kB en `8f1a6d5`, aun con fichas diferenciadas nuevas; es una medida de bundle de Next, no una promesa de tiempo de carga. Se comprobaron 12 rutas HTTP/imagen: públicas 200, cinco galerías de esta experiencia 404 en modo compilado, favicon/ícono/OG correctos. La navegación de tres vistas funcionó sin pageerror. El servidor volvió a desarrollo en 4410 para seguir viendo cambios.

## Tercera iteración · observación de pantalla grande

La observación del usuario se incorporó al alcance original. Se ampliaron marcos gradualmente hasta 3440 px y se redistribuyó el recorrido en monitores anchos, conservando composición móvil y de 1440 px. Diez tamaños pasaron y un segundo revisor criticó tres transiciones/alineaciones, que se corrigieron. Detalle en [POLISH-RESPONSIVE.md](POLISH-RESPONSIVE.md).

También se revisaron la navegación que indica la sección actual, los formularios en ventanas bajas, el retorno de foco y las protecciones de cierre durante guardados. Los hallazgos se corrigieron localmente y se probaron con acciones sintéticas antes de integrarlos. El segundo build y la comparación visual posteriores están confirmados en el cierre de esta ronda.

## Cuarta iteración · revisión cruzada

Los diálogos de paciente, contacto, cobertura, enmienda, bloqueo, plan y cobro se revisaron con foco inicial, cierre, operación pendiente y error preservando valores. El panel de cobro tenía un recorte real en ventanas bajas; su contenido ahora se desplaza dentro del diálogo. En las fichas, la navegación móvil deja espacio para el control enfocado. Un segundo revisor encontró que abrir NDI/ODI todavía podía enfocar una respuesta fuera de pantalla: se corrigió el helper de expansión y la [suite clínica ampliada](POLISH-CLINICAL.md) pasó 15 de 15.

La primera integración pública reunió 65 pruebas: 64 pasaron y una agotó su espera de scroll reducido del calendario. Cuatro cargas instrumentadas posteriores observaron el comportamiento `instant` y geometría válida; la comprobación dirigida de ambas preferencias pasó después de esperar la vista montada. La repetición completa posterior, con ocho escenarios clínicos añadidos, pasó **73 de 73** en 2,0 min: [salida final](evidence/polish-integrated-public-final.txt). La primera ejecución se conserva como evidencia de la corrección; no se cuenta como otro conjunto de pruebas únicas.

La revisión de densidad propuso reducir de 19 a 14 px el espacio vertical de las filas de cobro ilustrativas: se aplicó, reduciendo hasta 30 px el espacio compartido sin saltos entre pestañas. Se corrigió también una diferencia de 7 px en el padding de la ilustración principal al comenzar la ampliación sobre 1440 px. Se generaron e inspeccionaron 14 baselines, incluidas fichas y composiciones amplias, y una [comparación posterior sin actualizarlos](evidence/polish-visual-compare.txt) pasó **14 de 14** en 21,9 s.

## Cierre local verificado

La integración de `2d02096` pasó tipos y lint globales, **1.628 de 1.628 unidades** y el segundo build, identificado como `Sr0tdXv5RNBdPY4pKAzR_`. La portada informa **218 kB First Load**, frente a 223 kB en el cierre original; el checkpoint intermedio de 217 kB se conserva como medición anterior. [Build](evidence/polish-build-second.txt), [tipos](evidence/polish-typecheck-final.txt), [lint](evidence/polish-lint-final.txt), [unidades](evidence/polish-unit-final.txt).

El [recorrido compilado final](evidence/polish-production-smoke-final.json) comprobó 12 rutas/recursos y la composición a 1440, 1920, 2560 y 3440 px, sin desborde global ni errores de página/consola observados. Se confirmaron las dos fuentes TTF en ambas trazas OpenGraph, el PNG de marketing con la nueva marca y la WOFF2 realmente usada por Chromium. La comprobación de galerías 404 se limita a las cinco rutas nuevas enumeradas en el [índice de verificación](POLISH-VERIFICATION.md).

El [perfil compilado](evidence/polish-runtime-profile.json) usa dos contextos nuevos: escritorio normal y móvil con ralentización artificial. Ambos mantienen la altura al recorrer las tres vistas, sin errores de página/consola ni desplazamientos de contenido sin interacción reciente observados. La muestra móvil registra dos tareas largas; estos datos locales no son Core Web Vitals de usuarios reales ni una promesa de rendimiento en producción.

La autorización para integrar y publicar está vigente; la duración fija inicial ya no aplica. Se incorporó `master a0fe34e` sin conflictos en el commit local `b15bc52`: sólo añade los cinco archivos de M118 y conserva idéntica la fuente de aplicación de `2d02096`. La CI del PR verificará el combinado. **No se marca todavía el PR integrado en `master` ni la publicación completada.** El despliegue debe documentarse después con su propio commit y comprobación.
