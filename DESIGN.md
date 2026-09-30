# Sistema visual de Folio

La hoja central es `styles/design-system.css`. Se importa después de `public/folio.css` y antes de las hojas de cada superficie. Extrae el sistema efectivo que ya usaba Folio; los nombres históricos de tokens siguen disponibles para evitar una migración amplia del producto.

## Color

Los textos son neutrales: `--ink` #272833, `--ink-2` #50515F y `--ink-3` #686976. Las superficies claras usan blanco, #F6F6F9 y #F1F1F6. El violeta #6255C5 identifica marca, acciones principales, selección y foco; su estado hover es #4E42AD. Los estados funcionales conservan verde, ámbar y rojo con sus superficies correspondientes.

La landing, las páginas públicas de profesionales y el directorio definen su paleta clara en un único bloque central. La preferencia oscura del espacio de trabajo conserva su bloque propio. Los acentos personalizados de los profesionales siguen perteneciendo a su miniweb.

## Tipografía y espacio

Se usa la fuente existente Plus Jakarta Sans. El cuerpo de la landing es de 16px, con interlineado 1.7. Los controles compartidos usan 14px y las notas generales 14px; las etiquetas compactas de vistas ilustrativas usan 11–13px. Los títulos mantienen una escala fluida con tracking moderado.

La separación de secciones usa `--space-section`, de 56px a 88px. Los tokens de espacio siguen una base de 4px. La jerarquía se expresa con tamaño, peso, medida del texto y composición; el violeta se concentra en funciones concretas.

## Controles y marca

`--control-height` es 48px y `--control-radius` es 8px. Botones generales, campos de acceso/onboarding y controles coincidentes consumen estos tokens. Los enlaces de acción de la landing tienen un área de al menos 44px de alto. El foco usa un contorno violeta de 3px; selección de texto y caret comparten la paleta.

`components/folio-brand.tsx` reúne el símbolo existente con el texto `folio.` y su punto violeta. Se usa en cabecera y pie de landing, acceso y onboarding. La migración es incremental; no reemplaza nombres ni logos de profesionales.

## Composición e interacción

Se conserva el recorrido completo: portada, producto, continuidad de atención, cinco especialidades, reservas/equipo/portal, privacidad, planes, siete preguntas frecuentes, cierre y pie. El bloque de reservas tiene mayor peso, acompañado por dos entradas de equipo y portal. La ficha por especialidad usa un único contenedor de registro.

Las pestañas del producto son la interacción principal: indicador móvil breve y cambio de vista en una composición estable. Todas las opciones siguen disponibles por teclado. Con `prefers-reduced-motion: reduce` se suprimen las transiciones y animaciones de las superficies públicas.

## Alcance de esta consolidación

Se centralizan paleta, tipografía general, radios, alturas, duraciones y foco. Las hojas de landing, acceso, onboarding, miniweb y editor conservan su geometría específica. `public/folio.css`, las reglas clínicas y las reglas de plataforma no se reescriben en esta entrega. Las pruebas de esta entrega y la revisión independiente se registran en `docs/design/COHERENCE-DELIVERY.md`.
